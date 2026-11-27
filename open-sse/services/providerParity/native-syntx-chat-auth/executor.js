// SYNTX native chat executor (BaseExecutor execute contract), staged and not
// registered (see ./registration.json). Port of OmniRoute c71f0065
// open-sse/executors/syntx.ts and open-sse/executors/syntxExecute.ts.
//
// One turn: resolve the account JWT, map the OpenAI history onto a SYNTX
// chat_uuid (create one on a miss), upload image parts and an optional
// history file, POST /api/v1/llm/generate, then read the returned SSE
// stream_url (no auth) and answer as OpenAI SSE or one chat.completion. With
// tools, the turn is buffered and `<tool_call>` blocks become tool_calls.
//
// Fork deviations (all documented in the port report):
//   - every upstream read is bounded (whole-turn deadline, per-call deadline
//     for auxiliary calls, SSE idle timeout, byte caps) and no call follows a
//     redirect, except a client image download, which re-checks each hop;
//   - a client image URL is downloaded with no credentials, only over https,
//     only from public hosts (literal and DNS-resolved); data URLs as source;
//   - a returned stream_url must be https://sse.syntx.ai/stream/...; the
//     account token is never sent there (as in the source);
//   - no replay: generate is sent once; a failure after it carries
//     `acceptedTurn` (`uncertain` when SYNTX's acceptance is unknown,
//     `accepted` once a valid stream_url came back) and is never retried here;
//   - a stream commits to a 200 only after SYNTX's first delta or the end of
//     the turn; a failure after output ends with finish_reason "error";
//   - an SSE body that ends without `[DONE]` or `usage_final` is a truncation;
//   - a create-chat 401/403 and a generate 401/403 are 401 syntx_auth_error,
//     so the gateway can flag the credential (the source wrapped create
//     failures as 502); generate 429 keeps its status and Retry-After; no
//     other quota condition is invented, since the source parses none;
//   - session state and model discovery are per executor and account-keyed.
import { BaseExecutor } from "../../../executors/base.js";
import { createExecutorSender, requestAbortError, withBillableDispatch } from "../../../executors/sendRequest.js";
import * as proxyFetch from "../../../utils/proxyFetch.js";
import { sanitizeErrorMessageWithSecrets } from "../../../utils/error.js";
import { isFunction, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  SYNTX_ACCOUNT_SYSTEM_PROMPT_MAX_CHARS, SYNTX_API_BASE, SYNTX_AUX_TIMEOUT_MS, SYNTX_CHATS_URL, SYNTX_GENERATE_PATH,
  SYNTX_IDLE_TIMEOUT_MS, SYNTX_MAX_IMAGES, SYNTX_MAX_STREAM_BYTES, SYNTX_MAX_UPLOAD_BYTES, SYNTX_MESSAGES,
  SYNTX_PROVIDER_ID, SYNTX_REQUEST_TIMEOUT_MS, SYNTX_SETTINGS_URL, SYNTX_SITE, SYNTX_UPLOAD_URL, SYNTX_UPLOADED_FILE_PREFIX,
} from "./config.js";
import { connectionFingerprint, looksLikeJwt, resolveSyntxToken, syntxAuthHeaders, syntxSecrets } from "./auth.js";
import { createSyntxModelCatalog, inferSyntxAiName, mapSyntxModel } from "./models.js";
import {
  canonicalizeSyntxUserText, createSyntxSessionStore, firstCanonicalSyntxUserText, hashSyntxConversation, lastUserMessage,
  lastUserTextForReset, looksLikeClaudeCodeSessionReset, syntxMessagesForNewSession,
} from "./sessions.js";
import {
  SYNTX_FILE_COMPACT_PROMPT, buildSyntxGenerateBody, buildSyntxGenerateText, capSyntxGenerateText, chatTitleFromText,
  encodeSyntxUploadMultipart, isSyntxStreamUrl, lastUserText,
  messagesHaveSyntxToolTraffic, normalizeSyntxRequestMessages, parseSyntxToolCalls, syntxToolCatalogFingerprint,
  wantSyntxThinking,
} from "./chat.js";
import { collectSyntxImageSources, decodeDataUrl, isDataImageUrl } from "./images.js";
import { SyntxTransportError, fetchGuardedImage, readBoundedJson, readErrorText, readSyntxSse } from "./transport.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const SSE_HEADERS = { "Cache-Control": "no-cache", Connection: "keep-alive", "Content-Type": "text/event-stream" };
const CLIENT_CLOSED = 499;
const encoder = new TextEncoder();
const str = (value) => (isString(value) ? value : "");

class SyntxStepError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function errorResponse({ status, code, message, retryAfter }, secrets) {
  const headers = { ...JSON_HEADERS };
  if (isString(retryAfter) && /^\d{1,6}$/.test(retryAfter.trim())) headers["Retry-After"] = retryAfter.trim();
  const type = status >= 500 ? "provider_error" : status === 429 ? "rate_limit_error" : status === 401 || status === 403 ? "authentication_error" : "invalid_request_error";
  return new Response(JSON.stringify({ error: { code, message: sanitizeErrorMessageWithSecrets(message, secrets), type } }), { status, headers });
}

const sse = (payload) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
const DONE = encoder.encode("data: [DONE]\n\n");

function chunkOf(meta, delta, finish = null, extra = {}) {
  return { id: meta.id, object: "chat.completion.chunk", created: meta.created, model: meta.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra };
}

/** Source openAiCompletion. */
function completionOf(meta, content, toolCalls, usage) {
  const message = { role: "assistant", content };
  if (toolCalls?.length) message.tool_calls = toolCalls;
  return {
    id: meta.id, object: "chat.completion", created: meta.created, model: meta.model,
    choices: [{ index: 0, message, finish_reason: toolCalls?.length ? "tool_calls" : "stop" }],
    usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/** Tool-mode SSE (source pumpToolSse): one tool_calls delta, or the buffered text. */
function bufferedStream(meta, completion) {
  const { message, finish_reason: finish } = completion.choices[0];
  return new ReadableStream({
    start(controller) {
      controller.enqueue(sse(chunkOf(meta, { role: "assistant" })));
      if (message.tool_calls) controller.enqueue(sse(chunkOf(meta, { tool_calls: message.tool_calls.map((call, index) => ({ ...call, index })) })));
      else if (message.content) controller.enqueue(sse(chunkOf(meta, { content: message.content })));
      controller.enqueue(sse(chunkOf(meta, {}, finish, { usage: completion.usage })));
      controller.enqueue(DONE);
      controller.close();
    },
  });
}

/** Map a non-complete SSE read to `{ status, code, message }`. */
function readFailure(read) {
  switch (read.outcome) {
    case "upstream-error": return { status: 502, code: "syntx_stream_error", message: `${SYNTX_MESSAGES.streamError}: ${read.error}` };
    case "timeout": return { status: 504, code: "syntx_timeout", message: SYNTX_MESSAGES.timeout };
    case "idle": return { status: 504, code: "syntx_timeout", message: SYNTX_MESSAGES.idle };
    case "too-large": return { status: 502, code: "syntx_upstream_error", message: SYNTX_MESSAGES.tooLarge };
    case "aborted": return { status: CLIENT_CLOSED, code: "syntx_aborted", message: SYNTX_MESSAGES.aborted };
    case "read-error": return { status: 502, code: "syntx_stream_failed", message: SYNTX_MESSAGES.streamFailed };
    default: return { status: 502, code: "syntx_truncated", message: SYNTX_MESSAGES.truncated };
  }
}

function generateFailure(status, text) {
  if (status === 401 || status === 403) return { status: 401, code: "syntx_auth_error", message: SYNTX_MESSAGES.auth };
  if (status === 429) return { status: 429, code: "syntx_rate_limited", message: `SYNTX error: ${text}` };
  return { status: status >= 400 && status < 600 ? status : 502, code: "syntx_upstream_error", message: `SYNTX error: ${text}` };
}

function trimAccountPrompt(prompt) {
  const slice = prompt.slice(0, SYNTX_ACCOUNT_SYSTEM_PROMPT_MAX_CHARS);
  const nl = slice.lastIndexOf("\n");
  return (nl >= SYNTX_ACCOUNT_SYSTEM_PROMPT_MAX_CHARS / 2 ? slice.slice(0, nl) : slice).trimEnd();
}

/** Turn events buffered until a stream subscribes; `ready` resolves on the first delta. */
function createEventHub() {
  const buffered = [];
  let listener = null;
  let output = false;
  let markReady;
  const ready = new Promise((resolve) => {
    markReady = resolve;
  });
  return {
    ready,
    get hasOutput() {
      return output;
    },
    push(text) {
      output = true;
      markReady();
      if (listener) listener(text);
      else buffered.push(text);
    },
    subscribe(fn) {
      for (const text of buffered.splice(0)) fn(text);
      listener = fn;
    },
  };
}

export class SyntxChatExecutor extends BaseExecutor {
  /**
   * @param {object} [options]
   * @param {Function} [options.fetchImpl] - transport for every SYNTX call (tests); default is the proxy-aware fetch
   * @param {Function} [options.lookup] - DNS lookup for client image hosts (tests)
   * @param {boolean} [options.emulateTools] - source OMNIROUTE_PROMPT_EMULATE_TOOLS, default on
   */
  constructor({
    fetchImpl, lookup, sessions, catalog, emulateTools = true, now = Date.now,
    timeoutMs = SYNTX_REQUEST_TIMEOUT_MS, auxTimeoutMs = SYNTX_AUX_TIMEOUT_MS, idleTimeoutMs = SYNTX_IDLE_TIMEOUT_MS,
    maxStreamBytes = SYNTX_MAX_STREAM_BYTES,
  } = {}) {
    super(SYNTX_PROVIDER_ID, { id: SYNTX_PROVIDER_ID, baseUrl: SYNTX_API_BASE, timeoutMs });
    this.fetchImpl = isFunction(fetchImpl) ? fetchImpl : null;
    this.lookup = lookup;
    this.sessions = sessions ?? createSyntxSessionStore({ now });
    this.catalog = catalog ?? createSyntxModelCatalog({ now });
    this.emulateTools = emulateTools;
    this.bounds = { timeoutMs, auxTimeoutMs, idleTimeoutMs, maxStreamBytes };
  }

  getTimeoutMs() {
    return this.bounds.timeoutMs;
  }

  /** One auxiliary call: own deadline, never follows a redirect unless the caller says so. */
  request(url, init, { signal, proxyOptions, timeoutMs = this.bounds.auxTimeoutMs } = {}) {
    const signals = [AbortSignal.timeout(timeoutMs), signal].filter(Boolean);
    const options = { redirect: "error", ...init, signal: AbortSignal.any(signals) };
    if (this.fetchImpl) return this.fetchImpl(url, options);
    return proxyFetch.proxyAwareFetch(url, options, proxyOptions);
  }

  /** Source discoverSyntxModels for one account (live list; throws on failure). */
  async discoverModels(credentials, { signal, proxyOptions } = {}) {
    const token = resolveSyntxToken(credentials ?? {});
    if (!looksLikeJwt(token)) throw new SyntxStepError(401, "syntx_unconfigured", SYNTX_MESSAGES.unconfigured);
    return this.catalog.discover({
      token,
      headers: syntxAuthHeaders(token),
      request: async (url, init) => {
        const response = await this.request(url, init, { signal, proxyOptions });
        return { ok: response.ok, status: response.status, json: () => readBoundedJson(response) };
      },
    });
  }

  async execute(input) {
    if (input?.signal?.aborted) throw requestAbortError(input.signal.reason);
    const sender = createExecutorSender(this, input, { observePatchedFetch: false });
    return withBillableDispatch(sender, (billed) => this.runChat(input, sender, billed));
  }

  async runChat(input, sender, billed) {
    const { body, credentials, signal, log, proxyOptions } = input;
    const bodyObj = isRecord(body) ? body : {};
    const requestedModel = input.model || str(bodyObj.model) || "auto";
    const modelId = mapSyntxModel(requestedModel);
    const token = resolveSyntxToken({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken, providerSpecificData: credentials?.providerSpecificData });
    const secrets = syntxSecrets(credentials, token);
    const ctx = { url: SYNTX_GENERATE_PATH, generateBody: null };
    const fail = (failure, acceptedTurn = null) => {
      const result = {
        response: errorResponse(failure, secrets),
        url: ctx.url,
        headers: { authorization: "Bearer <redacted>" },
        transformedBody: ctx.generateBody,
      };
      if (acceptedTurn) result.acceptedTurn = acceptedTurn;
      return result;
    };

    if (!looksLikeJwt(token)) return fail({ status: 401, code: "syntx_unconfigured", message: SYNTX_MESSAGES.unconfigured });
    const messages = normalizeSyntxRequestMessages(bodyObj);
    const session = this.resolveSession(bodyObj, messages, token, modelId, credentials?.connectionId);
    const generated = this.composeText(bodyObj, session);
    let text = generated.text;
    const historyFile = str(bodyObj.syntx_history_file);
    if (!text && !historyFile) return fail({ status: 400, code: "syntx_empty_request", message: SYNTX_MESSAGES.empty });

    const deadline = AbortSignal.timeout(this.bounds.timeoutMs);
    const turnSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const aux = (url, init, extra = {}) => this.request(url, init, { signal: turnSignal, proxyOptions, ...extra });
    const abortedOrNull = () => {
      if (signal?.aborted) throw requestAbortError(signal.reason);
      return deadline.aborted ? { status: 504, code: "syntx_timeout", message: SYNTX_MESSAGES.timeout } : null;
    };

    // 1. chat_uuid
    let chatUuid = session.chatUuid;
    try {
      if (!chatUuid) chatUuid = await this.ensureChat({ session, token, bodyObj, text, modelId, aux });
      if (chatUuid && !session.isolated && !session.sessionReset) {
        this.sessions.rememberPending(session.fingerprint, modelId, session.sessionMessages, chatUuid);
      }
    } catch (error) {
      ctx.url = SYNTX_CHATS_URL;
      const timedOut = abortedOrNull();
      if (timedOut) return fail(timedOut);
      log?.warn?.("SYNTX", `create chat failed (${error?.code ?? "error"})`);
      if (error instanceof SyntxStepError) return fail({ status: error.status, code: error.code, message: error.message });
      return fail({ status: 502, code: "syntx_create_chat_failed", message: SYNTX_MESSAGES.createFailed });
    }

    // 2. uploads (source: image failures are skipped; a history-file failure is 422)
    const files = [];
    const lastUser = lastUserMessage(session.sessionMessages) || lastUserMessage(messages);
    for (const source of collectSyntxImageSources(lastUser?.content).slice(0, SYNTX_MAX_IMAGES)) {
      try {
        const url = await this.uploadImage(token, source, aux);
        if (url) files.push({ object_type: "image", object_url: url });
      } catch {
        const timedOut = abortedOrNull();
        if (timedOut) return fail(timedOut);
        log?.warn?.("SYNTX", "image upload skipped");
      }
    }
    if (historyFile) {
      let uploaded = null;
      try {
        uploaded = await this.uploadBytes(token, {
          bytes: new TextEncoder().encode(historyFile),
          mime: "text/plain; charset=utf-8",
          name: str(bodyObj.syntx_history_filename) || "tmp.txt",
        }, aux);
      } catch {
        const timedOut = abortedOrNull();
        if (timedOut) return fail(timedOut);
      }
      if (!uploaded) {
        ctx.url = SYNTX_UPLOAD_URL;
        return fail({ status: 422, code: "syntx_history_upload_failed", message: SYNTX_MESSAGES.historyUpload });
      }
      files.push({ object_type: uploaded.objectType || "file", object_url: uploaded.url });
      if (session.isolated || session.wantContinue) text = str(bodyObj.syntx_history_prompt) || SYNTX_FILE_COMPACT_PROMPT;
    }
    if (!text) return fail({ status: 400, code: "syntx_empty_request", message: SYNTX_MESSAGES.empty });

    // 3. generate (the one quota-bearing send; never repeated)
    const emptyClientTools = Array.isArray(bodyObj.tools) && bodyObj.tools.length === 0;
    const nativeTools = !emptyClientTools && !(session.isolated && !session.deepResearch);
    ctx.generateBody = buildSyntxGenerateBody({
      chatUuid, text, model: modelId, thinking: wantSyntxThinking(bodyObj, modelId), deepResearch: session.deepResearch, nativeTools, files,
    });
    ctx.url = `${SYNTX_GENERATE_PATH}?ai_name=${encodeURIComponent(inferSyntxAiName(modelId))}`;
    const init = {
      method: "POST",
      headers: { ...syntxAuthHeaders(token), "content-type": "application/json" },
      body: JSON.stringify(ctx.generateBody),
      signal: turnSignal,
    };
    let generateResponse;
    try {
      generateResponse = await billed(await sender.sendRequest(ctx.url, init, proxyOptions,
        this.fetchImpl ? { transport: (options) => this.fetchImpl(ctx.url, { ...init, ...options, redirect: "error" }) } : {}));
    } catch (error) {
      if (signal?.aborted) throw requestAbortError(signal.reason);
      const timedOut = deadline.aborted || sender.timeoutReason;
      log?.warn?.("SYNTX", `generate ${timedOut ? "timed out" : "failed"}`);
      return fail({ status: timedOut ? 504 : 502, code: "syntx_generate_uncertain", message: SYNTX_MESSAGES.generateUncertain },
        { state: "uncertain", outcome: timedOut ? "timeout" : "transport-error" });
    } finally {
      sender.clearHeaderTimer?.();
    }
    if (!generateResponse.ok) {
      const errText = await readErrorText(generateResponse);
      const failure = generateFailure(generateResponse.status, errText);
      if (failure.status === 429) failure.retryAfter = generateResponse.headers.get("retry-after") ?? undefined;
      log?.warn?.("SYNTX", `generate HTTP ${generateResponse.status}`);
      return fail(failure, generateResponse.status >= 500 ? { state: "uncertain", outcome: `http-${generateResponse.status}` } : null);
    }
    let streamUrl = "";
    try {
      streamUrl = str((await readBoundedJson(generateResponse))?.stream_url);
    } catch {
      // handled below as an invalid stream URL
    }
    if (!isSyntxStreamUrl(streamUrl)) {
      return fail({ status: 502, code: "syntx_invalid_stream_url", message: SYNTX_MESSAGES.invalidStreamUrl }, { state: "accepted", outcome: "invalid-stream-url" });
    }
    this.sessions.markGeneratePosted(chatUuid);
    const accepted = (outcome) => ({ state: "accepted", outcome });

    // 4. stream_url (no auth header, as in the source)
    const turnAbort = new AbortController();
    const streamSignal = AbortSignal.any([turnSignal, turnAbort.signal]);
    let upstream;
    try {
      upstream = await this.openStream(streamUrl, streamSignal, proxyOptions);
    } catch {
      if (signal?.aborted) throw requestAbortError(signal.reason);
      const timedOut = abortedOrNull();
      return fail(timedOut ?? { status: 502, code: "syntx_stream_failed", message: SYNTX_MESSAGES.streamFailed }, accepted("stream-open-failed"));
    }
    if (!upstream.ok) {
      await readErrorText(upstream);
      log?.warn?.("SYNTX", `stream HTTP ${upstream.status}`);
      return fail({ status: 502, code: "syntx_stream_failed", message: `${SYNTX_MESSAGES.streamFailed}: HTTP ${upstream.status}` }, accepted(`stream-http-${upstream.status}`));
    }

    const meta = { id: `chatcmpl-syntx-${Date.now()}`, created: Math.floor(Date.now() / 1000), model: str(bodyObj.model) || requestedModel };
    const hasTools = (Array.isArray(bodyObj.tools) && bodyObj.tools.length > 0) || messagesHaveSyntxToolTraffic(messages);
    const persist = (assistantText) => this.persistSession({ session, modelId, chatUuid, generated, assistantText });
    const readOptions = { signal, deadline, idleMs: this.bounds.idleTimeoutMs, maxBytes: this.bounds.maxStreamBytes };
    const ok = (response) => ({ response, url: ctx.url, headers: { authorization: "Bearer <redacted>" }, transformedBody: ctx.generateBody });

    if (hasTools || !input.stream) {
      const read = await readSyntxSse(upstream, readOptions);
      if (read.outcome !== "complete") {
        if (read.outcome === "aborted" && signal?.aborted) throw requestAbortError(signal.reason);
        log?.warn?.("SYNTX", `stream ${read.outcome}`);
        return fail(readFailure(read), accepted(read.outcome));
      }
      persist(read.text);
      const parsed = hasTools ? parseSyntxToolCalls(read.text) : { calls: [], content: read.text };
      const completion = completionOf(meta, parsed.calls.length > 0 ? parsed.content || null : read.text, parsed.calls, read.usage);
      return ok(input.stream
        ? new Response(bufferedStream(meta, completion), { status: 200, headers: SSE_HEADERS })
        : new Response(JSON.stringify(completion), { status: 200, headers: JSON_HEADERS }));
    }

    // Plain stream: commit to a 200 only once SYNTX produced output or the turn ended.
    const hub = createEventHub();
    const turn = readSyntxSse(upstream, { ...readOptions, signal: streamSignal, onDelta: (delta) => hub.push(delta) });
    const first = await Promise.race([hub.ready.then(() => null), turn]);
    if (first && !hub.hasOutput && first.outcome !== "complete") {
      if (first.outcome === "aborted" && signal?.aborted) throw requestAbortError(signal.reason);
      log?.warn?.("SYNTX", `stream ${first.outcome}`);
      return fail(readFailure(first), accepted(first.outcome));
    }
    return ok(new Response(this.liveStream({ meta, hub, turn, turnAbort, persist, secrets, log }), { status: 200, headers: SSE_HEADERS }));
  }

  liveStream({ meta, hub, turn, turnAbort, persist, secrets, log }) {
    let closed = false;
    return new ReadableStream({
      start: (controller) => {
        const put = (bytes) => {
          if (closed) return;
          try {
            controller.enqueue(bytes);
          } catch {
            closed = true;
          }
        };
        const end = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        put(sse(chunkOf(meta, { role: "assistant" })));
        hub.subscribe((delta) => put(sse(chunkOf(meta, { content: delta }))));
        turn.then((read) => {
          if (closed) return;
          if (read.outcome === "aborted") return end();
          if (read.outcome !== "complete") {
            const failure = readFailure(read);
            log?.warn?.("SYNTX", `stream ${read.outcome} after output`);
            put(sse(chunkOf(meta, {}, "error", { error: { code: failure.code, message: sanitizeErrorMessageWithSecrets(failure.message, secrets), type: "provider_error" } })));
            put(DONE);
            return end();
          }
          persist(read.text);
          put(sse(chunkOf(meta, {}, "stop", read.usage ? { usage: read.usage } : {})));
          put(DONE);
          end();
        });
      },
      cancel: () => {
        closed = true;
        turnAbort.abort();
      },
    });
  }

  /** Source openSyntxStream: GET with SSE headers and the site referer, no Authorization. */
  async openStream(streamUrl, streamSignal, proxyOptions) {
    // The header deadline is the auxiliary deadline; the body is bounded by the idle timer and turn deadline.
    const headerAbort = new AbortController();
    const timer = setTimeout(() => headerAbort.abort(), this.bounds.auxTimeoutMs);
    try {
      const init = {
        method: "GET",
        redirect: "error",
        headers: { accept: "text/event-stream", "cache-control": "no-cache", referer: SYNTX_SITE },
        signal: AbortSignal.any([streamSignal, headerAbort.signal]),
      };
      return this.fetchImpl ? await this.fetchImpl(streamUrl, init) : await proxyFetch.proxyAwareFetch(streamUrl, init, proxyOptions);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Source resolveSyntxSession. */
  resolveSession(bodyObj, messages, token, modelId, connectionId) {
    const fingerprint = connectionFingerprint(token, connectionId);
    const deepResearch = bodyObj.syntx_deep_research === true;
    const isolated = bodyObj.syntx_isolated === true || bodyObj.syntx_force_new_chat === true || deepResearch;
    const continueFirst = canonicalizeSyntxUserText(str(bodyObj.syntx_continue_first_user));
    const wantContinue = bodyObj.syntx_continue_chat === true && Boolean(continueFirst);
    const sessionReset = looksLikeClaudeCodeSessionReset(lastUserTextForReset(messages));
    const sessionMessages = sessionReset ? syntxMessagesForNewSession(messages) : messages;
    let chatUuid = null;
    if (!isolated && !sessionReset) {
      chatUuid = this.sessions.lookupForMessages(fingerprint, modelId, messages);
      if (!chatUuid && wantContinue) chatUuid = this.sessions.lookupContinue(fingerprint, modelId, continueFirst);
    }
    const threadRollover = !isolated && !sessionReset && !wantContinue && Boolean(chatUuid) && this.sessions.shouldRollover(chatUuid);
    if (threadRollover) chatUuid = null;
    const posted = Boolean(chatUuid) && this.sessions.hasGeneratePosted(chatUuid);
    const virginChat = Boolean(chatUuid) && !posted && this.sessions.generateCount(chatUuid) === 0;
    const reuseChat = Boolean(chatUuid) && !virginChat && !threadRollover;
    const toolsFingerprint = syntxToolCatalogFingerprint(bodyObj.tools);
    const priorToolsFp = chatUuid ? this.sessions.injectedToolsFingerprint(chatUuid) : null;
    const catalogChanged = Boolean(toolsFingerprint && priorToolsFp && priorToolsFp !== toolsFingerprint);
    return {
      fingerprint, isolated, deepResearch, continueFirst, wantContinue, sessionReset, sessionMessages, chatUuid,
      threadRollover, reuseChat, toolsFingerprint, priorToolsFp, catalogChanged,
      omitClientSystem: Boolean(str(bodyObj.syntx_account_system_prompt)),
    };
  }

  /** Source composeSyntxText. */
  composeText(bodyObj, session) {
    const generated = buildSyntxGenerateText({
      messages: session.sessionMessages,
      tools: session.isolated || session.sessionReset ? undefined : bodyObj.tools,
      reuseChat: session.reuseChat,
      toolsAlreadyInjected: Boolean(session.reuseChat && session.priorToolsFp && !session.catalogChanged),
      emulateTools: this.emulateTools,
      threadRollover: session.threadRollover,
      omitClientSystem: session.omitClientSystem && !session.reuseChat,
    });
    const passwordBlock = str(bodyObj.syntx_session_password_block);
    if (!passwordBlock || session.reuseChat) return generated;
    return { ...generated, text: capSyntxGenerateText(`${passwordBlock}\n\n${generated.text}`.trim()) };
  }

  /** Source ensureSyntxChat: account prompt sync, then a coalesced create. */
  async ensureChat({ session, token, bodyObj, text, modelId, aux }) {
    const title = firstCanonicalSyntxUserText(session.sessionMessages) || lastUserText(session.sessionMessages) ||
      (session.threadRollover ? "Continued SYNTX thread" : text);
    const create = () => this.createChat(token, title, aux);
    if (session.isolated || session.sessionReset) return create();
    await this.syncAccountSystemPrompt(token, bodyObj, aux);
    return this.sessions.coalesceCreate(hashSyntxConversation(session.fingerprint, modelId, session.sessionMessages), create);
  }

  /** Source createSyntxChat: POST /api/v1/chats {title, scope:"text"} -> {uuid}. */
  async createChat(token, title, aux) {
    const response = await aux(SYNTX_CHATS_URL, {
      method: "POST",
      headers: { ...syntxAuthHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ title: chatTitleFromText(title), scope: "text" }),
    });
    if (!response.ok) {
      await readErrorText(response);
      if (response.status === 401 || response.status === 403) throw new SyntxStepError(401, "syntx_auth_error", SYNTX_MESSAGES.auth);
      throw new SyntxStepError(502, "syntx_create_chat_failed", `${SYNTX_MESSAGES.createFailed}: HTTP ${response.status}`);
    }
    const uuid = str((await readBoundedJson(response))?.uuid).trim();
    if (!uuid || uuid.length > 128 || !/^[A-Za-z0-9-]+$/.test(uuid)) {
      throw new SyntxStepError(502, "syntx_create_chat_failed", `${SYNTX_MESSAGES.createFailed}: no uuid`);
    }
    return uuid;
  }

  /** Source syncSyntxAccountSystemPrompt: best-effort PUT /api/v1/user/settings. */
  async syncAccountSystemPrompt(token, bodyObj, aux) {
    let prompt = str(bodyObj.syntx_account_system_prompt);
    const disable = bodyObj.syntx_disable_account_system_prompt === true;
    if (!prompt && !disable) return;
    if (prompt.length > SYNTX_ACCOUNT_SYSTEM_PROMPT_MAX_CHARS) prompt = trimAccountPrompt(prompt);
    const payload = disable
      ? { user: { text: { system_prompt_enabled: { default: false } } } }
      : { user: { text: { system_prompt: { default: prompt } } } };
    try {
      const response = await aux(SYNTX_SETTINGS_URL, {
        method: "PUT",
        headers: { ...syntxAuthHeaders(token), "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      await readErrorText(response);
    } catch {
      // best-effort, as in the source
    }
  }

  /** Source uploadSyntxBytes: multipart POST /api/v1/chats/upload-files -> files[0].url. */
  async uploadBytes(token, file, aux) {
    if (!file.bytes || file.bytes.byteLength === 0 || file.bytes.byteLength > SYNTX_MAX_UPLOAD_BYTES) return null;
    const encoded = encodeSyntxUploadMultipart({ bytes: file.bytes, name: file.name || "tmp.txt", mime: file.mime || "application/octet-stream" });
    const response = await aux(SYNTX_UPLOAD_URL, {
      method: "POST",
      headers: { ...syntxAuthHeaders(token), "content-type": encoded.contentType },
      body: encoded.body,
    });
    if (!response.ok) {
      await readErrorText(response);
      return null;
    }
    const json = await readBoundedJson(response);
    const first = isRecord(json) && Array.isArray(json.files) && isRecord(json.files[0]) ? json.files[0] : {};
    const url = str(first.url);
    // Fork: a returned file URL must be https on a syntx.ai host before it is sent back in generate.
    if (!isSyntxFileUrl(url)) return null;
    const objectType = str(first.object_type) || str(first.type) || (String(file.mime).startsWith("image/") ? "image" : "file");
    return { url, objectType };
  }

  /** Source uploadSyntxImage + resolveImageBytes, with the guarded download. */
  async uploadImage(token, source, aux) {
    const url = str(source.url);
    if (url.startsWith(SYNTX_UPLOADED_FILE_PREFIX) && isSyntxFileUrl(url)) return url;
    let resolved = null;
    if (isDataImageUrl(url)) resolved = decodeDataUrl(url);
    else if (url.startsWith("https://")) {
      resolved = await fetchGuardedImage(url, {
        lookup: this.lookup,
        request: (target, init) => aux(target, init),
      });
    } else if (url) throw new SyntxTransportError("blocked-url", "unsupported image URL scheme");
    if (!resolved) return null;
    const uploaded = await this.uploadBytes(token, resolved, aux);
    return uploaded?.url || null;
  }

  /** Source persistSyntxSession: after a complete turn only. */
  persistSession({ session, modelId, chatUuid, generated, assistantText }) {
    if (session.isolated) return;
    this.sessions.forgetPendingExact(session.fingerprint, modelId, session.sessionMessages);
    this.sessions.noteGenerate(chatUuid);
    const rememberMsgs = session.wantContinue && session.continueFirst ? [{ role: "user", content: session.continueFirst }] : session.sessionMessages;
    this.sessions.rememberFollowUp(session.fingerprint, modelId, rememberMsgs, assistantText, chatUuid);
    if (generated.injectedCatalog) this.sessions.rememberInjectedTools(chatUuid, session.toolsFingerprint || "injected");
  }
}

/** https URL on syntx.ai or a subdomain, no credentials or explicit port. */
export function isSyntxFileUrl(url) {
  if (!isString(url) || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port &&
      (host === "syntx.ai" || host.endsWith(".syntx.ai"));
  } catch {
    return false;
  }
}

/** A new executor; registration creates one per process. */
export const createSyntxChatExecutor = (options) => new SyntxChatExecutor(options);
