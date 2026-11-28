// Adapted from OmniRoute open-sse/executors/adapta-web.ts at fbd3396 (PR #51).
import { randomUUID } from "node:crypto";
import { isNumber, isString } from "../../src/shared/utils/typeChecks.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { prepareToolMessages, buildToolAwareResult } from "../translator/webTools.js";
import { digestMemoryKey } from "../utils/memoryKey.js";
import { resolveProxyForRequest } from "../utils/proxyFetch.js";
import { WebSessionExecutor } from "./webSessionBase.js";

const APP = "https://agent.adapta.one";
const CLERK = "https://clerk.agent.adapta.one";
const URL = `${APP}/api/chat/stream/v1`;
const DEFAULT_MODEL_KEY = "ONE";
// DurinDoor model id -> Adapta catalog key, sent upstream as `modelAi`.
export const MODEL_KEY_MAP = Object.freeze({
  "adapta-one": "ONE",
  "adapta-gpt-6-luna": "GPT_6_LUNA",
  "adapta-claude-5-5-haiku": "CLAUDE_5_5_HAIKU",
  "adapta-claude-5-5-sonnet": "CLAUDE_5_5_SONNET",
  "adapta-claude-5-sonnet": "CLAUDE_5_SONNET",
  "adapta-gemini-3-8-flash": "GEMINI_3_8_FLASH",
  "adapta-gemini-3-7-flash": "GEMINI_3_7_FLASH",
  "adapta-gemini-3-1-pro-preview": "GEMINI_3_1_PRO_PREVIEW",
  "adapta-deepseek-v4-1-flash-1017": "DEEPSEEK_V4_1_FLASH_1017",
  "adapta-deepseek-v4-flash-updated": "DEEPSEEK_V4_FLASH_UPDATED",
  "adapta-deepseek-v4-pro-0813": "DEEPSEEK_V4_PRO_0813",
  "adapta-kimi-k2-7-code": "KIMI_K2_7_CODE",
  "adapta-kimi-k2-6": "KIMI_K2_6",
  "adapta-minimax-m3": "MINIMAX_M3",
  "adapta-minimax-m3-1-flash": "MINIMAX_M3_1_FLASH",
  "adapta-minimax-m2-7-highspeed": "MINIMAX_M2_7_HIGHSPEED",
  "adapta-minimax-m2-7": "MINIMAX_M2_7",
  "adapta-qwen-3-8-27b": "QWEN_3_8_27B",
  "adapta-qwen-3-8-flash": "QWEN_3_8_FLASH",
  "adapta-qwen-3-7-plus": "QWEN_3_7_PLUS",
  "adapta-glm-5-3-flash": "GLM_5_3_FLASH",
  "adapta-glm-5-2": "GLM_5_2",
  "adapta-grok-43": "GROK_43",
  "adapta-muse-spark-1-3": "MUSE_SPARK_1_3",
  "adapta-sonar-pro": "SONAR_PRO",
  "adapta-nvidia-nemotron-super": "NVIDIA_NEMOTRON_SUPER",
});
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
function messagesFor(messages, modelKey, chatId) {
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
    const id = randomUUID();
    const turn = { id, role: m.role, parts: [{ type: "text", text: value }] };
    output.push(m.role === "assistant"
      ? { ...turn, metadata: { model: modelKey, chatId, messageId: id, isPaused: false }, state: "done" }
      : turn);
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
const endsReply = (event) => ["done", "end", "finish"].includes(event.type);
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
export class AdaptaWebExecutor extends WebSessionExecutor {
  constructor() { super("adapta-web", { baseUrl: URL }, { observePatchedFetch: false }); }
  // This executor performs authentication internally; callers must never obtain credentials from metadata.
  buildHeaders() { return {}; }
  async runSession(input, transport) {
    const { model, body = {}, stream, credentials = {}, signal, proxyOptions } = input;
    const cookie = cookieValue(credentials.apiKey);
    if (!cookie || /[\r\n;]/.test(cookie)) return result(error(401, "Missing or invalid Adapta credentials"), body);
    const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages(body, Array.isArray(body.messages) ? body.messages : []);
    const modelKey = Object.hasOwn(MODEL_KEY_MAP, model) ? MODEL_KEY_MAP[model] : DEFAULT_MODEL_KEY;
    const chatId = randomUUID();
    const payload = {
      chatId, id: chatId, isTemporaryChat: false, mandatoryTools: [], skipImagePromptOptimization: true,
      modelAi: modelKey, trigger: "submit-message",
      messages: messagesFor(effectiveMessages, modelKey, chatId),
    };
    if (!payload.messages.length) return result(error(400, "No messages provided"), payload);
    const cacheKey = sessionCacheKey(cookie, proxyOptions);
    const canceled = () => result(error(499, "Adapta request canceled"), payload);
    let token;
    try {
      signal?.throwIfAborted();
      // Clerk calls are setup: they use the transport policy but charge no quota.
      token = await session(cookie, cacheKey, signal, (url, init) =>
        transport.send(url, { redirect: "error", ...init }));
    } catch {
      if (signal?.aborted) return canceled();
      return result(error(401, "Adapta authentication failed"), payload);
    }
    let upstream;
    try {
      signal?.throwIfAborted();
      // Only chat consumes quota.
      upstream = await transport.sendBillable(URL, { redirect: "error", method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream", Origin: APP, Referer: `${APP}/agentic-chat` }, body: JSON.stringify(payload), signal });
    } catch (cause) {
      if (isQuotaDispatchUnavailable(cause)) throw cause;
      if (signal?.aborted) return canceled();
      return result(error(502, "Adapta request failed"), payload);
    }
    function chatResult(response) {
      return result(response, payload);
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
          if (endsReply(event)) break;
        } } catch { emit({ content: "\n\n[Erro: Adapta upstream error]" }); }
        emit({}, "stop"); controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
      } });
      return chatResult(new Response(out, { headers: { "Content-Type": "text/event-stream" } }));
    }
    let content = "";
    try { for await (const event of events(upstream.body)) {
      if (event.type === "error") return chatResult(error(502, "Adapta upstream error"));
      if (event.type === "text-delta" && event.id !== "quick-response" && isString(event.delta)) content += event.delta;
      if (endsReply(event)) break;
    } } catch { return chatResult(error(502, "Adapta upstream error")); }
    const parsed = hasTools ? buildToolAwareResult(content, requestedTools, "adp") : { content, finishReason: "stop" };
    const message = parsed.toolCalls ? { role: "assistant", content: null, tool_calls: parsed.toolCalls } : { role: "assistant", content: parsed.content };
    return chatResult(Response.json({ id, object: "chat.completion", created, model, choices: [{ index: 0, message, finish_reason: parsed.finishReason }], usage: estimatedUsage(payload.messages, content) }));
  }
}
