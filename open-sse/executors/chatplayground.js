import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { errorResponse } from "../utils/error.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const API = "https://app.chatplayground.ai/api";
const WEB = "https://web.chatplayground.ai";
const CLERK = "https://clerk.chatplayground.ai";
const CLERK_QUERY = "?__clerk_api_version=2025-11-10&_clerk_js_version=5.127.2";

function makeErrorResult(status, message, body, url) {
  return { response: errorResponse(status, message), url, headers: {}, transformedBody: body };
}

function cookieOrJwt(credentials = {}) {
  return credentials.apiKey || credentials.cookie || credentials.accessToken ||
    credentials.providerSpecificData?.cookie || credentials.providerSpecificData?.jwt || "";
}

function parseCookie(raw) {
  const input = String(raw || "").replace(/^Cookie:\s*/i, "").replace(/^Bearer\s+/i, "").trim();
  if (input.split(".").length === 3 && input.startsWith("eyJ")) return { jwt: input };
  const cookies = Object.fromEntries(input.split(";").map((part) => {
    const i = part.indexOf("=");
    return i < 0 ? ["", ""] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }).filter(([name]) => name));
  return cookies;
}

function tokenPayload(token) {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); }
  catch { return null; }
}

async function resolveChatPlaygroundHeaders(raw, fetcher) {
  const parsed = parseCookie(raw);
  if (parsed.jwt) return { ok: true, headers: { Authorization: `Bearer ${parsed.jwt}` } };
  const session = parsed.__session || "";
  const sid = tokenPayload(session)?.sid;
  if (!parsed.__client || !sid) return { ok: false, status: 401 };
  const url = `${CLERK}/v1/client/sessions/${encodeURIComponent(sid)}/tokens${CLERK_QUERY}`;
  let minted;
  try {
    minted = await fetcher(url, {
      method: "POST", redirect: "manual",
      headers: { accept: "*/*", "content-type": "application/x-www-form-urlencoded", origin: WEB, referer: `${WEB}/`, cookie: `__client=${parsed.__client}` },
      body: "organization_id=&token=",
    });
  } catch { return { ok: false, status: 502 }; }
  if (!minted.ok) return { ok: false, status: minted.status };
  const data = await minted.json().catch(() => ({}));
  if (!isString(data.jwt) || !data.jwt) return { ok: false, status: 502 };
  return { ok: true, headers: { Authorization: `Bearer ${data.jwt}` } };
}

export async function validateChatPlaygroundCookie(raw, fetcher = fetch) {
  const auth = await resolveChatPlaygroundHeaders(raw, fetcher);
  if (!auth.ok) {
    const result = { valid: false, status: auth.status };
    if (auth.status >= 300 && auth.status < 400) result.error = "ChatPlayground session was rejected";
    return result;
  }
  let response;
  try {
    response = await fetcher(`${API}/user`, {
      method: "GET", redirect: "manual",
      headers: {
        Accept: "application/json",
        Origin: WEB,
        Referer: `${WEB}/`,
        ...auth.headers,
      },
    });
  } catch {
    return { valid: false, status: 502 };
  }
  if (response.status >= 300 && response.status < 400) return { valid: false, status: response.status, error: "ChatPlayground session was rejected" };
  return { valid: response.ok, status: response.status };
}

function toCatalog(data) {
  const rows = Array.isArray(data) ? data : data?.data || data?.models || [];
  return rows.filter((row) => row && isString(row.botId) && (!row.group || row.group === "chat"))
    .map((row) => ({ id: row.botId, name: row.displayName || row.modelName || row.botId }));
}

export async function discoverChatPlaygroundModels(credentials, fetcher = fetch) {
  const raw = cookieOrJwt(credentials);
  const auth = await resolveChatPlaygroundHeaders(raw, fetcher);
  if (!auth.ok) {
    if (auth.status >= 300 && auth.status < 400) return { error: "ChatPlayground session was rejected", status: 401 };
    return { error: `Failed to validate ChatPlayground session: ${auth.status}`, status: auth.status };
  }
  const headers = { Accept: "application/json", Origin: WEB, Referer: `${WEB}/`, ...auth.headers };
  const response = await fetcher(`${API}/models`, { method: "GET", headers, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) return { error: "ChatPlayground session was rejected", status: 401 };
  if (!response.ok) return { error: `Failed to fetch ChatPlayground models: ${response.status}`, status: response.status };
  return { models: toCatalog(await response.json()) };
}

export function textToOpenAIStream(text, model) {
  const chunks = [];
  const id = `chatcmpl-${randomUUID().slice(0, 12)}`;
  const makeChunk = (content, finishReason = null) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model,
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }] })}\n\n`;
  for (let i = 0; i < text.length; i += 48) chunks.push(makeChunk(text.slice(i, i + 48)));
  chunks.push(makeChunk("", "stop"), "data: [DONE]\n\n");
  return new Response(chunks.join(""), { headers: { "Content-Type": "text/event-stream" } });
}

export function createChatPlaygroundSseStream(upstream, model) {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const id = `chatcmpl-${randomUUID().slice(0, 12)}`;
  let pending = "";
  const chunk = (content, finishReason = null) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model,
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }] })}\n\n`;
  const clean = (value) => value.replace(/CHAT_ID:[a-zA-Z0-9_-]+/g, "").replace(/CITATIONS:[^\n]*/g, "");
  return new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          const combined = pending + (done ? decoder.decode() : decoder.decode(value, { stream: true }));
          const partial = combined.match(/(?:CHAT_ID:[a-zA-Z0-9_-]*|CHAT_?I?D?:?|CHA?T?_?)$/);
          const keep = !done && partial && partial[0].length < 64 ? partial[0] : "";
          const ready = keep ? combined.slice(0, -keep.length) : combined;
          pending = keep;
          const cleaned = clean(ready);
          if (cleaned) controller.enqueue(encoder.encode(chunk(cleaned)));
          if (done) break;
        }
        if (pending) {
          const cleaned = clean(pending);
          if (cleaned) controller.enqueue(encoder.encode(chunk(cleaned)));
        }
        controller.enqueue(encoder.encode(chunk("", "stop")));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) { controller.error(error); }
      finally { reader.releaseLock(); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

export class ChatPlaygroundExecutor extends BaseExecutor {
  constructor(fetcher = fetch) {
    super("chatplayground", { baseUrl: `${API}/chat` });
    this.fetcher = fetcher;
  }

  async execute(input) {
    const { model, body = {}, credentials = {}, stream = body.stream !== false, signal } = input;
    const raw = cookieOrJwt(credentials);
    const auth = await resolveChatPlaygroundHeaders(raw, this.fetcher);
    if (!auth.ok) return makeErrorResult(auth.status === 403 ? 403 : auth.status === 429 ? 429 : 401,
      "ChatPlayground session is missing or expired", body, `${API}/user`);
    const validation = await this.fetcher(`${API}/user`, { headers: { Accept: "application/json", Origin: WEB, Referer: `${WEB}/`, ...auth.headers }, redirect: "manual", signal });
    if (!validation.ok) return makeErrorResult(validation.status === 403 ? 403 : validation.status === 429 ? 429 : 401,
      "ChatPlayground session is missing or expired", body, `${API}/user`);
    const catalogResponse = await this.fetcher(`${API}/models`, { headers: { Accept: "application/json", Origin: WEB, Referer: `${WEB}/` }, redirect: "manual", signal });
    if (catalogResponse.status >= 300 && catalogResponse.status < 400) return makeErrorResult(401, "ChatPlayground session was rejected", body, `${API}/models`);
    if (!catalogResponse.ok) return makeErrorResult(catalogResponse.status, `ChatPlayground model discovery failed (${catalogResponse.status})`, body, `${API}/models`);
    let catalog;
    try { catalog = await catalogResponse.json(); } catch { return makeErrorResult(502, "Invalid ChatPlayground model catalog", body, `${API}/models`); }
    const modelRows = toCatalog(catalog);
    const row = modelRows.find((entry) => entry.id.toLowerCase() === String(model || "").replace(/^(chatplayground|cpl)[/.]/i, "").toLowerCase());
    if (!row) return makeErrorResult(400, `ChatPlayground model not found: ${model || ""}`, body, `${API}/models`);
    const modelData = (Array.isArray(catalog) ? catalog : catalog?.data || catalog?.models || []).find((entry) => entry.botId === row.id) || { botId: row.id, modelName: row.id, endpoint: "azure" };
    const endpoint = ["azure", "lmsys", "perplexity"].includes(modelData.endpoint) ? modelData.endpoint : "azure";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const oversizedIndex = messages.findIndex((message) => {
      const content = message?.content;
      const length = isString(content) ? content.length : Array.isArray(content)
        ? content.reduce((total, part) => total + (isString(part) ? part.length : (isString(part?.text) ? part.text.length : 0)), 0) : 0;
      return length > 15_000;
    });
    if (oversizedIndex >= 0) return makeErrorResult(400, `Message at index ${oversizedIndex} exceeds ChatPlayground's 15000-character limit`, body, `${API}/chat`);
    const payload = endpoint === "perplexity"
      ? { messages, modelName: modelData.modelName || row.id, botId: row.id }
      : endpoint === "lmsys"
        ? { messages, model: modelData.modelName || row.id, botId: row.id }
        : { messages, model: modelData.provider ? `${modelData.provider.toLowerCase()}/${modelData.modelName || row.id}` : (modelData.modelName || row.id), chatId: "", isRegenerate: false, promptTemplate: null, fileUrl: null, botId: row.id, submissionId: randomUUID(), noSave: true };
    const response = await this.fetcher(`${API}/chat/${endpoint}`, {
      method: "POST", redirect: "manual", signal, headers: { Accept: stream ? "text/event-stream" : "*/*", "Content-Type": "application/json", Origin: WEB, Referer: `${WEB}/`,
        ...auth.headers }, body: JSON.stringify(payload),
    });
    if (response.status >= 300 && response.status < 400) return makeErrorResult(401, "ChatPlayground session was rejected", body, `${API}/chat/${endpoint}`);
    if (!response.ok) return makeErrorResult(response.status, `ChatPlayground API error (${response.status})`, body, `${API}/chat/${endpoint}`);
    if (stream && endpoint !== "perplexity" && response.body) {
      return { response: new Response(createChatPlaygroundSseStream(response.body, model), { headers: { "Content-Type": "text/event-stream" } }), url: `${API}/chat/${endpoint}`, headers: {}, transformedBody: payload };
    }
    const text = (await response.text()).replace(/CHAT_ID:[\w-]+/g, "").replace(/CITATIONS:[^\n]*/g, "").trim();
    if (stream) return { response: textToOpenAIStream(text, model), url: `${API}/chat/${endpoint}`, headers: {}, transformedBody: payload };
    return { response: new Response(JSON.stringify({ id: `chatcmpl-${randomUUID().slice(0, 12)}`, object: "chat.completion", model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }), { headers: { "Content-Type": "application/json" } }),
      url: `${API}/chat/${endpoint}`, headers: {}, transformedBody: payload };
  }
}
