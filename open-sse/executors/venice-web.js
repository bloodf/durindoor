// Venice Web executor. STAGED: not in the executor map yet; see
// docs/providers/venice-web.md.
//
// Wire contract ported from cheaper-inference/OmniRoute (MIT) at
// 9671192011beb2d7f83979f40be488c5da8772b9, open-sse/executors/venice-web.ts and
// venice-web-auth.ts: the Clerk `__client` cookie buys a short-lived session JWT,
// which authorizes one chat POST answered as newline-delimited JSON events.
//
// Where this port is stricter than the source: redirects are never followed;
// input it would drop (tools, images) is refused; an answer without text or with
// a damaged event is an error; and upstream error text is never relayed. It
// reports no token counts, so the gateway records its own marked estimate.
import { randomBytes, randomUUID } from "node:crypto";
import { WebSessionExecutor } from "./web-session-executor.js";
import { cancelDiscardedResponse } from "./sendRequest.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { errorResponse } from "../utils/error.js";
import { chatChunkSse, sseChunk } from "../utils/sse.js";
import {
  VENICE_WEB_ALIAS,
  VENICE_WEB_CHAT_URL,
  VENICE_WEB_ID,
  VENICE_WEB_MODELS,
  VENICE_WEB_ORIGIN,
} from "../providers/private/venice-web.js";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { readVeniceWebCredential } from "./venice-web/credential.js";
import { VENICE_WEB_USER_AGENT, createVeniceSessions, findVeniceSessionId } from "./venice-web/session.js";
import { VeniceWebError, httpFailure, invalidRequest, isAbort, isRedirect, malformedReply, transportFailure } from "./venice-web/errors.js";
import { veniceWebDeltas } from "./venice-web/events.js";

const SSE_HEADERS = { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" };
const OWN_PREFIX = new RegExp(`^(?:${VENICE_WEB_ID}|${VENICE_WEB_ALIAS})/`);
const TEXT_PARTS = new Set(["text", "input_text"]);
const ROLES = new Map([["system", "system"], ["developer", "system"], ["user", "user"], ["assistant", "assistant"]]);
const DISCOVERY_TIMEOUT_MS = 15_000;

/**
 * List the models for one connection. The list is the pinned static one and is
 * not read from the account. It is returned only after a read-only check that
 * this connection's cookie still has an active session. Throws VeniceWebError.
 */
export async function discoverVeniceWebModels({ credentials, fetcher = proxyAwareFetch, proxyOptions = null, signal } = {}) {
  const { clientJwt } = readVeniceWebCredential(credentials);
  const send = (url, init) => fetcher(url, init, proxyOptions);
  await findVeniceSessionId(clientJwt, send, signal ?? AbortSignal.timeout(DISCOVERY_TIMEOUT_MS));
  return VENICE_WEB_MODELS.map((model) => ({ ...model }));
}

/** The same single GET as a connection check. It mints no token and starts no chat. */
export async function validateVeniceWebSession({ apiKey, fetcher, proxyOptions, signal } = {}) {
  try {
    await discoverVeniceWebModels({ credentials: { apiKey }, fetcher, proxyOptions, signal });
    return { valid: true, status: 200 };
  } catch (error) {
    if (!(error instanceof VeniceWebError)) return { valid: false, status: null, unavailable: true, error: "Venice Web validation failed" };
    return {
      valid: false,
      status: error.status,
      error: error.message,
      ...(error.code === "session_expired" ? { expired: true } : null),
      ...(error.status === 429 || error.status >= 500 ? { unavailable: true } : null),
    };
  }
}

function messageText(content) {
  if (content === null || content === undefined) return "";
  if (isString(content)) return content;
  if (!Array.isArray(content) || !content.every((part) => TEXT_PARTS.has(part?.type) && isString(part.text))) {
    throw invalidRequest("Venice Web accepts text content only");
  }
  return content.map((part) => part.text).join("");
}

function veniceMessages(body) {
  const offersTools = (Array.isArray(body.tools) && body.tools.length > 0) || (Array.isArray(body.functions) && body.functions.length > 0);
  if (offersTools && body.tool_choice !== "none") throw invalidRequest("Venice Web does not support tool calling");
  const messages = (Array.isArray(body.messages) ? body.messages : []).flatMap((message) => {
    const role = ROLES.get(message?.role);
    if (!role || message.tool_calls?.length || message.function_call) {
      throw invalidRequest("Venice Web accepts system, user and assistant text messages only");
    }
    const content = messageText(message.content);
    return content.trim() ? [{ role, content }] : [];
  });
  if (!messages.some((message) => message.role === "user")) throw invalidRequest("Venice Web needs at least one user text message");
  return messages;
}

const requestId = () => Array.from(randomBytes(7), (byte) => (byte % 36).toString(36)).join("");

/** The request body of the pinned source, field for field. */
function veniceEnvelope(body, modelId, prompt, userId) {
  return {
    modelId,
    prompt,
    reasoning: false,
    temperature: Number.isFinite(body.temperature) ? body.temperature : 0.7,
    topP: Number.isFinite(body.top_p) ? body.top_p : 0.9,
    requestId: requestId(),
    userId,
    simpleMode: false,
    includeVeniceSystemPrompt: false,
    webEnabled: false,
    webScrapeEnabled: false,
    xSearchEnabled: false,
    conversationType: "text",
    enableLargeContextChat: false,
    isCharacter: false,
    clientProcessingTime: 0,
  };
}

const chatHeaders = (jwt) => ({
  "Content-Type": "application/json",
  "User-Agent": VENICE_WEB_USER_AGENT,
  Accept: "*/*",
  Referer: `${VENICE_WEB_ORIGIN}/`,
  Origin: VENICE_WEB_ORIGIN,
  Authorization: `Bearer ${jwt}`,
  "x-venice-request-timestamp-ms": String(Date.now()),
  "x-venice-version": "interface@web",
  "x-venice-middleface-version": "outerface@web",
});

const newCompletion = (model) => ({ id: `chatcmpl-${randomUUID()}`, created: Math.floor(Date.now() / 1000), model });
const asStreamError = (error) => error instanceof VeniceWebError ? error : new VeniceWebError(502, "Venice Web stream was interrupted");

async function jsonReply(model, deltas, first, signal) {
  let content = "";
  let reasoning = "";
  for (let result = first; !result.done; result = await deltas.next()) {
    content += result.value.content ?? "";
    reasoning += result.value.reasoning_content ?? "";
  }
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const message = { role: "assistant", content, ...(reasoning ? { reasoning_content: reasoning } : null) };
  return Response.json({ ...newCompletion(model), object: "chat.completion", choices: [{ index: 0, message, finish_reason: "stop" }] });
}

/** Relay deltas as they arrive; `first` is the already-read iterator result. */
function streamReply(model, reader, deltas, first, signal) {
  const meta = newCompletion(model);
  const encoder = new TextEncoder();
  let next = first;
  let cancelled = false;
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(chatChunkSse({ ...meta, delta: { role: "assistant", content: "" } })));
    },
    async pull(controller) {
      try {
        const result = next ?? await deltas.next();
        next = null;
        if (cancelled) return;
        if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
        if (!result.done) {
          controller.enqueue(encoder.encode(chatChunkSse({ ...meta, delta: result.value })));
          return;
        }
        controller.enqueue(encoder.encode(`${chatChunkSse({ ...meta, delta: {}, finishReason: "stop" })}data: [DONE]\n\n`));
      } catch (error) {
        if (cancelled) return;
        void reader.cancel().catch(() => {});
        if (isAbort(error, signal)) {
          controller.error(error);
          return;
        }
        // No stop chunk: a failed answer must not look complete.
        const { message, type, code } = asStreamError(error);
        controller.enqueue(encoder.encode(`${sseChunk({ error: { message, type, code } })}data: [DONE]\n\n`));
      }
      void reader.cancel().catch(() => {});
      controller.close();
    },
    cancel(reason) {
      cancelled = true;
      return reader.cancel(reason).catch(() => {});
    },
  }), { headers: SSE_HEADERS });
}

export class VeniceWebExecutor extends WebSessionExecutor {
  constructor() {
    super(VENICE_WEB_ID, { id: VENICE_WEB_ID, baseUrl: VENICE_WEB_CHAT_URL, format: "openai" });
    this.sessions = createVeniceSessions();
  }

  // Connection settings can never move the destination.
  buildUrl() { return VENICE_WEB_CHAT_URL; }

  // Authentication happens inside runSession(); metadata callers get no credential.
  buildHeaders() { return {}; }

  async runSession(input, transport) {
    const sent = { headers: {}, body: input.body };
    const reply = (response) => ({ response, url: VENICE_WEB_CHAT_URL, headers: sent.headers, transformedBody: sent.body });
    try {
      return reply(await this.chat(input, transport, sent));
    } catch (error) {
      if (!(error instanceof VeniceWebError)) throw error;
      return reply(errorResponse(error.status, error.message, { type: error.type, code: error.code }, error.retryAfter));
    }
  }

  /** Returns the client-facing Response and records a redacted copy of the send in `sent`. */
  async chat(input, { send, sendBillable }, sent) {
    const body = isRecord(input.body) ? input.body : {};
    const { clientJwt } = readVeniceWebCredential(input.credentials);
    const model = String(input.model || body.model || "").replace(OWN_PREFIX, "").trim();
    if (!model) throw invalidRequest("Venice Web needs a model");
    const prompt = veniceMessages(body);

    const session = await this.sessions.token({ clientJwt, proxyOptions: input.proxyOptions, send, signal: input.signal });
    const envelope = veniceEnvelope(body, model, prompt, session.userId);
    const headers = chatHeaders(session.jwt);
    sent.headers = { ...headers, Authorization: "[REDACTED]" };
    sent.body = { ...envelope, userId: "[REDACTED]" };

    let upstream;
    try {
      upstream = await sendBillable(VENICE_WEB_CHAT_URL, { method: "POST", headers, body: JSON.stringify(envelope), redirect: "manual" });
    } catch (error) {
      if (isQuotaDispatchUnavailable(error)) throw error;
      const failure = transportFailure(error, input.signal);
      if (failure.code === "session_expired") this.sessions.forget(session);
      throw failure;
    }
    if (!upstream.ok || isRedirect(upstream)) {
      cancelDiscardedResponse(upstream);
      const failure = httpFailure(upstream, "chat request");
      if (failure.status === 401 || failure.status === 403) this.sessions.forget(session);
      throw failure;
    }
    if (!upstream.body) throw malformedReply("an empty response");

    const reader = upstream.body.getReader();
    const deltas = veniceWebDeltas(reader);
    try {
      // Read up to the first delta, so an unusable reply is a real HTTP error.
      const first = await deltas.next();
      if (input.stream === true) return streamReply(model, reader, deltas, first, input.signal);
      const response = await jsonReply(model, deltas, first, input.signal);
      void reader.cancel().catch(() => {});
      return response;
    } catch (error) {
      void reader.cancel().catch(() => {});
      if (isAbort(error, input.signal)) throw error;
      throw asStreamError(error);
    }
  }
}

export default VeniceWebExecutor;
