import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const BASE = "https://chat.deepseek.com/api";
const HEADERS = {
  Accept: "*/*",
  "Content-Type": "application/json",
  Origin: "https://chat.deepseek.com",
  Referer: "https://chat.deepseek.com/",
  "X-Client-Bundle-Id": "com.deepseek.chat",
  "X-Client-Locale": "en-US",
  "X-Client-Platform": "web",
  "X-Client-Version": "2.0.0",
};

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json" },
});

function userToken(credentials) {
  const raw = credentials?.apiKey;
  if (!isString(raw) || !raw.trim()) return "";
  try {
    const wrapped = JSON.parse(raw);
    if (isString(wrapped?.value)) return wrapped.value;
  } catch { /* raw token */ }
  return raw.trim();
}

function promptFrom(messages = []) {
  const usable = messages.map((message) => {
    const role = message.role === "developer" ? "system" : String(message.role || "user");
    const content = isString(message.content)
      ? message.content
      : Array.isArray(message.content)
        ? message.content.filter((part) => part?.type === "text").map((part) => part.text || "").join(" ")
        : "";
    return { role, content };
  }).filter((message) => message.content.trim());
  const lastUser = usable.findLastIndex((message) => message.role === "user");
  return usable.map((message, index) => index === lastUser ? message.content : `${message.role}: ${message.content}`).join("\n\n");
}

async function readEvents(body) {
  const text = await body.text();
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const raw = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!raw || raw === "[DONE]") continue;
    try { events.push(JSON.parse(raw)); } catch { /* ignore framing and metadata lines */ }
  }
  return events;
}

function contentFrom(events) {
  let content = "";
  let reasoning = "";
  for (const event of events) {
    const delta = event?.choices?.[0]?.delta;
    if (delta) {
      content += delta.content || "";
      reasoning += delta.reasoning_content || "";
    }
    const payload = event?.data?.biz_data || event?.biz_data || event?.data;
    const fragment = payload?.response || payload?.content || payload?.message?.content;
    if (isString(fragment)) content += fragment;
  }
  return { content, reasoning };
}

export class DeepSeekWebExecutor extends BaseExecutor {
  constructor() { super("deepseek-web", PROVIDERS["deepseek-web"]); }

  async execute({ model, body, stream, credentials, signal }) {
    const token = userToken(credentials);
    if (!token) return { response: json({ error: { message: "DeepSeek Web requires a web userToken from local storage", type: "authentication_error", code: "HTTP_401" } }, 401), url: `${BASE}/v0/chat/completion`, headers: {}, transformedBody: body };
    const prompt = promptFrom(body?.messages);
    if (!prompt) return { response: json({ error: { message: "A non-empty user message is required", type: "invalid_request_error" } }, 400), url: `${BASE}/v0/chat/completion`, headers: {}, transformedBody: body };
    const common = { ...HEADERS, Authorization: `Bearer ${token}` };
    const sessionRejected = (url, headers) => ({ response: json({ error: { message: "DeepSeek web session was rejected", type: "authentication_error", code: "HTTP_401" } }, 401), url, headers, transformedBody: body });
    const post = (url, payload, headers = common) => fetch(url, { method: "POST", headers, body: JSON.stringify(payload), redirect: "manual", signal });
    try {
      const current = await fetch(`${BASE}/v0/users/current`, { headers: common, redirect: "manual", signal });
      if (current.status >= 300 && current.status < 400) return sessionRejected(`${BASE}/v0/users/current`, common);
      if (!current.ok) return { response: json({ error: { message: current.status === 401 || current.status === 403 ? "DeepSeek web userToken is invalid or expired" : `DeepSeek users/current returned HTTP ${current.status}`, type: "upstream_error", code: `HTTP_${current.status}` } }, current.status), url: `${BASE}/v0/users/current`, headers: common, transformedBody: body };
      const currentData = await current.json();
      const accessToken = currentData?.data?.biz_data?.token || currentData?.biz_data?.token;
      if (!accessToken) return { response: json({ error: { message: "DeepSeek did not return an access token for this userToken", type: "upstream_error", code: "HTTP_401" } }, 401), url: `${BASE}/v0/users/current`, headers: common, transformedBody: body };
      const authHeaders = { ...HEADERS, Authorization: `Bearer ${accessToken}` };
      const sessionResponse = await fetch(`${BASE}/v0/chat_session/create`, { method: "POST", headers: { ...authHeaders, Cookie: "intercom-HWWAFSESTIME=0; HWWAFSESTIME=0" }, body: "{}", redirect: "manual", signal });
      if (sessionResponse.status >= 300 && sessionResponse.status < 400) return sessionRejected(`${BASE}/v0/chat_session/create`, authHeaders);
      if (!sessionResponse.ok) return { response: json({ error: { message: `DeepSeek session creation returned HTTP ${sessionResponse.status}`, type: "upstream_error", code: `HTTP_${sessionResponse.status}` } }, sessionResponse.status), url: `${BASE}/v0/chat_session/create`, headers: authHeaders, transformedBody: body };
      const sessionData = await sessionResponse.json();
      const sessionId = sessionData?.data?.biz_data?.chat_session?.id || sessionData?.biz_data?.chat_session?.id;
      if (!sessionId) return { response: json({ error: { message: "DeepSeek did not return a chat session id", type: "upstream_error" } }, 502), url: `${BASE}/v0/chat_session/create`, headers: authHeaders, transformedBody: body };
      const modelId = String(model || "deepseek-chat");
      const lower = modelId.toLowerCase();
      const payload = {
        chat_session_id: sessionId,
        parent_message_id: null,
        model_type: /pro|expert/.test(lower) ? "expert" : "default",
        prompt,
        ref_file_ids: [],
        thinking_enabled: /think|reason|r1/.test(lower) || body?.thinking === true || body?.reasoning_effort != null,
        search_enabled: /search/.test(lower) || body?.search === true || body?.web_search === true,
        preempt: false,
      };
      const completion = await post(`${BASE}/v0/chat/completion`, payload, { ...authHeaders, Cookie: "intercom-HWWAFSESTIME=0; HWWAFSESTIME=0" });
      if (completion.status >= 300 && completion.status < 400) return sessionRejected(`${BASE}/v0/chat/completion`, authHeaders);
      if (!completion.ok) {
        const status = completion.status === 401 || completion.status === 403 ? 401 : completion.status === 429 ? 429 : completion.status;
        const message = status === 401 ? "DeepSeek web session expired or is unauthorized" : status === 429 ? "DeepSeek web quota or rate limit reached" : `DeepSeek completion returned HTTP ${completion.status}`;
        return { response: json({ error: { message, type: "upstream_error", code: `HTTP_${status}` } }, status), url: `${BASE}/v0/chat/completion`, headers: authHeaders, transformedBody: payload };
      }
      const events = await readEvents(completion);
      const result = contentFrom(events);
      const cid = `chatcmpl-dsweb-${crypto.randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);
      const message = { role: "assistant", content: result.content };
      if (result.reasoning) message.reasoning_content = result.reasoning;
      if (!stream) return { response: json({ id: cid, object: "chat.completion", created, model: modelId, choices: [{ index: 0, message, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }), url: `${BASE}/v0/chat/completion`, headers: authHeaders, transformedBody: payload };
      const chunks = [{ role: "assistant" }, ...(result.reasoning ? [{ reasoning_content: result.reasoning }] : []), ...(result.content ? [{ content: result.content }] : []), {}];
      const sse = chunks.map((delta, index) => `data: ${JSON.stringify({ id: cid, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta, finish_reason: index === chunks.length - 1 ? "stop" : null }] })}\n\n`).join("") + "data: [DONE]\n\n";
      return { response: new Response(sse, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }), url: `${BASE}/v0/chat/completion`, headers: authHeaders, transformedBody: payload };
    } catch (error) {
      const status = error?.name === "AbortError" ? 499 : 502;
      return { response: json({ error: { message: error?.message || "DeepSeek Web request failed", type: "upstream_error", code: `HTTP_${status}` } }, status), url: `${BASE}/v0/chat/completion`, headers: common, transformedBody: body };
    }
  }
}

export default DeepSeekWebExecutor;
