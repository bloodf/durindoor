// Inner.ai Web executor, registered in the executor map as `inner-ai-web`; see
// docs/providers/inner-ai-web.md.
//
// Wire contract ported from cheaper-inference/OmniRoute (MIT) at
// 9671192011beb2d7f83979f40be488c5da8772b9, open-sse/executors/inner-ai.ts:
// profile lookup (email), account model catalog, then one chat POST that is
// always answered as SSE `{type, item}` events.
//
// Where this port is stricter than the source: redirects and a rejected profile
// stop the request; a catalog failure or unlisted model sends no chat; model
// matching never substitutes another model; a malformed or truncated stream is
// an error; upstream error text is never relayed; and no zero usage is
// reported, so the gateway records its own marked estimate.
import { randomUUID } from "node:crypto";
import { WebSessionExecutor } from "./web-session-executor.js";
import { cancelDiscardedResponse } from "./sendRequest.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { buildToolAwareResult, prepareToolMessages } from "../translator/webTools.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { errorResponse } from "../utils/error.js";
import { chatChunkSse, sseChunk } from "../utils/sse.js";
import { INNER_AI_WEB_ALIAS, INNER_AI_WEB_CHAT_URL, INNER_AI_WEB_ID } from "../providers/registry/inner-ai-web.js";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { readInnerAiWebCredential } from "./inner-ai-web/credential.js";
import { createDiscoveryCache, findInnerAiWebModel, innerAiWebHeaders, isAbort, transportFailure } from "./inner-ai-web/discovery.js";
import { InnerAiWebError, expiredSession, httpFailure, malformedReply } from "./inner-ai-web/errors.js";
import { innerAiWebText } from "./inner-ai-web/events.js";

const SSE_HEADERS = { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" };
const OWN_PREFIX = new RegExp(`^(?:${INNER_AI_WEB_ID}|${INNER_AI_WEB_ALIAS})/`);
const catalogEntry = (model) => ({ id: model.llm_model, name: isString(model.name) && model.name ? model.name : model.llm_model });

/**
 * List the text models of one account. It reads only the connection passed in,
 * never caches, and sends nothing for a malformed or expired credential.
 * Throws InnerAiWebError.
 */
export async function discoverInnerAiWebModels({ credentials, fetcher = proxyAwareFetch, proxyOptions = null, signal } = {}) {
  const session = readInnerAiWebCredential(credentials);
  const send = (url, init) => fetcher(url, init, proxyOptions);
  const { models } = await createDiscoveryCache().resolve(session, send, signal ?? AbortSignal.timeout(15_000));
  return models.map(catalogEntry);
}

/** A read-only session check (profile and catalog GETs). It never starts a chat. */
export async function validateInnerAiWebSession({ apiKey, fetcher, proxyOptions, signal } = {}) {
  try {
    await discoverInnerAiWebModels({ credentials: { apiKey }, fetcher, proxyOptions, signal });
    return { valid: true, status: 200 };
  } catch (error) {
    if (!(error instanceof InnerAiWebError)) return { valid: false, status: null, unavailable: true, error: "Inner.ai Web validation failed" };
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
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text" && isString(part.text)).map((part) => part.text).join("");
}

/** Inner.ai takes one string, so earlier turns are flattened with labels. Non-text parts are dropped. */
function flattenMessages(messages) {
  return messages.flatMap((message) => {
    const text = messageText(message?.content);
    if (!text.trim()) return [];
    if (message.role === "system" || message.role === "developer") return [`[Instructions]\n${text}`];
    return [message.role === "assistant" ? `[Assistant]\n${text}` : text];
  }).join("\n\n");
}

const errorFields = (error) => ({ message: error.message, type: error.type, code: error.code });
const asStreamError = (error) => error instanceof InnerAiWebError ? error : new InnerAiWebError(502, "Inner.ai Web stream was interrupted");

const newCompletion = (model) => ({ id: `chatcmpl-${randomUUID()}`, created: Math.floor(Date.now() / 1000), model });

function jsonCompletion(model, message, finishReason) {
  return Response.json({ ...newCompletion(model), object: "chat.completion", choices: [{ index: 0, message, finish_reason: finishReason }] });
}

/** A reply that had to be buffered first, so tool blocks can be parsed. */
function bufferedReply(model, content, { hasTools, requestedTools }, stream) {
  const parsed = hasTools ? buildToolAwareResult(content, requestedTools, "inner") : { content, toolCalls: null, finishReason: "stop" };
  const message = parsed.toolCalls ?
    { role: "assistant", content: null, tool_calls: parsed.toolCalls } :
    { role: "assistant", content: parsed.content };
  if (!stream) return jsonCompletion(model, message, parsed.finishReason);
  const meta = newCompletion(model);
  const delta = parsed.toolCalls ?
    { role: "assistant", tool_calls: parsed.toolCalls.map((call, index) => ({ index, ...call })) } :
    message;
  return new Response(
    `${chatChunkSse({ ...meta, delta })}${chatChunkSse({ ...meta, delta: {}, finishReason: parsed.finishReason })}data: [DONE]\n\n`,
    { headers: SSE_HEADERS },
  );
}

/** Relay text deltas as they arrive; `first` is the already-read iterator result. */
function relayReply(model, reader, deltas, first, signal) {
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
          controller.enqueue(encoder.encode(chatChunkSse({ ...meta, delta: { content: result.value } })));
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
        controller.enqueue(encoder.encode(`${sseChunk({ error: errorFields(asStreamError(error)) })}data: [DONE]\n\n`));
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

export class InnerAiWebExecutor extends WebSessionExecutor {
  constructor() {
    super(INNER_AI_WEB_ID, { id: INNER_AI_WEB_ID, baseUrl: INNER_AI_WEB_CHAT_URL, format: "openai" });
    this.discovery = createDiscoveryCache();
  }

  async runSession(input, transport) {
    const sent = { headers: {}, body: input.body };
    const reply = (response) => ({ response, url: INNER_AI_WEB_CHAT_URL, headers: sent.headers, transformedBody: sent.body });
    try {
      return reply(await this.chat(input, transport, sent));
    } catch (error) {
      if (!(error instanceof InnerAiWebError)) throw error;
      return reply(errorResponse(error.status, error.message, { type: error.type, code: error.code }, error.retryAfter));
    }
  }

  /** Returns the client-facing Response and records what was sent in `sent`. */
  async chat(input, { send, sendBillable }, sent) {
    const body = isRecord(input.body) ? input.body : {};
    const session = readInnerAiWebCredential(input.credentials);
    const requested = String(input.model || body.model || "").replace(OWN_PREFIX, "").trim();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!requested || !flattenMessages(messages).trim()) {
      throw new InnerAiWebError(400, "Inner.ai Web needs a model and at least one text message", "invalid_request_error", "invalid_request");
    }

    const { email, models } = await this.discovery.resolve(session, send, input.signal);
    const model = findInnerAiWebModel(models, requested);
    if (!model) {
      this.discovery.forget(session);
      throw new InnerAiWebError(404, "This Inner.ai Web account does not list the requested model", "invalid_request_error", "model_not_found");
    }

    const tools = prepareToolMessages(body, messages);
    const envelope = {
      message: flattenMessages(tools.effectiveMessages),
      session_id: randomUUID(),
      context_type: "no_context",
      ai_model: { id: model.id, llm_model: model.llm_model },
      is_extension: false,
      env: "production",
      temporary: true,
      use_web_search: false,
      knowledge_list: [],
    };
    const headers = innerAiWebHeaders(session, email);
    sent.body = envelope;
    sent.headers = { ...headers, Cookie: "[REDACTED]", "USER-TOKEN": "[REDACTED]", ...(email ? { "USER-EMAIL": "[REDACTED]" } : null) };

    let upstream;
    try {
      upstream = await sendBillable(INNER_AI_WEB_CHAT_URL, { method: "POST", headers, body: JSON.stringify(envelope), redirect: "manual" });
    } catch (error) {
      if (isQuotaDispatchUnavailable(error)) throw error;
      const failure = transportFailure(error, input.signal);
      if (failure.code === "session_expired") this.discovery.forget(session);
      throw failure;
    }
    if (!upstream.ok) {
      cancelDiscardedResponse(upstream);
      const failure = httpFailure(upstream, "chat request");
      if (failure.code === expiredSession().code) this.discovery.forget(session);
      throw failure;
    }
    if (!upstream.body) throw malformedReply("an empty response");

    const reader = upstream.body.getReader();
    const deltas = innerAiWebText(reader);
    const stream = input.stream === true;
    try {
      // Read up to the first delta, so an immediate quota event is a real HTTP error.
      const first = await deltas.next();
      if (stream && !tools.hasTools) return relayReply(model.llm_model, reader, deltas, first, input.signal);
      let content = "";
      for (let result = first; !result.done; result = await deltas.next()) content += result.value;
      if (input.signal?.aborted) throw input.signal.reason;
      void reader.cancel().catch(() => {});
      return bufferedReply(model.llm_model, content, tools, stream);
    } catch (error) {
      void reader.cancel().catch(() => {});
      if (isAbort(error, input.signal)) throw error;
      throw asStreamError(error);
    }
  }
}

export default InnerAiWebExecutor;
