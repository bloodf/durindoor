import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { errorResponse } from "../utils/error.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const ORIGIN = "https://app.notion.com";
const INFERENCE = `${ORIGIN}/api/v3/runInferenceTranscript`;
const MODELS = `${ORIGIN}/api/v3/getAvailableModels`;
const SPACES = `${ORIGIN}/api/v3/getSpaces`;
const sessions = new Map();

export function normalizeNotionCookie(raw = "") {
  const value = String(raw).trim();
  if (!value) return "";
  return value.includes("=") ? value : `token_v2=${value}`;
}

export function notionCookie(credentials = {}) {
  const ps = credentials.providerSpecificData || {};
  return normalizeNotionCookie(credentials.apiKey || credentials.cookie || ps.cookie || ps.token_v2 || ps.tokenV2 || "");
}

function cookieValue(cookie, name) {
  return cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`, "i"))?.[1] || "";
}

function headers(cookie, spaceId = "", userId = "") {
  const result = {
    accept: "application/x-ndjson, application/json, */*", "content-type": "application/json",
    cookie, origin: ORIGIN, referer: `${ORIGIN}/ai`, "user-agent": "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36",
    "notion-client-version": "23.13.20260720.1949", "notion-audit-log-platform": "web",
  };
  if (spaceId) result["x-notion-space-id"] = spaceId;
  if (userId) result["x-notion-active-user-header"] = userId;
  return result;
}

async function request(url, init, fetcher) {
  return fetcher(url, init);
}

function parseModels(json) {
  const rows = Array.isArray(json?.models) ? json.models : [];
  const models = rows.filter((row) => row && isString(row.model) && row.isDisabled !== true).map((row) => ({ id: row.modelMessage || row.model, name: row.modelMessage || row.model }));
  return models.length ? models : [{ id: "notion-ai", name: "Notion AI (default)" }];
}

export async function discoverNotionModels(cookie, fetcher = proxyAwareFetch) {
  let spaceId = cookieValue(cookie, "space_id");
  const userId = cookieValue(cookie, "notion_user_id") || cookieValue(cookie, "user_id");
  if (!spaceId) {
    const spaces = await request(SPACES, { method: "POST", headers: headers(cookie, "", userId), body: "{}" }, fetcher);
    if (spaces.status === 401 || spaces.status === 403) throw Object.assign(new Error("Notion session expired"), { status: spaces.status });
    const data = await spaces.json();
    for (const item of Object.values(data || {})) {
      const ids = Object.keys(item?.space || {});
      if (ids.length) { spaceId = ids[0]; break; }
    }
  }
  if (!spaceId) throw Object.assign(new Error("Could not resolve a Notion workspace; include space_id in the Cookie header"), { status: 400 });
  const response = await request(MODELS, { method: "POST", headers: headers(cookie, spaceId, userId), body: JSON.stringify({ spaceId }) }, fetcher);
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Notion session expired"), { status: response.status });
  if (!response.ok) throw Object.assign(new Error(`Notion model discovery failed (${response.status})`), { status: response.status });
  return { spaceId, userId, models: parseModels(await response.json()) };
}

function transcript(messages, model, spaceId, userId) {
  return [{ type: "config", value: { model: model || "notion-ai" } }, { type: "context", value: { spaceId, userId } }, ...messages.map((message) => ({ type: "step", value: { type: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user", content: isString(message.content) ? message.content : JSON.stringify(message.content) } }))];
}

export function parseNotionInference(raw) {
  const fragments = [];
  for (const line of String(raw).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const text = row?.value?.text || row?.text || row?.value?.content || row?.content;
      if (isString(text)) fragments.push(text);
    } catch { /* NDJSON may include non-JSON keepalive lines. */ }
  }
  return fragments.join("");
}

export class NotionWebExecutor extends BaseExecutor {
  constructor(deps = {}) { super("notion-web", { id: "notion-web", baseUrl: INFERENCE }); this.fetcher = deps.fetcher || proxyAwareFetch; }
  async execute(input) {
    const cookie = notionCookie(input.credentials);
    const body = input.body || {};
    if (!cookie || !/(?:^|;\\s*)token_v2=/i.test(cookie)) return this.fail(401, "Missing Notion token_v2 cookie", body);
    if (!Array.isArray(body.messages) || !body.messages.some((message) => message.role === "user")) return this.fail(400, "No user message found", body);
    try {
      const { spaceId, userId } = await discoverNotionModels(cookie, this.fetcher);
      const clientId = input.clientHeaders?.["x-notion-thread-id"] || body.notion_thread_id || "";
      const scope = `${cookieValue(cookie, "notion_user_id")}:${spaceId}:${input.credentials?.connectionId || ""}`;
      const key = `${scope}:${clientId || body.messages.filter((m) => m.role === "user").map((m) => m.content).join("|").slice(0, 100)}`;
      const oldId = sessions.get(key);
      const threadId = oldId || randomUUID();
      const payload = { traceId: randomUUID(), spaceId, threadId, createThread: !oldId, generateTitle: !oldId, asPatchResponse: true, patchResponseVersion: 2, isPartialTranscript: Boolean(oldId), saveAllThreadOperations: true, setUnreadState: !oldId, createdSource: "ai_module", threadType: "workflow", transcript: transcript(body.messages, body.model, spaceId, userId), threadParentPointer: { table: "space", id: spaceId, spaceId }, debugOverrides: { annotationInferences: {}, cachedInferences: {}, emitAgentSearchExtractedResults: true, emitInferences: false } };
      const response = await request(INFERENCE, { method: "POST", headers: headers(cookie, spaceId, userId), body: JSON.stringify(payload), signal: input.signal }, this.fetcher);
      if (response.status === 401 || response.status === 403) return this.fail(response.status, "Notion session expired or invalid; re-import token_v2", body);
      if (response.status === 429) return this.fail(429, "Notion AI quota or rate limit reached", body);
      if (!response.ok) return this.fail(response.status >= 500 ? 502 : response.status, `Notion inference failed (${response.status})`, body);
      const text = parseNotionInference(await response.text());
      if (!text) return this.fail(502, "Notion returned no assistant text", body);
      sessions.set(key, threadId);
      const model = String(body.model || "notion-ai").replace(/^(notion-web|nw)\//, "");
      const id = `chatcmpl-notion-${threadId}`;
      const chunk = (content, finish_reason = null) => ({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: content ? { content } : {}, finish_reason }] });
      const result = body.stream ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk(text))}\n\ndata: ${JSON.stringify(chunk("", "stop"))}\n\ndata: [DONE]\n\n`)); controller.close(); } }), { headers: { "content-type": "text/event-stream", "x-notion-thread-id": threadId } }) : new Response(JSON.stringify({ id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json", "x-notion-thread-id": threadId } });
      return { response: result, url: INFERENCE, headers: headers(cookie, spaceId, userId), transformedBody: payload };
    } catch (error) {
      return this.fail(error.status || 502, error.message || "Notion request failed", body);
    }
  }
  fail(status, message, body) { return { response: errorResponse(status, message, { type: "upstream_error", code: `HTTP_${status}` }), url: INFERENCE, headers: {}, transformedBody: body }; }
}

export default NotionWebExecutor;
