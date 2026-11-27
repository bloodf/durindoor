// UC persona chat executor (BaseExecutor execute contract), staged and not
// registered (see ./registration.json). Port of OmniRoute c71f0065
// open-sse/executors/uc.ts (UcExecutor).
//
// One turn: check the opt-in and the selected connection's signed-in
// metadata, get that account's scoped Clerk JWT from the staged sign-in
// session controller, open one socket, send one persona frame, and answer in
// the OpenAI chat contract: live SSE (role, reasoning_content, content, a
// terminal finish with estimated usage, [DONE]) or one chat.completion. With
// tools, the turn is buffered and `<tool>` / `<tool_call>` / code-style /
// `<tool_code>` calls become tool_calls with `uc_<n>` ids (source idSeed).
//
// Fork deviations:
//   - opt-in env plus sign-in metadata are required; an API key, a Bearer
//     header or the uc-direct backend are never used;
//   - a Clerk mint 401/403 (any body, including a challenge code) is a
//     re-login, 401 uc_auth_error, as in the source (clerkAuth.ts:85-87,
//     uc.ts:198); a socket 401/403 or an unauthorized error frame is also
//     401 and drops only that account's cached JWT; nothing retries;
//   - a session-controller `needs_operator` result (sign-in challenge or MFA,
//     never produced by a mint) is a fork-only 403 uc_auth_challenge;
//   - no replay of any kind: the source's code-style retry after a refusal is
//     not run, and every failure after the frame left carries `acceptedTurn`
//     (`accepted` once UC answered with any frame, else `uncertain`);
//   - a stream waits for UC's first answer frame before it commits to a 200,
//     so quota, auth and soft errors before any output are HTTP errors; a
//     failure after output ends the stream with finish_reason "error";
//   - a socket that closes before end_of_stream is a failure, not a success;
//   - the streamed remainder after raw_text is emitted only when raw_text
//     extends the streamed deltas (the source could repeat the whole answer);
//   - media input is refused (the blob upload path is not ported);
//   - tool-mode SSE keeps reasoning and usage, and numbers tool-call deltas.
import { BaseExecutor } from "../../../executors/base.js";
import { createExecutorSender, requestAbortError, withBillableDispatch } from "../../../executors/sendRequest.js";
import { prepareToolMessages, buildToolAwareResult, parseToolCallsFromText } from "../../../translator/webTools.js";
import { sanitizeErrorMessageWithSecrets } from "../../../utils/error.js";
import { resolveWebSocketProxyRoute } from "../../../utils/proxyFetch.js";
import { isFunction, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { createUcSessionController } from "../native-uc-signin/session.js";
import { resolveUcCredential, ucSecrets } from "../native-uc-tts/credentials.js";
import {
  UC_CHAT_AUTH_SOURCES, UC_CHAT_BASE_URL, UC_CHAT_MESSAGES, UC_CHAT_PROVIDER_ID, UC_ORIGIN, UC_TOKEN_REFRESH_SKEW_MS, UC_WS_TIMEOUT_MS,
  isUcChatEnabled,
} from "./config.js";
import { resolveUcChatModel } from "./catalog.js";
import { assembleUcTurn, buildPersonaFrame, currentTurnHasMedia } from "./protocol.js";
import { detectUcSoftError, estimateUcTokens } from "./stream.js";
import { applyCodestylePreamble, injectExtraDialectCalls, ucUsesCodestyle } from "./toolDialect.js";
import { buildUcWsUrl, runUcTurn } from "./ws.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const SSE_HEADERS = { "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "Content-Type": "text/event-stream; charset=utf-8" };
const CLIENT_CLOSED = 499;
const TOOL_ID_SEED = "uc";
const encoder = new TextEncoder();

/**
 * The selected connection's credential when its metadata was written by the
 * staged sign-in module (accepted `ucAuthSource` and a valid `ucSignedInAt`), else null.
 */
export function resolveUcChatCredential(credentials) {
  const psd = isRecord(credentials?.providerSpecificData) ? credentials.providerSpecificData : null;
  if (!psd || !UC_CHAT_AUTH_SOURCES.includes(psd.ucAuthSource)) return null;
  if (!isString(psd.ucSignedInAt) || !Number.isFinite(Date.parse(psd.ucSignedInAt))) return null;
  return resolveUcCredential(credentials);
}

/** Source classifyTurnError, keyed on the frame code first, then on the text. */
export function classifyUcTurnError(code, text = "") {
  const low = `${code ?? ""} ${text}`.toLowerCase();
  if (low.includes("message_limit_exceeded")) return { status: 429, code: "uc_message_limit_exceeded" };
  if (low.includes("paywall_exceeded")) return { status: 429, code: "uc_paywall_exceeded" };
  if (low.includes("rate_limit_exceeded")) return { status: 429, code: "uc_rate_limit_exceeded" };
  if (low.includes("unauthorized") || low.includes("forbidden")) return { status: 401, code: "uc_auth_error" };
  if (low.includes("generation_failed")) return { status: 502, code: "uc_generation_failed" };
  return { status: 502, code: "uc_upstream_error" };
}

/** Map a non-complete socket result to `{ status, code, message, auth? }`. */
function socketFailure(run) {
  if (run.outcome === "upstream-error") {
    const c = classifyUcTurnError(run.errorCode, run.error);
    return { ...c, message: `UC persona turn failed: ${run.error}`, auth: c.status === 401 };
  }
  if (run.outcome === "handshake") {
    const s = run.handshakeStatus;
    if (s === 401 || s === 403) return { status: 401, code: "uc_auth_error", message: UC_CHAT_MESSAGES.socketAuth, auth: true };
    if (s === 429) return { status: 429, code: "uc_rate_limit_exceeded", message: UC_CHAT_MESSAGES.rateLimited, retryAfter: run.retryAfter };
    return { status: 502, code: "uc_upstream_error", message: `UC persona socket was refused with ${s}` };
  }
  switch (run.outcome) {
    case "aborted": return { status: CLIENT_CLOSED, code: "uc_aborted", message: "UC persona request aborted" };
    case "timeout": return run.sent ? { status: 504, code: "uc_timeout", message: UC_CHAT_MESSAGES.timeout } : { status: 504, code: "uc_timeout", message: UC_CHAT_MESSAGES.handshakeTimeout };
    case "idle": return { status: 504, code: "uc_timeout", message: UC_CHAT_MESSAGES.idle };
    case "too-large": return { status: 502, code: "uc_upstream_error", message: UC_CHAT_MESSAGES.tooLarge };
    case "closed": return { status: 502, code: "uc_truncated", message: UC_CHAT_MESSAGES.closed };
    case "send-failed": return { status: 502, code: "uc_upstream_error", message: UC_CHAT_MESSAGES.sendFailed };
    default: return { status: 502, code: "uc_upstream_error", message: UC_CHAT_MESSAGES.connect };
  }
}

/**
 * Session-controller failure -> `{ status, code, message, retryAfter? }`; null for an abort.
 * The controller maps a mint 401/403 to `reauth` (source clerkAuth.ts:85-87).
 */
function mintFailure(token) {
  switch (token.kind) {
    case "aborted": return null;
    case "disabled": return { status: 403, code: "uc_disabled", message: UC_CHAT_MESSAGES.disabled };
    case "invalid_credential": return { status: 401, code: "uc_unconfigured", message: UC_CHAT_MESSAGES.unconfigured };
    case "reauth": return { status: 401, code: "uc_auth_error", message: UC_CHAT_MESSAGES.reauth };
    case "needs_operator": return { status: 403, code: "uc_auth_challenge", message: UC_CHAT_MESSAGES.challenge };
    case "identity": return { status: 401, code: "uc_identity", message: UC_CHAT_MESSAGES.identity };
    case "rate_limited": return { status: 429, code: "uc_rate_limit_exceeded", message: UC_CHAT_MESSAGES.rateLimited, retryAfter: token.retryAfter };
    case "timeout": return { status: 504, code: "uc_timeout", message: UC_CHAT_MESSAGES.mintTimeout };
    default: return { status: 502, code: "uc_auth_upstream_error", message: UC_CHAT_MESSAGES.mintFailed };
  }
}

function errorResponse({ status, code, message, retryAfter }, secrets) {
  const headers = { ...JSON_HEADERS };
  if (isString(retryAfter) && /^\d{1,6}$/.test(retryAfter.trim())) headers["Retry-After"] = retryAfter.trim();
  const body = {
    error: {
      code,
      message: sanitizeErrorMessageWithSecrets(message, secrets),
      type: status >= 500 ? "provider_error" : status === 429 ? "rate_limit_error" : "invalid_request_error",
    },
  };
  return new Response(JSON.stringify(body), { status, headers });
}

const sse = (payload) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
const DONE = encoder.encode("data: [DONE]\n\n");

function chunkOf(meta, delta, finish = null, extra = {}) {
  return { id: meta.id, object: "chat.completion.chunk", created: meta.created, model: meta.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra };
}

function usageOf(promptTokens, completionText) {
  const completion = estimateUcTokens(completionText);
  return { prompt_tokens: promptTokens, completion_tokens: completion, total_tokens: promptTokens + completion };
}

function completionOf(meta, message, finish, usage) {
  return { id: meta.id, object: "chat.completion", created: meta.created, model: meta.model, choices: [{ index: 0, message, finish_reason: finish }], usage };
}

/** A tool-mode answer: `{ message, finish }` with tool_calls parsed from any supported dialect. */
function toolModeMessage(answer, reasoning, requestedTools) {
  const shared = !!parseToolCallsFromText(answer, "probe", requestedTools).toolCalls;
  const unified = injectExtraDialectCalls(answer, requestedTools, shared);
  const { content, toolCalls, finishReason } = buildToolAwareResult(unified, requestedTools, TOOL_ID_SEED);
  const message = toolCalls ? { role: "assistant", content: null, tool_calls: toolCalls } : { role: "assistant", content };
  if (reasoning) message.reasoning_content = reasoning;
  return { message, finish: finishReason };
}

/** Terminal SSE replay of a buffered completion (tool mode). */
function replayStream(meta, completion) {
  const { message, finish_reason: finish } = completion.choices[0];
  return new ReadableStream({
    start(controller) {
      controller.enqueue(sse(chunkOf(meta, { role: "assistant" })));
      if (message.reasoning_content) controller.enqueue(sse(chunkOf(meta, { reasoning_content: message.reasoning_content })));
      if (message.tool_calls) {
        controller.enqueue(sse(chunkOf(meta, { tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })) })));
      } else if (message.content) {
        controller.enqueue(sse(chunkOf(meta, { content: message.content })));
      }
      controller.enqueue(sse(chunkOf(meta, {}, finish, { usage: completion.usage })));
      controller.enqueue(DONE);
      controller.close();
    },
  });
}

async function proxyAgent(url, proxyOptions) {
  const route = resolveWebSocketProxyRoute(url, proxyOptions);
  if (!route.enabled || !route.url) return null;
  try {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    return new HttpsProxyAgent(route.url);
  } catch {
    if (route.strict) throw new Error("proxy unavailable");
    return null;
  }
}

/** Buffers turn events until a stream subscribes, and resolves `ready` on the first answer event. */
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
    push(evt) {
      if (evt.kind === "status") return;
      // Only output commits a stream; a terminal frame ends the turn instead.
      if (evt.kind === "reasoning" || evt.kind === "delta") {
        output = true;
        markReady();
      }
      if (listener) listener(evt);
      else buffered.push(evt);
    },
    subscribe(fn) {
      for (const evt of buffered.splice(0)) fn(evt);
      listener = fn;
    },
  };
}

export class UcChatExecutor extends BaseExecutor {
  /**
   * @param {object} [options]
   * @param {object} [options.sessionController] - a createUcSessionController instance (one per process)
   * @param {object} [options.env] - opt-in source; defaults to process.env at call time
   * @param {Function} [options.fetchImpl] - Clerk transport for the default session controller
   * @param {Function} [options.WebSocketImpl] - socket constructor (tests)
   */
  constructor({ sessionController, env, fetchImpl, WebSocketImpl, timeoutMs = UC_WS_TIMEOUT_MS, handshakeTimeoutMs, idleTimeoutMs, maxFrameBytes, maxTurnBytes, now = Date.now } = {}) {
    super(UC_CHAT_PROVIDER_ID, { id: UC_CHAT_PROVIDER_ID, baseUrl: UC_CHAT_BASE_URL });
    this.envSource = env ?? null;
    this.sessions = sessionController ?? createUcSessionController({
      fetchImpl: fetchImpl ?? ((url, init) => globalThis.fetch(url, init)),
      env: env ?? process.env,
      refreshSkewMs: UC_TOKEN_REFRESH_SKEW_MS,
      now,
    });
    this.turnOptions = {
      timeoutMs,
      ...(handshakeTimeoutMs ? { handshakeTimeoutMs } : null),
      ...(idleTimeoutMs ? { idleTimeoutMs } : null),
      ...(maxFrameBytes ? { maxFrameBytes } : null),
      ...(maxTurnBytes ? { maxTurnBytes } : null),
      ...(WebSocketImpl ? { WebSocketImpl } : null),
    };
  }

  get env() {
    return this.envSource ?? process.env;
  }

  async execute(input) {
    if (input?.signal?.aborted) throw requestAbortError(input.signal.reason);
    const sender = createExecutorSender(this, input, { observePatchedFetch: false });
    return withBillableDispatch(sender, (billed) => this.runChat(input, sender, billed));
  }

  async runChat(input, sender, billed) {
    const { model, body, stream, credentials, signal, log, proxyOptions } = input;
    const url = UC_CHAT_BASE_URL;
    let secrets = ucSecrets(credentials).apiKey;
    let capture = null;
    const fail = (failure, acceptedTurn = null) => ({
      response: errorResponse(failure, secrets),
      url,
      headers: capture?.headers ?? {},
      transformedBody: capture?.transformedBody ?? null,
      ...(acceptedTurn ? { acceptedTurn } : null),
    });

    const modelId = resolveUcChatModel(model);
    if (!modelId) return fail({ status: 400, code: "uc_unknown_model", message: `${UC_CHAT_MESSAGES.unknownModel}: ${String(model).slice(0, 80)}` });
    if (!isUcChatEnabled(this.env)) return fail({ status: 403, code: "uc_disabled", message: UC_CHAT_MESSAGES.disabled });
    const credential = resolveUcChatCredential(credentials);
    if (!credential) return fail({ status: 401, code: "uc_unconfigured", message: UC_CHAT_MESSAGES.unconfigured });
    const messages = isRecord(body) && Array.isArray(body.messages) ? body.messages : null;
    if (!messages || messages.length === 0) return fail({ status: 400, code: "uc_invalid_request", message: UC_CHAT_MESSAGES.noMessages });
    if (currentTurnHasMedia(messages)) return fail({ status: 400, code: "uc_media_unsupported", message: UC_CHAT_MESSAGES.mediaUnsupported });

    const codestyle = ucUsesCodestyle(modelId);
    const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages(body, messages);
    const assembled = assembleUcTurn(effectiveMessages);
    if (!assembled.text) return fail({ status: 400, code: "uc_empty_request", message: UC_CHAT_MESSAGES.empty });
    const text = codestyle && hasTools ? applyCodestylePreamble(assembled.text) : assembled.text;

    const token = await this.sessions.getSessionToken(credentials, { signal });
    if (!token.ok) {
      const failure = mintFailure(token);
      if (!failure) throw requestAbortError(signal?.reason);
      return fail(failure);
    }
    secrets = ucSecrets(credentials, credential, token.jwt).apiKey;
    if (token.rotated) await this.persistRotation(input, token.rotated);

    const wsUrl = buildUcWsUrl(credential.uid, token.jwt);
    let agent;
    try {
      agent = await proxyAgent(wsUrl, proxyOptions);
    } catch {
      return fail({ status: 502, code: "uc_proxy_unavailable", message: UC_CHAT_MESSAGES.proxy });
    }
    const frame = buildPersonaFrame({ model: modelId, text, history: assembled.history, uid: credential.uid });
    capture = { headers: { Origin: UC_ORIGIN }, transformedBody: frame };

    const meta = { id: `chatcmpl-uc-${Date.now().toString(36)}`, created: Math.floor(Date.now() / 1000), model };
    const promptTokens = estimateUcTokens(text);
    const hub = createEventHub();
    const turnAbort = new AbortController();
    let turn = null;
    // Opening the socket and handing it the frame stands in for response headers.
    await billed(await sender.sendRequest(UC_CHAT_BASE_URL, { signal }, proxyOptions, {
      transport: (options) => new Promise((resolve) => {
        turn = runUcTurn({
          ...this.turnOptions,
          url: wsUrl,
          frame,
          agent,
          signal: AbortSignal.any([options.signal, turnAbort.signal]),
          onSent: () => resolve({ turn }),
          onEvent: (evt) => hub.push(evt),
        });
        turn.then(() => resolve({ turn }));
      }),
    }));

    const failTurn = async (run) => {
      if (run.outcome === "aborted" && signal?.aborted) throw requestAbortError(signal.reason);
      const failure = socketFailure(run);
      if (failure.auth) this.sessions.forget(credentials);
      log?.warn?.("UC", `persona turn ${run.outcome}${run.errorCode ? ` (${run.errorCode})` : ""}`);
      return fail(failure, run.sent ? { state: run.received ? "accepted" : "uncertain", outcome: run.outcome } : null);
    };
    const checkAnswer = (run) => {
      const soft = detectUcSoftError(run.content);
      if (soft) return fail({ status: 502, code: "uc_soft_error", message: `${UC_CHAT_MESSAGES.softError}: ${soft}` }, { state: "accepted", outcome: "soft-error" });
      if (!run.content) return fail({ status: 502, code: "uc_empty_response", message: UC_CHAT_MESSAGES.emptyResponse }, { state: "accepted", outcome: "empty" });
      return null;
    };
    const ok = (response) => ({ response, url, headers: capture.headers, transformedBody: capture.transformedBody });

    if (hasTools || !stream) {
      const run = await turn;
      if (run.outcome !== "complete") return failTurn(run);
      const bad = checkAnswer(run);
      if (bad) return bad;
      const usage = usageOf(promptTokens, run.reasoning + run.content);
      if (hasTools) {
        const { message, finish } = toolModeMessage(run.content, run.reasoning, requestedTools);
        const completion = completionOf(meta, message, finish, usage);
        return ok(stream
          ? new Response(replayStream(meta, completion), { status: 200, headers: SSE_HEADERS })
          : new Response(JSON.stringify(completion), { status: 200, headers: JSON_HEADERS }));
      }
      const message = { role: "assistant", content: run.content, ...(run.reasoning ? { reasoning_content: run.reasoning } : null) };
      return ok(new Response(JSON.stringify(completionOf(meta, message, "stop", usage)), { status: 200, headers: JSON_HEADERS }));
    }

    // Stream: commit to a 200 only once UC answered (or the turn ended).
    const first = await Promise.race([hub.ready.then(() => null), turn]);
    if (first && !hub.hasOutput) {
      if (first.outcome !== "complete") return failTurn(first);
      const bad = checkAnswer(first);
      if (bad) return bad;
    }
    return ok(new Response(this.liveStream({ meta, hub, turn, turnAbort, promptTokens, credentials, secrets }), { status: 200, headers: SSE_HEADERS }));
  }

  liveStream({ meta, hub, turn, turnAbort, promptTokens, credentials, secrets }) {
    let streamed = "";
    let reasoning = "";
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
        const failStream = (failure) => {
          const error = { code: failure.code, message: sanitizeErrorMessageWithSecrets(failure.message, secrets), type: "provider_error" };
          put(sse(chunkOf(meta, {}, "error", { error })));
          put(DONE);
          end();
        };
        put(sse(chunkOf(meta, { role: "assistant" })));
        hub.subscribe((evt) => {
          if (evt.kind === "reasoning") {
            reasoning += evt.text;
            put(sse(chunkOf(meta, { reasoning_content: evt.text })));
          } else if (evt.kind === "delta") {
            streamed += evt.text;
            put(sse(chunkOf(meta, { content: evt.text })));
          }
        });
        turn.then((run) => {
          if (closed) return;
          if (run.outcome !== "complete") {
            if (run.outcome === "aborted") return end();
            const failure = socketFailure(run);
            if (failure.auth) this.sessions.forget(credentials);
            return failStream(failure);
          }
          if (!streamed) {
            const soft = detectUcSoftError(run.content);
            if (soft) return failStream({ code: "uc_soft_error", message: UC_CHAT_MESSAGES.softError });
            if (!run.content) return failStream({ code: "uc_empty_response", message: UC_CHAT_MESSAGES.emptyResponse });
          }
          const base = run.content.startsWith(streamed) ? streamed : run.content.startsWith(streamed.trimStart()) ? streamed.trimStart() : null;
          const remainder = base === null ? "" : run.content.slice(base.length);
          if (remainder) put(sse(chunkOf(meta, { content: remainder })));
          const answer = base === null ? streamed : run.content;
          put(sse(chunkOf(meta, {}, "stop", { usage: usageOf(promptTokens, reasoning + answer) })));
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

  /** Hand a rotated cookie jar back for this same connection only. */
  async persistRotation(input, rotated) {
    if (!isFunction(input.onCredentialsRefreshed)) return;
    const credentials = input.credentials ?? {};
    try {
      await input.onCredentialsRefreshed({ ...credentials, providerSpecificData: { ...credentials.providerSpecificData, ...rotated } });
    } catch {
      input.log?.warn?.("UC", "rotated cookie persist failed");
    }
  }
}

/** A new executor; registration creates one per process. */
export const createUcChatExecutor = (options) => new UcChatExecutor(options);
