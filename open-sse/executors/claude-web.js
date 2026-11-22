import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { PROVIDERS } from "../config/providers.js";
import { buildErrorBody } from "../utils/error.js";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

const BASE = "https://claude.ai/api";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const sessions = new Map();

export function normalizeClaudeWebCookie(raw) {
  const value = String(raw || "").replace(/^\s*cookie:\s*/i, "").trim();
  const pairs = value.split(";").map((part) => part.trim()).filter(Boolean);
  const cookie = pairs.some((part) => part.startsWith("sessionKey=")) ? pairs.join("; ") : `sessionKey=${value}`;
  return /(?:^|;\s*)sessionKey=([^;\s]+)/.test(cookie) ? cookie : "";
}

function responseError(status, message) {
  return new Response(JSON.stringify(buildErrorBody(status, message, undefined, { type: "upstream_error", code: `HTTP_${status}` })), { status, headers: { "content-type": "application/json" } });
}
function headers(cookie, referer = "https://claude.ai/new") {
  return { Accept: "text/event-stream", "Content-Type": "application/json", Origin: "https://claude.ai", Referer: referer, "User-Agent": UA, "anthropic-client-platform": "web_claude_ai", Cookie: cookie };
}
async function readSse(response, model, stream) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "", output = "", finished = false;
  const chunks = [];
  async function* events() {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const frame = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data || data === "[DONE]") continue;
        if (frame.split(/\r?\n/).some((line) => line.trim() === "event: error")) {
          let error;
          try { error = JSON.parse(data); } catch { error = {}; }
          const code = error?.error?.type || error?.type || "";
          const status = code === "rate_limit_error" || code === "overloaded_error" ? 429 : 502;
          throw Object.assign(new Error(error?.error?.message || error?.message || "Claude Web upstream error"), { status });
        }
        try {
          const event = JSON.parse(data);
          if (isRecord(event) && event.type === "content_block_delta" && isRecord(event.delta) && event.delta.type === "text_delta" && isString(event.delta.text)) yield event.delta.text;
          if (event.type === "message_delta" && event.delta?.stop_reason) finished = true;
        } catch { /* ignore non-JSON telemetry */ }
      }
      if (done) return;
    }
  }
  for await (const text of events()) {
    output += text;
    chunks.push(`data: ${JSON.stringify({ id: "chatcmpl-claude-web", object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`);
  }
  chunks.push(`data: ${JSON.stringify({ id: "chatcmpl-claude-web", object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: {}, finish_reason: finished ? "stop" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  if (stream) return new Response(encoder.encode(chunks.join("")), { headers: { "content-type": "text/event-stream" } });
  return new Response(JSON.stringify({ id: "chatcmpl-claude-web", object: "chat.completion", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, message: { role: "assistant", content: output }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
}

export class ClaudeWebExecutor extends BaseExecutor {
  constructor() { super("claude-web", { id: "claude-web", baseUrl: BASE }); }
  async testConnection(credentials) {
    const cookie = normalizeClaudeWebCookie(credentials?.apiKey || credentials?.cookie);
    if (!cookie) return false;
    try {
      const response = await proxyAwareFetch("https://claude.ai/api/organizations", { method: "GET", headers: headers(cookie), redirect: "manual", signal: AbortSignal.timeout(8000) });
      return response.status === 200 && Array.isArray(await response.json());
    } catch { return false; }
  }
  async execute(input) {
    const cookie = normalizeClaudeWebCookie(input.credentials?.apiKey || input.credentials?.cookie);
    if (!cookie) return { response: responseError(401, "Missing or invalid sessionKey cookie"), url: BASE, headers: {}, transformedBody: input.body };
    const common = headers(cookie);
    const fetcher = input.fetcher || proxyAwareFetch;
    try {
      const organizations = await fetcher(`${BASE}/organizations`, { method: "GET", headers: common, signal: input.signal });
      if (organizations.status === 401 || organizations.status === 403) return { response: responseError(401, "Claude Web session expired or invalid"), url: `${BASE}/organizations`, headers: common, transformedBody: input.body };
      if (!organizations.ok) return { response: responseError(organizations.status, "Claude Web organization lookup failed"), url: `${BASE}/organizations`, headers: common, transformedBody: input.body };
      const orgs = await organizations.json();
      const org = Array.isArray(orgs) ? orgs[0] : null;
      const orgId = org?.uuid || org?.id;
      if (!orgId) return { response: responseError(502, "No Claude Web organization found"), url: `${BASE}/organizations`, headers: common, transformedBody: input.body };
      if (input.body?.stream === false) {
        // Claude Web's API still emits SSE; OpenAI JSON is assembled below.
      }
      const messages = Array.isArray(input.body?.messages) ? input.body.messages.filter(isRecord) : [];
      const prompt = messages.filter((m) => m.role === "user").map((m) => isString(m.content) ? m.content : Array.isArray(m.content) ? m.content.filter(isRecord).map((p) => isString(p.text) ? p.text : "").join("\n") : "").join("\n\n");
      if (!prompt.trim()) return { response: responseError(400, "No user message found in request"), url: BASE, headers: common, transformedBody: input.body };
      const model = input.model || "claude-sonnet-4-6";
      const scope = `${input.credentials?.connectionId || cookie}:${orgId}:${model}`;
      let conversationId = sessions.get(scope);
      const assistantId = randomUUID();
      const payload = {
        prompt, model, timezone: "UTC", locale: "en-US", personalized_styles: [{ type: "default", key: "Default", name: "Normal", nameKey: "normal_style_name", prompt: "Normal\n", summary: "Default responses from Claude", summaryKey: "normal_style_summary", isDefault: true }],
        tools: [], turn_message_uuids: { human_message_uuid: randomUUID(), assistant_message_uuid: assistantId },
        attachments: [], effort: "low", files: [], sync_sources: [], rendering_mode: "messages", thinking_mode: "off",
      };
      if (!conversationId) payload.create_conversation_params = { name: "", model, include_conversation_preferences: true, paprika_mode: null, compass_mode: null, is_temporary: false, enabled_imagine: false, tool_search_mode: "auto" };
      if (!conversationId) conversationId = randomUUID();
      const url = `${BASE}/organizations/${encodeURIComponent(orgId)}/chat_conversations/${encodeURIComponent(conversationId)}/completion`;
      const upstream = await fetcher(url, { method: "POST", headers: headers(cookie, `https://claude.ai/${sessions.has(scope) ? `chat/${conversationId}` : "new"}`), body: JSON.stringify(payload), signal: input.signal });
      if (upstream.status === 401 || upstream.status === 403) return { response: responseError(401, "Claude Web session expired or invalid"), url, headers: common, transformedBody: input.body };
      if (upstream.status === 429) return { response: responseError(429, "Claude Web quota or rate limit reached"), url, headers: common, transformedBody: input.body };
      if (!upstream.ok || !upstream.body) return { response: responseError(upstream.status || 502, `Claude Web request failed (HTTP ${upstream.status || 502})`), url, headers: common, transformedBody: input.body };
      const response = await readSse(upstream, model, input.stream === true || input.body?.stream === true);
      sessions.set(scope, conversationId);
      return { response, url, headers: common, transformedBody: input.body };
    } catch (error) {
      return { response: responseError(error?.status || 502, error?.message || (error?.name === "AbortError" ? "Claude Web request timed out" : "Claude Web connection failed")), url: BASE, headers: {}, transformedBody: input.body };
    }
  }
  buildUrl(model, stream) { return PROVIDERS["claude-web"]?.baseUrl || BASE; }
  buildHeaders(credentials) { return headers(normalizeClaudeWebCookie(credentials?.apiKey)); }
}
export default ClaudeWebExecutor;
