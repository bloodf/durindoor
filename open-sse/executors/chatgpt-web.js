import { randomUUID, createHash } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import {
  collectTextFromEvents,
  errorJson,
  normalizeOpenAIMessages,
  openAICompletion,
  streamingTextResponse,
} from "./web-chat-utils.js";

const CHATGPT_BASE = "https://chatgpt.com";
const SESSION_URL = `${CHATGPT_BASE}/api/auth/session`;
const CONVERSATION_URL = `${CHATGPT_BASE}/backend-api/f/conversation`;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const TOKEN_TTL_MS = 5 * 60 * 1000;
const SESSION_TOKEN_FAMILY_RE = /^__Secure-next-auth\.session-token(?:\.\d+)?$/;
const tokenCache = new Map();

function tokenKey(cookie) {
  return createHash("sha256").update(buildSessionCookieHeader(cookie)).digest("hex").slice(0, 32);
}

export function buildSessionCookieHeader(rawInput) {
  let value = String(rawInput || "").trim();
  if (/^cookie\s*:\s*/i.test(value)) value = value.replace(/^cookie\s*:\s*/i, "");
  if (/__Secure-next-auth\.session-token(?:\.\d+)?\s*=/.test(value)) return value;
  return `__Secure-next-auth.session-token=${value}`;
}

export function mergeRefreshedCookie(originalCookie, setCookieHeader) {
  if (!setCookieHeader) return null;
  const matches = Array.from(setCookieHeader.matchAll(/(__Secure-next-auth\.session-token(?:\.\d+)?)=([^;,\s]+)/g));
  if (matches.length === 0) return null;
  const refreshed = new Map(matches.map((match) => [match[1], match[2]]));
  const blob = buildSessionCookieHeader(originalCookie);
  const result = [];
  let mutated = false;
  let dropped = false;
  for (const pair of blob.split(/;\s*/).filter(Boolean)) {
    const eqIdx = pair.indexOf("=");
    const name = eqIdx >= 0 ? pair.slice(0, eqIdx).trim() : pair;
    const value = eqIdx >= 0 ? pair.slice(eqIdx + 1) : "";
    if (SESSION_TOKEN_FAMILY_RE.test(name)) {
      dropped = true;
      if (!refreshed.has(name) || refreshed.get(name) !== value) mutated = true;
      continue;
    }
    result.push(pair);
  }
  for (const [name, value] of refreshed) result.push(`${name}=${value}`);
  if (!dropped) mutated = true;
  return mutated ? result.join("; ") : null;
}

async function exchangeSession(cookie, signal) {
  const key = tokenKey(cookie);
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;
  const response = await fetch(SESSION_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: buildSessionCookieHeader(cookie),
      "User-Agent": USER_AGENT,
      Referer: `${CHATGPT_BASE}/`,
    },
    signal: signal ?? undefined,
  });
  if (response.status === 401 || response.status === 403) throw new Error("Invalid session cookie");
  if (!response.ok) throw new Error(`Session exchange failed (HTTP ${response.status})`);
  const refreshedCookie = mergeRefreshedCookie(cookie, response.headers.get("set-cookie"));
  const json = await response.json();
  if (!json?.accessToken) throw new Error("Session response missing accessToken");
  const expiresAt = json.expires ? new Date(json.expires).getTime() : Date.now() + TOKEN_TTL_MS;
  const entry = {
    accessToken: json.accessToken,
    accountId: json.user?.id || null,
    expiresAt: Math.min(expiresAt, Date.now() + TOKEN_TTL_MS),
    refreshedCookie: refreshedCookie || undefined,
  };
  tokenCache.set(key, entry);
  return entry;
}

export function buildChatGptConversationBody(messages, model) {
  const parsed = normalizeOpenAIMessages(messages);
  const systemParts = [];
  if (parsed.systemMsg) systemParts.push(parsed.systemMsg);
  if (parsed.history.length > 0) {
    systemParts.push(`Prior conversation (for context; answer only the latest user message):\n\n${parsed.history.map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.content}`).join("\n\n")}`);
  }
  const cgptMessages = [];
  if (systemParts.length > 0) {
    cgptMessages.push({
      id: randomUUID(),
      author: { role: "system" },
      content: { content_type: "text", parts: [systemParts.join("\n\n")] },
    });
  }
  cgptMessages.push({
    id: randomUUID(),
    author: { role: "user" },
    content: { content_type: "text", parts: [parsed.currentMsg || ""] },
  });
  return {
    action: "next",
    messages: cgptMessages,
    model,
    conversation_id: null,
    parent_message_id: randomUUID(),
    timezone_offset_min: -new Date().getTimezoneOffset(),
    history_and_training_disabled: true,
    suggestions: [],
    websocket_request_id: randomUUID(),
    conversation_mode: { kind: "primary_assistant" },
    supports_buffering: true,
  };
}

function chatGptHeaders({ accessToken, accountId, cookie, sentinel }) {
  const headers = {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    Cookie: buildSessionCookieHeader(cookie),
    Origin: CHATGPT_BASE,
    Referer: `${CHATGPT_BASE}/`,
    "User-Agent": USER_AGENT,
    "OAI-Session-Id": randomUUID(),
    "OAI-Device-Id": randomUUID(),
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;
  if (sentinel?.requirementsToken) headers["openai-sentinel-chat-requirements-token"] = sentinel.requirementsToken;
  if (sentinel?.prepareToken) headers["openai-sentinel-chat-requirements-prepare-token"] = sentinel.prepareToken;
  if (sentinel?.proofToken) headers["openai-sentinel-proof-token"] = sentinel.proofToken;
  if (sentinel?.turnstileToken) headers["openai-sentinel-turnstile-token"] = sentinel.turnstileToken;
  return headers;
}

function extractChatGptDeltaFactory() {
  let seenLength = 0;
  let finishPending = false;
  return (event) => {
    if (finishPending) return "__DONE__";
    if (event?.error) return `[ChatGPT error: ${typeof event.error === "string" ? event.error : event.error.message || "unknown"}]`;
    const parts = event?.message?.content?.parts;
    if (event?.type === "message_stream_complete") return "__DONE__";
    const finished = event?.message?.status === "finished_successfully";
    if (!Array.isArray(parts) || typeof parts[0] !== "string") return "";
    const text = parts[0];
    if (text.length <= seenLength) return finished ? "__DONE__" : "";
    const delta = text.slice(seenLength);
    seenLength = text.length;
    if (finished) finishPending = true;
    return delta;
  };
}

export class ChatGptWebExecutor extends BaseExecutor {
  constructor() {
    super("chatgpt-web", PROVIDERS["chatgpt-web"]);
  }

  async testConnection(credentials, signal) {
    try {
      const rawCookie = credentials?.apiKey || credentials?.accessToken || "";
      if (!rawCookie) return false;
      await exchangeSession(rawCookie, signal);
      return true;
    } catch {
      return false;
    }
  }

  async execute({ model, body, stream, credentials, signal, log, onCredentialsRefreshed }) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) {
      return { response: errorJson(400, "Missing or empty messages array"), url: CONVERSATION_URL, headers: {}, transformedBody: body };
    }
    const rawCookie = credentials?.apiKey || credentials?.accessToken || "";
    if (!rawCookie) {
      return { response: errorJson(401, "ChatGPT auth failed: paste the __Secure-next-auth.session-token cookie from chatgpt.com."), url: SESSION_URL, headers: {}, transformedBody: body };
    }

    let token;
    try {
      token = await exchangeSession(rawCookie, signal);
    } catch (err) {
      log?.warn?.("CGPT-WEB", err?.message || String(err));
      return { response: errorJson(401, `ChatGPT session exchange failed: ${err?.message || String(err)}`), url: SESSION_URL, headers: {}, transformedBody: body };
    }
    if (token.refreshedCookie && token.refreshedCookie !== rawCookie) {
      await onCredentialsRefreshed?.({ ...credentials, apiKey: token.refreshedCookie });
    }

    const transformedBody = buildChatGptConversationBody(messages, model);
    const sentinel = credentials?.providerSpecificData?.chatgptWebSentinel || credentials?.providerSpecificData || {};
    const headers = chatGptHeaders({
      accessToken: token.accessToken,
      accountId: token.accountId,
      cookie: token.refreshedCookie || rawCookie,
      sentinel,
    });

    if (!sentinel?.requirementsToken && !sentinel?.proofToken && !sentinel?.turnstileToken) {
      return {
        response: errorJson(
          501,
          "ChatGPT Web session exchange and request conversion are ported, but automatic Sentinel proof-of-work/Turnstile solving is not yet ported in this JS branch. Provide providerSpecificData.chatgptWebSentinel tokens from a browser session to attempt the chat request.",
          "CHATGPT_WEB_SENTINEL_NOT_PORTED",
        ),
        url: CONVERSATION_URL,
        headers,
        transformedBody,
      };
    }

    const response = await fetch(CONVERSATION_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal: signal ?? undefined,
    });
    if (!response.ok) {
      return { response: errorJson(response.status, `ChatGPT Web upstream returned HTTP ${response.status}`), url: CONVERSATION_URL, headers, transformedBody };
    }
    if (!response.body) return { response: errorJson(502, "ChatGPT Web returned an empty response body"), url: CONVERSATION_URL, headers, transformedBody };

    const id = `chatcmpl-cgpt-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    if (stream !== false) {
      return { response: streamingTextResponse({ source: response.body, model, id, created, extractDelta: extractChatGptDeltaFactory(), signal }), url: CONVERSATION_URL, headers, transformedBody };
    }
    const content = await collectTextFromEvents(response.body, extractChatGptDeltaFactory(), signal);
    return { response: openAICompletion({ id, created, model, content, prompt: JSON.stringify(messages) }), url: CONVERSATION_URL, headers, transformedBody };
  }
}
