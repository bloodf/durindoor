import { randomUUID } from "node:crypto";
import { WebSessionExecutor } from "./webSessionBase.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { MAX_PROVIDER_BODY_BYTES, RESPONSE_BODY_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { readBodyWithTimeout } from "../utils/bodyTimeout.js";
import { errorResponse } from "../utils/error.js";
import { chatChunkSse, sseChunk } from "../utils/sse.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://t3.chat";
const CHAT_URL = `${ORIGIN}/api/chat`;
const SESSION_ERROR = "Provide an authorized T3 Chat Cookie header with a convex-session-id, or a cookies/convexSessionId pair.";
const COOKIE_PAIR = /^([!#$%&'*+.^_`|~\w-]+)=([\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*)$/;

/** Accept the stored Cookie header and OmniRoute's two-field paste format. */
function sessionCookie(credentials) {
  const value = credentials?.apiKey ?? credentials?.accessToken;
  if (!isString(value) || /[\0\r]/.test(value)) return null;
  const raw = value.trim();
  const fields = /^(?:cookies=([^\n]+)\nconvexSessionId=([^\n]+)|convexSessionId=([^\n]+)\ncookies=([^\n]+))$/.exec(raw);
  if (fields && !COOKIE_PAIR.test(`convex-session-id=${fields[2] ?? fields[3]}`)) return null;
  const cookie = fields
    ? `${fields[1] ?? fields[4]}; convex-session-id=${fields[2] ?? fields[3]}`
    : raw.replace(/^Cookie:[ \t]*/i, "");
  if (cookie.includes("\n")) return null;
  const names = new Set();
  const pairs = cookie.split(";").map((part) => part.trim());
  for (const pair of pairs) {
    const match = COOKIE_PAIR.exec(pair);
    if (!match) return null;
    const [, name, contents] = match;
    if (names.has(name) || (name === "convex-session-id" && !contents)) return null;
    names.add(name);
  }
  return names.has("convex-session-id") ? pairs.join("; ") : null;
}

export async function validateT3Session(credentials, transport = proxyAwareFetch) {
  const cookie = sessionCookie(credentials);
  if (!cookie) return { valid: false, error: SESSION_ERROR };
  try {
    const response = await transport(`${ORIGIN}/`, {
      method: "HEAD",
      headers: { Cookie: cookie },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return { valid: true, error: null };
    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: "T3 Chat rejected the session." };
    }
  } catch {
    // Transport errors may contain request headers. Keep details private.
  }
  return { valid: false, unavailable: true, error: "T3 Chat session check unavailable." };
}

function textDelta(data) {
  const plain = data?.text ?? data?.delta ?? data?.content ?? data?.message?.content;
  if (isString(plain)) return plain;
  if (data?.t === 2 && isString(data.s)) return data.s;
  const { k, v } = data?.p ?? {};
  if (!Array.isArray(k) || !Array.isArray(v)) return null;
  const value = v[k.findIndex((key) => ["content", "text", "delta"].includes(key))];
  if (isString(value)) return value;
  return value?.t === 2 && isString(value.s) ? value.s : null;
}

function readTextEvent(line) {
  const data = JSON.parse(line);
  if (data?.error || data?.type === "error") throw new Error("T3 Chat returned a stream error.");
  return {
    content: textDelta(data),
    done: data?.type === "done" || data?.done === true ||
      data?.status === "complete" || data?.finish_reason === "stop",
  };
}

async function* ndjsonLines(body) {
  let pending = "";
  for await (const part of body.pipeThrough(new TextDecoderStream())) {
    const lines = (pending + part).split("\n");
    pending = lines.pop();
    for (const line of lines) {
      if (line.length > MAX_PROVIDER_BODY_BYTES) throw new Error("T3 Chat stream frame exceeded the body limit.");
      if (line.trim()) yield line;
    }
    if (pending.length > MAX_PROVIDER_BODY_BYTES) throw new Error("T3 Chat stream frame exceeded the body limit.");
  }
  if (pending.trim()) yield pending;
}

async function* ndjsonToSse(body, metadata) {
  const encoder = new TextEncoder();
  try {
    for await (const line of ndjsonLines(body)) {
      const { content, done } = readTextEvent(line);
      if (content !== null) {
        yield encoder.encode(chatChunkSse({ ...metadata, delta: { content } }));
      }
      if (done) {
        yield encoder.encode(chatChunkSse({ ...metadata, delta: {}, finishReason: "stop" }) + SSE_DONE);
        return;
      }
    }
  } catch {
    // Keep untrusted stream errors out of diagnostics and client error text.
  }
  yield encoder.encode(sseChunk({ error: { message: "T3 Chat returned an incomplete or invalid stream." } }) + SSE_DONE);
}

function textCompletion(metadata, content) {
  return {
    ...metadata, object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  };
}

/**
 * T3 Chat reports no token counts. Estimate them the way the other web-cookie
 * transports do (about four characters per token) so a non-streamed reply still
 * reaches Usage. The streaming path is estimated by the gateway.
 */
function estimatedUsage(completion, requestBody) {
  const promptChars = JSON.stringify(requestBody?.messages ?? []).length;
  const completionChars = String(completion?.choices?.[0]?.message?.content ?? "").length;
  const promptTokens = Math.ceil(promptChars / 4);
  const completionTokens = Math.ceil(completionChars / 4);
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
}

function completionResponse(completion, stream, requestBody) {
  const body = completion.usage ? completion : { ...completion, usage: estimatedUsage(completion, requestBody) };
  if (!stream) return Response.json(body);
  const { id, created, model, choices, usage } = body;
  const metadata = { id, created, model, object: "chat.completion.chunk" };
  const deltas = choices.map(({ index, message }) => ({ index, delta: message, finish_reason: null }));
  const terminal = choices.map(({ index, finish_reason }) => ({ index, delta: {}, finish_reason }));
  return new Response(sseChunk({ ...metadata, choices: deltas }) +
    sseChunk({ ...metadata, choices: terminal, usage }) + SSE_DONE, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

export class T3ChatWebExecutor extends WebSessionExecutor {
  constructor() {
    super("t3-web", { baseUrl: CHAT_URL }, { observePatchedFetch: false });
  }

  // The translator preview and chat telemetry use these public headers.
  buildHeaders() {
    return { "Content-Type": "application/json", Origin: ORIGIN, Referer: `${ORIGIN}/` };
  }

  buildUrl() {
    return CHAT_URL;
  }

  async runSession(input, transport) {
    const { model, body, stream = true, credentials, signal, proxyOptions } = input;
    const headers = this.buildHeaders();
    const payload = { model, messages: body?.messages, stream };
    const result = { url: CHAT_URL, headers, transformedBody: payload };
    const fail = (status, message) => ({ ...result, response: errorResponse(status, message) });
    if (!Array.isArray(payload.messages) || !payload.messages.length) {
      return fail(400, "T3 Chat requires messages.");
    }
    if (body?.tools?.length) return fail(400, "T3 Chat Web supports text requests without tools.");
    const cookie = sessionCookie(credentials);
    if (!cookie) return fail(400, SESSION_ERROR);
    if (proxyOptions?.vercelRelayUrl) return fail(400, "T3 Chat sessions require a route without an HTTP relay.");

    try {
      const upstream = await transport.sendBillable(CHAT_URL, {
        method: "POST",
        headers: { ...headers, Cookie: cookie, Accept: stream ? "text/event-stream, application/x-ndjson, application/json" : "application/json" },
        body: JSON.stringify(payload),
        redirect: "error",
        signal,
      });
      if (!upstream.ok) {
        void upstream.body?.cancel().catch(() => {});
        if (upstream.status >= 300 && upstream.status < 400) {
          return fail(502, "T3 Chat redirected the request.");
        }
        return fail(upstream.status, `T3 Chat request failed (HTTP ${upstream.status}).`);
      }
      const contentType = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (contentType === "text/event-stream" && stream && upstream.body) {
        return { ...result, response: new Response(upstream.body, { headers: { "Content-Type": contentType } }) };
      }
      const metadata = { id: `chatcmpl-${randomUUID()}`, created: Math.floor(Date.now() / 1000), model };
      if (contentType === "application/json" || contentType === "application/x-ndjson") {
        if (stream && contentType === "application/x-ndjson" && upstream.body) {
          return { ...result, response: new Response(ReadableStream.from(ndjsonToSse(upstream.body, metadata)), {
            headers: { "Content-Type": "text/event-stream" },
          }) };
        }
        const raw = await readBodyWithTimeout(upstream, {
          signal, maxBytes: MAX_PROVIDER_BODY_BYTES, timeoutMs: RESPONSE_BODY_TIMEOUT_MS,
        });
        if (contentType === "application/json") {
          const data = JSON.parse(raw);
          if (data?.error) return fail(502, "T3 Chat returned an error.");
          if (Array.isArray(data?.choices) && data.choices.length) {
            return { ...result, response: completionResponse({ ...metadata, ...data }, stream, payload) };
          }
          const content = textDelta(data);
          if (content !== null) return { ...result, response: completionResponse(textCompletion(metadata, content), stream, payload) };
        } else {
          const parts = [];
          for (const line of raw.split("\n")) {
            if (!line.trim()) continue;
            const { content, done } = readTextEvent(line);
            if (content !== null) parts.push(content);
            if (done) return { ...result, response: completionResponse(textCompletion(metadata, parts.join("")), false, payload) };
          }
        }
      } else {
        void upstream.body?.cancel().catch(() => {});
      }
      return fail(502, "T3 Chat returned an unsupported response.");
    } catch (error) {
      if (isQuotaDispatchUnavailable(error)) throw error;
      if (signal?.aborted) return fail(499, "T3 Chat request canceled.");
      if (error?.name === "TimeoutError") return fail(504, "T3 Chat request timed out.");
      return fail(502, "T3 Chat request failed.");
    }
  }
}
