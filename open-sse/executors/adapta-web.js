// Adapted from OmniRoute open-sse/executors/adapta-web.ts at fbd3396 (PR #51).
import { isNumber, isString } from "../../src/shared/utils/typeChecks.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { prepareToolMessages, buildToolAwareResult } from "../translator/webTools.js";
import { digestMemoryKey } from "../utils/memoryKey.js";
import { resolveProxyForRequest } from "../utils/proxyFetch.js";
import { BaseExecutor } from "./base.js";
import { createExecutorSender } from "./sendRequest.js";

const APP = "https://agent.adapta.one";
const CLERK = "https://clerk.agent.adapta.one";
const URL = `${APP}/api/chat/stream/v1`;
const cache = new Map();
// Clerk and chat can have different NO_PROXY results. Cache only deterministic
// routes, since a non-strict proxy can fall back to direct at any hop.
function sessionCacheKey(cookie, proxyOptions) {
  const strict = proxyOptions?.strictProxy === true;
  const relay = proxyOptions?.vercelRelayUrl;
  if (isString(relay) && relay.trim()) return digestMemoryKey("adapta-session-relay", cookie, relay.trim(), strict);
  const clerk = resolveProxyForRequest(CLERK, proxyOptions);
  const chat = resolveProxyForRequest(URL, proxyOptions);
  if (strict && (!clerk.proxyUrl || !chat.proxyUrl)) return null;
  if (!strict && (clerk.proxyUrl || chat.proxyUrl)) return null;
  return digestMemoryKey("adapta-session", cookie, strict, clerk.source, clerk.proxyUrl, chat.source, chat.proxyUrl);
}
const error = (status, message) => new Response(JSON.stringify({ error: { message, type: "upstream_error", code: `HTTP_${status}` } }), { status, headers: { "Content-Type": "application/json" } });
const result = (response, body) => ({ response, url: URL, headers: {}, transformedBody: body });
function cookieValue(raw) {
  const value = String(raw || "").trim();
  if (value.startsWith("__client=")) return value.slice(9).split(";")[0].trim();
  return value;
}
function expiry(token) {
  try { const exp = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp; return isNumber(exp) && Number.isFinite(exp) ? exp * 1000 : 0; } catch { return 0; }
}
async function session(cookie, key, signal, send) {
  const saved = cache.get(key);
  if (saved && Date.now() < saved.exp - 30000) return saved.token;
  cache.delete(key);
  const headers = { Cookie: `__client=${cookie}`, Origin: APP };
  const client = await send(`${CLERK}/v1/client`, { headers, signal });
  if (!client.ok) {
    void client.body?.cancel().catch(() => {});
    throw new Error("Unable to validate Adapta session");
  }
  const data = await client.json();
  const id = data?.response?.sessions?.find((s) => s.status === "active")?.id;
  if (!isString(id) || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("No active Adapta session");
  signal?.throwIfAborted();
  const response = await send(`${CLERK}/v1/client/sessions/${id}/tokens`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, signal });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Unable to refresh Adapta session");
  }
  const { jwt } = await response.json();
  signal?.throwIfAborted();
  if (!isString(jwt) || !jwt.startsWith("eyJ")) throw new Error("Invalid Adapta session token");
  const exp = expiry(jwt);
  if (exp && exp <= Date.now()) throw new Error("Expired Adapta session token");
  if (key && exp > Date.now() + 30000) {
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, { token: jwt, exp });
  }
  return jwt;
}
function messagesFor(messages) {
  let system = "";
  const output = [];
  const text = (c) => isString(c) ? c : Array.isArray(c) ? c.filter((p) => p?.type === "text").map((p) => String(p.text ?? "")).join("") : String(c ?? "");
  for (const m of messages) {
    if (m.role === "system" || m.role === "developer") system += (system ? "\n" : "") + text(m.content);
  }
  for (const m of messages) {
    if (m.role === "system" || m.role === "developer") continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    let value = text(m.content);
    if (!value.trim()) continue;
    if (m.role === "user" && system) { value = `${system}\n\n${value}`; system = ""; }
    output.push({ role: m.role, parts: [{ type: "text", text: value }] });
  }
  return output;
}
/**
 * Adapta reports no token counts. Estimate them the way the other web-cookie
 * transports do (about four characters per token) so a non-streamed reply
 * still reaches Usage. The streaming path is estimated by the gateway.
 */
function estimatedUsage(messages, content) {
  const promptChars = messages.reduce((total, message) =>
    total + message.parts.reduce((sum, part) => sum + String(part.text ?? "").length, 0), 0);
  const promptTokens = Math.ceil(promptChars / 4);
  const completionTokens = Math.ceil(String(content ?? "").length / 4);
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
}
async function* events(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n"); buffer = lines.pop();
      if (done && buffer) lines.push(buffer);
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try { yield JSON.parse(line.slice(5).trim()); } catch { /* ignore malformed events */ }
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export class AdaptaWebExecutor extends BaseExecutor {
  constructor() { super("adapta-web", { baseUrl: URL }); }
  // This executor performs authentication internally; callers must never obtain credentials from metadata.
  buildHeaders() { return {}; }
  async execute(input) {
    const { model, body = {}, stream, credentials = {}, signal, proxyOptions } = input;
    const sender = createExecutorSender(this, input, { observePatchedFetch: false });
    const cookie = cookieValue(credentials.apiKey);
    if (!cookie || /[\r\n;]/.test(cookie)) return result(error(401, "Missing or invalid Adapta credentials"), body);
    const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages(body, Array.isArray(body.messages) ? body.messages : []);
    const payload = { messages: messagesFor(effectiveMessages), aiModelId: 14 };
    if (!payload.messages.length) return result(error(400, "No messages provided"), payload);
    const cacheKey = sessionCacheKey(cookie, proxyOptions);
    const canceled = () => result(error(499, "Adapta request canceled"), payload);
    let token;
    try {
      signal?.throwIfAborted();
      // Clerk calls are setup: they use the transport policy but charge no quota.
      token = await session(cookie, cacheKey, signal, (url, init) =>
        sender.sendRequest(url, init, proxyOptions, { quotaBearing: false }));
    } catch {
      if (signal?.aborted) return canceled();
      return result(error(401, "Adapta authentication failed"), payload);
    }
    let upstream;
    try {
      signal?.throwIfAborted();
      // Only chat consumes quota.
      upstream = await sender.sendRequest(URL, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream", Origin: APP, Referer: `${APP}/agentic-chat` }, body: JSON.stringify(payload), signal }, proxyOptions);
    } catch (cause) {
      if (isQuotaDispatchUnavailable(cause)) throw cause;
      if (signal?.aborted) return canceled();
      return result(error(502, "Adapta request failed"), payload);
    }
    function chatResult(response) {
      transferProviderAttemptDispatch(upstream, response);
      return { ...result(response, payload), attemptStartedAt: sender.attemptStartedAt };
    }
    if (!upstream.ok) {
      if ((upstream.status === 401 || upstream.status === 403) && cache.get(cacheKey)?.token === token) cache.delete(cacheKey);
      void upstream.body?.cancel().catch(() => {});
      return chatResult(error(upstream.status, upstream.status === 429 ? "Adapta rate limited" : "Adapta request failed"));
    }
    if (!upstream.body) return chatResult(error(502, "Adapta returned an empty response"));
    const id = `chatcmpl-adp-${Date.now()}`; const created = Math.floor(Date.now() / 1000);
    if (stream !== false) {
      const encoder = new TextEncoder();
      const out = new ReadableStream({ async start(controller) {
        const emit = (delta, finish_reason = null) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`));
        emit({ role: "assistant", content: "" });
        try { for await (const event of events(upstream.body)) {
          if (event.type === "text-delta" && event.id !== "quick-response" && isString(event.delta)) emit({ content: event.delta });
          if (event.type === "error") { emit({ content: "\n\n[Erro: Adapta upstream error]" }); break; }
          if (event.type === "done" || event.type === "end") break;
        } } catch { emit({ content: "\n\n[Erro: Adapta upstream error]" }); }
        emit({}, "stop"); controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
      } });
      return chatResult(new Response(out, { headers: { "Content-Type": "text/event-stream" } }));
    }
    let content = "";
    try { for await (const event of events(upstream.body)) {
      if (event.type === "error") return chatResult(error(502, "Adapta upstream error"));
      if (event.type === "text-delta" && event.id !== "quick-response" && isString(event.delta)) content += event.delta;
      if (event.type === "done" || event.type === "end") break;
    } } catch { return chatResult(error(502, "Adapta upstream error")); }
    const parsed = hasTools ? buildToolAwareResult(content, requestedTools, "adp") : { content, finishReason: "stop" };
    const message = parsed.toolCalls ? { role: "assistant", content: null, tool_calls: parsed.toolCalls } : { role: "assistant", content: parsed.content };
    return chatResult(Response.json({ id, object: "chat.completion", created, model, choices: [{ index: 0, message, finish_reason: parsed.finishReason }], usage: estimatedUsage(payload.messages, content) }));
  }
}
