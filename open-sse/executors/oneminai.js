// 1min.ai Chat with AI executor (#1217).
//
// Ported from OmniRoute open-sse/executors/oneminai.ts
// (diegosouzapw/OmniRoute@61e07fb7, MIT). 1min.ai is not OpenAI-compatible on
// the wire: one `promptObject.prompt` string instead of `messages`, an
// `API-KEY` auth header, and real SSE with `event:`/`data:` framing. This
// executor translates an OpenAI Chat request to that shape and the response
// (JSON or SSE) back to OpenAI chat.completion(.chunk).
//
// Fork deviations: uses proxyAwareFetch (outbound proxy + redirect policy),
// bounded error-body reads, and the shared buildErrorBody sanitizer.

import { randomUUID } from "node:crypto";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { buildErrorBody, readBoundedResponseText } from "../utils/error.js";
import { runQuotaBearingProviderRequest } from "../services/providerAttemptContext.js";

export const ONEMINAI_CHAT_URL = "https://api.1min.ai/api/chat-with-ai";
const MAX_STREAM_ERROR_DATA_CHARS = 64 * 1024;
const STREAM_ERROR_FALLBACK = "1min.ai upstream stream failed";
const STREAM_INCOMPLETE = "1min.ai stream ended before completion";
const STREAM_OVERFLOW = "1min.ai stream event exceeded the size limit";
// Upper bound on the unparsed SSE buffer (one event must fit).
export const MAX_STREAM_BUFFER_CHARS = 1024 * 1024;
const MAX_JSON_BODY_BYTES = 4 * 1024 * 1024;
const ROLE_LABELS = { system: "System", developer: "System", user: "User", assistant: "Assistant" };

const asRecord = (value) => value && isObject(value) && !Array.isArray(value) ? value : {};

function extractTextContent(content) {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content.
  map((part) => part && isObject(part) && part.type === "text" && isString(part.text) ? part.text : "").
  filter((text) => text.length > 0).
  join("\n");
}

/**
 * 1min.ai keeps multi-turn context server-side via conversationId, which
 * stateless OpenAI clients cannot provide. A single user message passes
 * through unchanged; longer histories are flattened into a labeled transcript.
 */
export function buildPrompt(messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 1 && list[0]?.role === "user") return extractTextContent(list[0].content);
  return list.
  map((message) => {
    const role = String(message?.role || "user").toLowerCase();
    return `${ROLE_LABELS[role] || role}: ${extractTextContent(message?.content)}`;
  }).
  join("\n\n");
}

const sseChunk = (data) => `data: ${JSON.stringify(data)}\n\n`;

function parseStreamErrorMessage(data) {
  if (!data || data.length > MAX_STREAM_ERROR_DATA_CHARS) return STREAM_ERROR_FALLBACK;
  try {
    const parsed = asRecord(JSON.parse(data));
    if (isString(parsed.message) && parsed.message.trim()) return parsed.message.trim();
    if (isString(parsed.error) && parsed.error.trim()) return parsed.error.trim();
    const nested = asRecord(parsed.error);
    if (isString(nested.message) && nested.message.trim()) return nested.message.trim();
  } catch {/* fixed public fallback below */}
  return STREAM_ERROR_FALLBACK;
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function completionResponse(content, model, id, created) {
  return jsonResponse(200, {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    // 1min.ai's response shape carries no token-usage fields.
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  });
}

/**
 * Re-emit 1min.ai SSE (event: content|result|done|error) as OpenAI
 * chat.completion.chunk SSE. An error before any content becomes an OpenAI
 * error frame + [DONE]; an error after content errors the stream (with a
 * fixed public message) so the client sees a terminal failure, not a silent
 * truncation. Downstream cancel releases the upstream reader immediately.
 */
export function translateOneMinAiStream(upstreamBody, model, id, created) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = upstreamBody.getReader();
  const pending = [];
  let buffer = "";
  let finished = false;
  let roleEmitted = false;
  let terminalError = null;
  let cancelled = false;

  const queue = (text) => pending.push(encoder.encode(text));
  const chunk = (delta, finishReason = null) =>
  sseChunk({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finishReason }] });
  const cancelUpstream = (reason) => {
    try {
      void reader.cancel(reason).catch(() => {});
    } catch {/* cleanup only */}
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    queue(chunk({}, "stop"));
    queue("data: [DONE]\n\n");
  };
  const emitContent = (text) => {
    if (!text) return;
    if (!roleEmitted) {
      roleEmitted = true;
      queue(chunk({ role: "assistant" }));
    }
    queue(chunk({ content: text }));
  };
  const emitError = (data, publicMessage = null) => {
    if (finished) return;
    finished = true;
    cancelUpstream("1min.ai upstream stream error");
    if (!roleEmitted) {
      queue(sseChunk(buildErrorBody(502, publicMessage || parseStreamErrorMessage(data))));
      queue("data: [DONE]\n\n");
      return;
    }
    terminalError = Object.assign(new Error(publicMessage || STREAM_ERROR_FALLBACK), { statusCode: 502 });
  };

  const processEvent = (eventText) => {
    let type = "message";
    const dataLines = [];
    for (const line of eventText.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();else
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    const data = dataLines.join("\n");
    if (type === "content") {
      try {
        const parsed = asRecord(JSON.parse(data));
        if (isString(parsed.content)) emitContent(parsed.content);
      } catch {/* ignore malformed content events */}
    } else if (type === "error") {
      emitError(data);
    } else if (type === "done") {
      finish();
    }
    // "result" repeats the full record already streamed as content events.
  };

  // CRLF and lone CR -> LF. A trailing CR is kept until the next chunk shows
  // whether it starts a CRLF pair.
  const normalizeNewlines = (text, final) => {
    const keepCr = !final && text.endsWith("\r");
    const body = (keepCr ? text.slice(0, -1) : text).replace(/\r\n?/g, "\n");
    return keepCr ? `${body}\r` : body;
  };

  const drainBuffer = () => {
    let sep = buffer.indexOf("\n\n");
    while (sep !== -1 && !finished) {
      processEvent(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf("\n\n");
    }
  };

  return new ReadableStream({
    async pull(controller) {
      while (pending.length === 0 && !finished && !cancelled) {
        const { done, value } = await reader.read();
        if (cancelled) return;
        if (done) {
          buffer = normalizeNewlines(buffer + decoder.decode(), true);
          if (buffer.trim()) processEvent(buffer);
          // No `done` event: the upstream stream was cut, not completed.
          if (!finished) emitError("", STREAM_INCOMPLETE);
          break;
        }
        // Append first, then normalize across the whole buffer so a CRLF (or a
        // blank-line separator) split between network chunks is never lost.
        buffer = normalizeNewlines(buffer + decoder.decode(value, { stream: true }), false);
        drainBuffer();
        if (!finished && buffer.length > MAX_STREAM_BUFFER_CHARS) emitError("", STREAM_OVERFLOW);
      }
      if (cancelled) return;
      if (pending.length > 0) controller.enqueue(pending.shift());else
      if (terminalError) controller.error(terminalError);else
      if (finished) controller.close();
    },
    cancel(reason) {
      cancelled = true;
      pending.length = 0;
      cancelUpstream(reason ?? "1min.ai downstream cancelled");
    }
  });
}

function unsupportedFeature(body) {
  const b = asRecord(body);
  if (Array.isArray(b.tools) && b.tools.length > 0 || Array.isArray(b.functions) && b.functions.length > 0) return "tool calling";
  if (b.response_format && asRecord(b.response_format).type && b.response_format.type !== "text") return "response_format";
  const hasMedia = (Array.isArray(b.messages) ? b.messages : []).some((m) =>
  Array.isArray(m?.content) && m.content.some((part) => part && isObject(part) && part.type !== "text"));
  return hasMedia ? "image or file inputs" : null;
}

export class OneMinAiExecutor extends BaseExecutor {
  constructor(provider = "oneminai", config = null) {
    super(provider, config ?? { id: "oneminai", baseUrl: ONEMINAI_CHAT_URL, format: "openai" });
  }

  buildUrl(_model, stream) {
    return stream ? `${ONEMINAI_CHAT_URL}?isStreaming=true` : ONEMINAI_CHAT_URL;
  }

  buildHeaders(credentials) {
    return { "Content-Type": "application/json", "API-KEY": credentials?.apiKey || credentials?.accessToken || "" };
  }

  transformRequest(model, body) {
    const messages = Array.isArray(asRecord(body).messages) ? body.messages : [];
    return { type: "UNIFY_CHAT_WITH_AI", model, promptObject: { prompt: buildPrompt(messages) } };
  }

  async execute({ model, body, stream, credentials, signal, proxyOptions = null }) {
    // The prompt-string wire has no tool or media channel (upstream strips
    // these params). Reject instead of silently dropping them.
    const unsupported = unsupportedFeature(body);
    if (unsupported) {
      return { response: jsonResponse(400, buildErrorBody(400, `1min.ai does not support ${unsupported}`)), url: ONEMINAI_CHAT_URL, headers: {}, transformedBody: body };
    }
    if (!credentials?.apiKey && !credentials?.accessToken) {
      return { response: jsonResponse(401, buildErrorBody(401, "1min.ai API key is missing")), url: ONEMINAI_CHAT_URL, headers: {}, transformedBody: body };
    }
    const url = this.buildUrl(model, stream);
    const headers = this.buildHeaders(credentials);
    const transformedBody = this.transformRequest(model, body);
    const id = `chatcmpl-oneminai-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const result = (response) => ({ response, url, headers, transformedBody });

    let response;
    try {
      // Quota-bearing dispatch: proxyAwareFetch then refuses redirects (redirect:"error").
      response = await runQuotaBearingProviderRequest(() =>
      proxyAwareFetch(url, { method: "POST", headers, body: JSON.stringify(transformedBody), signal }, proxyOptions));
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      return result(jsonResponse(502, buildErrorBody(502, `1min.ai fetch error: ${error?.message || error}`)));
    }

    if (!response.ok) {
      const text = await readBoundedResponseText(response, { signal }).catch(() => "");
      let message = `1min.ai API failed with status ${response.status}`;
      try {
        const err = asRecord(asRecord(JSON.parse(text)).error);
        if (isString(err.message)) message = err.message;
      } catch {
        if (text) message = text;
      }
      return result(jsonResponse(response.status, buildErrorBody(response.status, message)));
    }

    if (stream) {
      if (!response.body) return result(jsonResponse(502, buildErrorBody(502, "1min.ai returned an empty stream")));
      return result(new Response(translateOneMinAiStream(response.body, model, id, created), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" }
      }));
    }

    let json;
    try {
      json = asRecord(JSON.parse(await readBoundedResponseText(response, { signal, maxBytes: MAX_JSON_BODY_BYTES, timeoutMs: 30_000, throwOnTimeout: true })));
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      return result(jsonResponse(502, buildErrorBody(502, "1min.ai returned an unreadable response")));
    }
    const resultObject = asRecord(asRecord(json.aiRecord).aiRecordDetail).resultObject;
    const content = (Array.isArray(resultObject) ? resultObject : []).filter(isString).join("");
    return result(completionResponse(content, model, id, created));
  }
}

export default OneMinAiExecutor;
