import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import {
  collectTextFromEvents,
  errorJson,
  normalizeOpenAIMessages,
  openAICompletion,
  streamingTextResponse,
} from "./web-chat-utils.js";

export const T3_CHAT_BASE = "https://t3.chat";
const T3_CHAT_URL = `${T3_CHAT_BASE}/api/chat`;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function webFetch(url, options, proxyOptions) {
  return proxyOptions ? proxyAwareFetch(url, options, proxyOptions) : fetch(url, options);
}

export function parseT3Credentials(credentials) {
  const raw = String(credentials?.apiKey ?? credentials?.accessToken ?? "").trim();
  if (!raw) return { cookieHeader: "", cookies: "", convexSessionId: "" };
  let cookieHeader = raw.replace(/^cookie\s*:\s*/i, "");
  let convexSessionId = "";

  if (/convexSessionId=|cookies=/.test(raw)) {
    const cookieParts = [];
    for (const part of raw.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean)) {
      if (part.startsWith("convexSessionId=")) convexSessionId = part.slice("convexSessionId=".length);
      else if (part.startsWith("convex-session-id=")) convexSessionId = part.slice("convex-session-id=".length);
      else if (part.startsWith("cookies=")) cookieParts.push(part.slice("cookies=".length));
      else if (part.includes("=")) cookieParts.push(part);
    }
    if (cookieParts.length) cookieHeader = cookieParts.join("; ");
  }

  const embedded = cookieHeader.match(/(?:^|;\s*)convex-session-id=([^;]+)/);
  if (!convexSessionId && embedded) convexSessionId = embedded[1].trim();
  if (convexSessionId && !embedded) cookieHeader = `${cookieHeader}; convex-session-id=${convexSessionId}`;
  return { cookieHeader, cookies: cookieHeader, convexSessionId };
}

export function validateT3Credentials(parsed) {
  return !!(parsed?.cookieHeader && parsed?.convexSessionId);
}

function buildHeaders(cookieHeader) {
  return {
    "Content-Type": "application/json",
    Accept: "application/x-tss-framed, application/x-ndjson, text/event-stream, application/json",
    Cookie: cookieHeader,
    "User-Agent": USER_AGENT,
    Origin: T3_CHAT_BASE,
    Referer: `${T3_CHAT_BASE}/`,
  };
}

function t3Message(role, content) {
  return {
    id: randomUUID(),
    role,
    parts: [{ type: "text", text: content }],
  };
}

export function buildT3ChatBody({ messages, model, parsed, stream }) {
  const normalized = normalizeOpenAIMessages(messages);
  const t3Messages = [];
  const systemParts = [];
  if (normalized.systemMsg) systemParts.push(normalized.systemMsg);
  if (normalized.history.length > 0) {
    systemParts.push(`Prior conversation:\n\n${normalized.history.map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.content}`).join("\n\n")}`);
  }
  if (systemParts.length > 0) t3Messages.push(t3Message("system", systemParts.join("\n\n")));
  if (normalized.currentMsg) t3Messages.push(t3Message("user", normalized.currentMsg));

  return {
    model,
    messages: t3Messages,
    stream: stream !== false,
    convexSessionId: parsed.convexSessionId,
    threadMetadata: {
      convexSessionId: parsed.convexSessionId,
      source: "durindoor-openai-compatible",
    },
    responseId: randomUUID(),
  };
}

export function extractT3Delta(event) {
  if (event?.done === true || event?.type === "done" || event?.status === "complete" || event?.finish_reason === "stop") return "__DONE__";
  if (typeof event?.text === "string") return event.text;
  if (typeof event?.delta === "string") return event.delta;
  if (typeof event?.content === "string") return event.content;
  if (event?.t === 2 && typeof event?.s === "string") return event.s;
  const keys = event?.p?.k;
  const values = event?.p?.v;
  if (Array.isArray(keys) && Array.isArray(values)) {
    for (let i = 0; i < keys.length; i++) {
      if (!["content", "text", "delta"].includes(keys[i])) continue;
      const value = values[i];
      if (typeof value === "string") return value;
      if (value?.t === 2 && typeof value.s === "string") return value.s;
    }
  }
  return "";
}

export class T3WebExecutor extends BaseExecutor {
  constructor() {
    super("t3-web", PROVIDERS["t3-web"]);
  }

  async testConnection(credentials, signal) {
    const parsed = parseT3Credentials(credentials);
    if (!validateT3Credentials(parsed)) return false;
    try {
      const validationBody = buildT3ChatBody({
        messages: [{ role: "user", content: "ping" }],
        model: "gpt-4o",
        parsed,
        stream: false,
      });
      const response = await webFetch(T3_CHAT_URL, {
        method: "POST",
        headers: buildHeaders(parsed.cookieHeader),
        body: JSON.stringify({ ...validationBody, validateOnly: true }),
        signal: signal ?? undefined,
      });
      return response.status !== 401 && response.status !== 403 && response.status < 500;
    } catch {
      return false;
    }
  }

  async execute({ model, body, stream, credentials, signal, proxyOptions = null }) {
    const parsed = parseT3Credentials(credentials);
    if (!validateT3Credentials(parsed)) {
      return { response: errorJson(400, "t3.chat credentials invalid: paste a full Cookie header containing convex-session-id."), url: T3_CHAT_URL, headers: {}, transformedBody: body };
    }

    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const normalized = normalizeOpenAIMessages(messages);
    if (!normalized.currentMsg && normalized.history.length === 0) {
      return { response: errorJson(400, "No messages provided"), url: T3_CHAT_URL, headers: {}, transformedBody: body };
    }

    const transformedBody = buildT3ChatBody({ messages, model, parsed, stream });
    const headers = buildHeaders(parsed.cookieHeader);
    const response = await webFetch(T3_CHAT_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal: signal ?? undefined,
    }, proxyOptions);

    if (!response.ok) {
      return { response: errorJson(response.status, `t3.chat upstream returned HTTP ${response.status}`), url: T3_CHAT_URL, headers, transformedBody };
    }

    const id = `chatcmpl-t3-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const ct = response.headers.get("content-type") || "";
    if (ct.includes("application/json") && !ct.includes("ndjson")) {
      const json = await response.json();
      if (json?.choices) return { response: new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } }), url: T3_CHAT_URL, headers, transformedBody };
      return { response: openAICompletion({ id, created, model, content: extractT3Delta(json), prompt: JSON.stringify(messages) }), url: T3_CHAT_URL, headers, transformedBody };
    }
    if (!response.body) return { response: errorJson(502, "t3.chat returned an empty response body"), url: T3_CHAT_URL, headers, transformedBody };
    if (stream !== false) {
      return { response: streamingTextResponse({ source: response.body, model, id, created, extractDelta: extractT3Delta, signal }), url: T3_CHAT_URL, headers, transformedBody };
    }
    const content = await collectTextFromEvents(response.body, extractT3Delta, signal);
    return { response: openAICompletion({ id, created, model, content, prompt: JSON.stringify(messages) }), url: T3_CHAT_URL, headers, transformedBody };
  }
}
