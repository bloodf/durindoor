import { createHash, randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { credentialFetch } from "../utils/credentialFetch.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { createErrorResult } from "../utils/error.js";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://hyperagent.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
export const HYPERAGENT_FALLBACK_MODELS = [
  { id: "fable-latest", name: "Fable 5" },
  { id: "opus-latest", name: "Claude Opus Latest" },
  { id: "sonnet-latest", name: "Claude Sonnet Latest" },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "claude-fable-5", name: "Claude Fable 5" },
];
const threadBindings = new Map();
const ownedThreads = new Set();
// A thread belongs to one session cookie AND one gateway API key; two keys on the
// same connection must never continue each other's upstream conversation.
const cookieKey = (cookie, apiKeyId) => createHash("sha256").update(cookie).update("\0").update(String(apiKeyId ?? "")).digest("hex").slice(0, 16);
const ownedKey = (owner, threadId) => `${owner}:${threadId}`;
function rememberOwnedThread(owner, threadId) {
  const key = ownedKey(owner, threadId);
  ownedThreads.delete(key);
  ownedThreads.add(key);
  while (ownedThreads.size > 1000) ownedThreads.delete(ownedThreads.values().next().value);
}
function rootThreadKey(cookie, messages, apiKeyId) {
  const firstUser = messages.find((item) => ["user", "human"].includes(String(item.role).toLowerCase()));
  const text = contentText(firstUser?.content).trim();
  if (!text) return "";
  return `${cookieKey(cookie, apiKeyId)}:${createHash("sha256").update(text.slice(0, 2000)).digest("hex").slice(0, 24)}`;
}

function cookieFrom(credentials = {}) {
  const data = credentials.providerSpecificData || {};
  return String(credentials.apiKey || credentials.cookie || credentials.accessToken || data.cookie || data.sessionCookie || data.authCookie || data.Cookie || "")
    .trim().replace(/^Cookie:\s*/i, "").trim();
}

function selectedModel(model) {
  const id = String(model || "opus-latest").replace(/^(hyperagent|ha|hyper)\//i, "").trim();
  const lower = id.toLowerCase();
  const aliases = { opus: "opus-latest", sonnet: "sonnet-latest", fable: "fable-latest", "claude-opus-latest": "opus-latest", "claude-sonnet-latest": "sonnet-latest" };
  return aliases[lower] || HYPERAGENT_FALLBACK_MODELS.find((item) => item.id.toLowerCase() === lower || item.name.toLowerCase() === lower)?.id || id || "opus-latest";
}

function contentText(content) {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (isString(part)) return part;
    if (!isRecord(part)) return "";
    if (part.type === "tool_result" || part.type === "function_result") return contentText(part.content ?? part.output ?? part.result ?? "");
    return isString(part.text) ? part.text : isString(part.content) ? part.content : "";
  }).filter(Boolean).join("\n");
}

function browserHeaders(cookie, extra = {}) {
  return { accept: "*/*", "accept-language": "en-US,en;q=0.9", cookie, origin: ORIGIN, referer: `${ORIGIN}/`, "user-agent": USER_AGENT, ...extra };
}

function errorResult(status, message, body, credentials) {
  const safeMessage = status === 401 ? "HyperAgent session cookie is expired or invalid. Re-import the Cookie header." :
    status === 429 ? "HyperAgent quota or rate limit exceeded." : message;
  return createErrorResult(status, safeMessage, null, null, null, credentials);
}

async function readThreadId(response) {
  const location = response.headers.get("location") || "";
  const fromLocation = location.match(/\/thread\/([A-Za-z0-9_-]{10,})/i)?.[1] || location.match(/(cm[a-z0-9]{20,})/i)?.[1];
  if (fromLocation) return fromLocation;
  if (!response.ok) return "";
  const result = await response.json().catch(() => ({}));
  return String(result.id || result.threadId || result.thread_id || result.thread?.id || "");
}

async function parseSse(response) {
  if (!response.body) throw new Error("HyperAgent returned an empty event stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "", sessionId = "", modelId = "";
  const handle = (payload) => {
    if (!payload || payload === "[DONE]") return;
    let event;
    try { event = JSON.parse(payload); } catch { return; }
    if (!isRecord(event)) return;
    if (event.type === "text") text += isString(event.content) ? event.content : "";
    if (event.type === "session_start" && event.sessionId) sessionId = String(event.sessionId);
    if (event.type === "thread_runtime_latched" && event.modelId) modelId = String(event.modelId);
    if (event.type === "error" || event.type === "stream_error") {
      const message = event.content || event.message || event.error || "HyperAgent stream error";
      throw Object.assign(new Error(message), { status: event.status || (/quota|rate.?limit|credit/i.test(String(message)) ? 429 : undefined) });
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n"); buffer = lines.pop() || "";
    for (const line of lines) if (line.trimEnd().startsWith("data:")) handle(line.trimEnd().slice(5).trimStart());
  }
  buffer += decoder.decode();
  if (buffer.trim().startsWith("data:")) handle(buffer.trim().slice(5).trimStart());
  return { text, sessionId, modelId };
}

function completion(text, model, threadId, sessionId, messages, stream) {
  const id = `chatcmpl-ha-${threadId || randomUUID()}`, created = Math.floor(Date.now() / 1000);
  const headers = { "content-type": stream ? "text/event-stream" : "application/json" };
  if (threadId) headers["x-hyperagent-thread-id"] = threadId;
  if (sessionId) headers["x-hyperagent-session-id"] = sessionId;
  if (!stream) {
    const prompt = messages.map((item) => contentText(item.content)).join("\n");
    return new Response(JSON.stringify({ id, object: "chat.completion", created, model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: Math.max(1, Math.ceil(prompt.length / 4)), completion_tokens: Math.max(1, Math.ceil(text.length / 4)), total_tokens: Math.max(2, Math.ceil(prompt.length / 4) + Math.ceil(text.length / 4)), estimated: true }, hyperagent_thread_id: threadId, hyperagent_session_id: sessionId }), { headers });
  }
  const encoder = new TextEncoder();
  const chunk = (delta, finish_reason = null) => ({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: delta ? { content: delta } : {}, finish_reason }] });
  const readable = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk(text))}\n\n`));
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk("", "stop"))}\n\n`));
    controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
  } });
  return new Response(readable, { headers });
}

export class HyperAgentExecutor extends BaseExecutor {
  constructor(deps = {}) {
    super("hyperagent", { id: "hyperagent", baseUrl: `${ORIGIN}/api/threads` });
    this.fetch = deps.fetch || ((...args) => proxyAwareFetch(...args));
  }

  async request(url, init, signal, proxyOptions = null) {
    return credentialFetch((target, request) => this.fetch(target, request, proxyOptions), url, { ...init, signal, redirect: "manual" });
  }

  async execute(input) {
    const body = input.body || {};
    const credentials = input.credentials || {};
    const cookie = cookieFrom(credentials);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const userText = [...messages].reverse().find((item) => ["user", "human", "tool", "function"].includes(String(item.role).toLowerCase()));
    if (!cookie) return errorResult(401, "Missing HyperAgent session cookie", body, credentials);
    if (!userText || !contentText(userText.content).trim()) return errorResult(400, "No user message found", body, credentials);
    const model = selectedModel(input.model || body.model);
    const owner = cookieKey(cookie, input.apiKeyId);
    let threadId = String(body.hyperagent_thread_id || body.thread_id || input.clientHeaders?.["x-hyperagent-thread-id"] || "");
    let sessionId = String(body.hyperagent_session_id || body.session_id || input.clientHeaders?.["x-hyperagent-session-id"] || "");
    // Only a thread this API key created on this cookie may be continued by id.
    if (threadId && !ownedThreads.has(ownedKey(owner, threadId))) { threadId = ""; sessionId = ""; }
    const bindingKey = rootThreadKey(cookie, messages, input.apiKeyId);
    const existingBinding = bindingKey ? threadBindings.get(bindingKey) : null;
    if (!threadId && existingBinding && messages.some((message) => message.role === "assistant")) {
      threadId = existingBinding.threadId;
      sessionId = sessionId || existingBinding.sessionId;
    }
    try {
      if (!threadId) {
        const created = await this.request(`${ORIGIN}/api/threads`, { method: "POST", headers: browserHeaders(cookie, { "content-type": "application/json", "x-request-id": randomUUID() }), body: "{}" }, input.signal, input.proxyOptions);
        if (created.status === 401 || created.status === 403 || (created.status >= 300 && created.status < 400)) return errorResult(401, "Expired HyperAgent cookie", body, credentials);
        threadId = await readThreadId(created);
        if (threadId) rememberOwnedThread(owner, threadId);
        if (!threadId) return errorResult(created.status === 429 ? 429 : created.status >= 400 ? created.status : 502, `Could not create HyperAgent thread (HTTP ${created.status})`, body, credentials);
      }
      const family = /fable/i.test(model) ? "fable" : /sonnet/i.test(model) ? "sonnet" : "opus";
      const configured = await this.request(`${ORIGIN}/api/threads/${encodeURIComponent(threadId)}`, { method: "PATCH", headers: browserHeaders(cookie, { "content-type": "application/json", "x-request-id": randomUUID(), referer: `${ORIGIN}/thread/${threadId}` }), body: JSON.stringify({ modelId: model, defaultSubagentModel: family, runtimeId: "claude-agents-sdk", executionMode: "auto" }) }, input.signal, input.proxyOptions);
      if (configured.status === 401 || configured.status === 403) return errorResult(401, "Expired HyperAgent cookie", body, credentials);
      if (!configured.ok) return errorResult(configured.status === 429 ? 429 : configured.status, `HyperAgent thread configuration failed (HTTP ${configured.status})`, body, credentials);
      const chat = await this.request(`${ORIGIN}/api/threads/${encodeURIComponent(threadId)}/chat`, { method: "POST", headers: browserHeaders(cookie, { "content-type": "application/json", referer: `${ORIGIN}/thread/${threadId}`, "x-request-id": randomUUID() }), body: JSON.stringify({ sessionId: sessionId || null, unifiedStream: true, searchMode: "exa", enableExecuteScript: false, enablePersistentSandbox: true, enableWebpage: true, enableSlides: true, tablesEnabled: true, enableWebSearch: true, enableBrowser: true, enableImageGeneration: true, enableVideoGeneration: true, enableAudioGeneration: true, enableTranscription: true, enableAvatarVideo: true, enableExaFindSimilar: true, enableExaAnswer: true, enableExaResearch: true, enableExaWebsets: true, enableGeoTools: true, hyperAppsEnabled: false, documentsEnabled: true, enableThreadSearch: true, residentialProxyEnabled: false, solveCaptchasEnabled: true, content: contentText(userText.content), debug: false, enabledIntegrations: [], integrationMode: "open", globalTablesEnabled: true }) }, input.signal, input.proxyOptions);
      if (chat.status === 401 || chat.status === 403) return errorResult(401, "Expired HyperAgent cookie", body, credentials);
      if (!chat.ok) return errorResult(chat.status === 429 ? 429 : chat.status, `HyperAgent chat HTTP ${chat.status}`, body, credentials);
      const parsed = await parseSse(chat);
      if (!parsed.text.trim()) return errorResult(502, "HyperAgent returned empty assistant content", body, credentials);
      if (bindingKey) {
        threadBindings.set(bindingKey, { threadId, sessionId: parsed.sessionId || sessionId });
        while (threadBindings.size > 200) threadBindings.delete(threadBindings.keys().next().value);
      }
      return { response: completion(parsed.text.trim(), parsed.modelId || model, threadId, parsed.sessionId || sessionId, messages, input.stream ?? body.stream), url: `${ORIGIN}/api/threads/${encodeURIComponent(threadId)}/chat`, headers: { Cookie: "***" }, transformedBody: { threadId, sessionId: parsed.sessionId || sessionId, model: parsed.modelId || model } };
    } catch (error) {
      const status = error.status === 429 || /quota|rate.?limit|credits? exceeded/i.test(error.message || "") ? 429 : error.status === 401 || error.status === 403 || error.name === "CredentialRedirectError" ? 401 : 502;
      return errorResult(status, status === 401 ? "HyperAgent session cookie is expired or invalid" : error.message || "HyperAgent request failed", body, credentials);
    }
  }
}
