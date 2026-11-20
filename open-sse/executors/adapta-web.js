// Adapted from OmniRoute open-sse/executors/adapta-web.ts at fbd3396 (PR #51).
import { createHash } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { isNumber, isString } from "../../src/shared/utils/typeChecks.js";
import { prepareToolMessages, buildToolAwareResult } from "../translator/webTools.js";

const APP = "https://agent.adapta.one";
const CLERK = "https://clerk.agent.adapta.one";
const URL = `${APP}/api/chat/stream/v1`;
const cache = new Map();
const keyOf = (cookie) => createHash("sha256").update(cookie).digest("hex");
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
async function session(cookie, signal) {
  const key = keyOf(cookie);
  const saved = cache.get(key);
  if (saved && Date.now() < saved.exp - 30000) return saved.token;
  cache.delete(key);
  const headers = { Cookie: `__client=${cookie}`, Origin: APP };
  const client = await fetch(`${CLERK}/v1/client`, { headers, signal });
  if (!client.ok) throw new Error("Unable to validate Adapta session");
  const data = await client.json();
  const id = data?.response?.sessions?.find((s) => s.status === "active")?.id;
  if (!isString(id) || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("No active Adapta session");
  const response = await fetch(`${CLERK}/v1/client/sessions/${id}/tokens`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, signal });
  if (!response.ok) throw new Error("Unable to refresh Adapta session");
  const { jwt } = await response.json();
  if (!isString(jwt) || !jwt.startsWith("eyJ")) throw new Error("Invalid Adapta session token");
  const exp = expiry(jwt);
  if (exp && exp <= Date.now()) throw new Error("Expired Adapta session token");
  // Unknown or expired expiries may be used for this request but are never cached.
  if (exp > Date.now() + 30000) {
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
  async execute({ model, body = {}, stream, credentials = {}, signal }) {
    const cookie = cookieValue(credentials.apiKey);
    if (!cookie || /[\r\n;]/.test(cookie)) return result(error(401, "Missing or invalid Adapta credentials"), body);
    const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages(body, Array.isArray(body.messages) ? body.messages : []);
    const payload = { messages: messagesFor(effectiveMessages), aiModelId: 14 };
    if (!payload.messages.length) return result(error(400, "No messages provided"), payload);
    let token;
    try { token = await session(cookie, signal); } catch { return result(error(401, "Adapta authentication failed"), payload); }
    let upstream;
    try {
      upstream = await fetch(URL, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream", Origin: APP, Referer: `${APP}/agentic-chat` }, body: JSON.stringify(payload), signal });
    } catch { return result(error(502, "Adapta request failed"), payload); }
    if (!upstream.ok) {
      if (upstream.status === 401 || upstream.status === 403) cache.delete(keyOf(cookie));
      return result(error(upstream.status, upstream.status === 429 ? "Adapta rate limited" : "Adapta request failed"), payload);
    }
    if (!upstream.body) return result(error(502, "Adapta returned an empty response"), payload);
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
      return result(new Response(out, { headers: { "Content-Type": "text/event-stream" } }), payload);
    }
    let content = "";
    try { for await (const event of events(upstream.body)) {
      if (event.type === "error") return result(error(502, "Adapta upstream error"), payload);
      if (event.type === "text-delta" && event.id !== "quick-response" && isString(event.delta)) content += event.delta;
      if (event.type === "done" || event.type === "end") break;
    } } catch { return result(error(502, "Adapta upstream error"), payload); }
    const parsed = hasTools ? buildToolAwareResult(content, requestedTools, "adp") : { content, finishReason: "stop" };
    const message = parsed.toolCalls ? { role: "assistant", content: null, tool_calls: parsed.toolCalls } : { role: "assistant", content: parsed.content };
    return result(Response.json({ id, object: "chat.completion", created, model, choices: [{ index: 0, message, finish_reason: parsed.finishReason }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }), payload);
  }
}
