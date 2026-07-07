import { createHash } from "node:crypto";
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

const ADAPTA_APP_URL = "https://agent.adapta.one";
const ADAPTA_CLERK_URL = "https://clerk.agent.adapta.one";
const ADAPTA_STREAM_URL = "https://agent.adapta.one/api/chat/stream/v1";
const DEFAULT_AI_MODEL_ID = 14;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const MODEL_ID_MAP = {
  "adapta-one": 14,
};

const sessionCache = new Map();

export function extractAdaptaClientJwt(rawApiKey) {
  const trimmed = String(rawApiKey || "").trim().replace(/^cookie\s*:\s*/i, "");
  if (!trimmed) return "";
  const clientMatch = trimmed.match(/(?:^|;\s*)__client=([^;]+)/);
  if (clientMatch) return clientMatch[1].trim();
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx > 0 && !trimmed.startsWith("eyJ")) return trimmed.slice(eqIdx + 1).trim();
  return trimmed;
}

function jwtExpMs(jwt) {
  try {
    const b64 = jwt.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!b64) return 0;
    const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function cacheKey(clientJwt) {
  return createHash("sha256").update(clientJwt).digest("hex");
}

function webFetch(url, options, proxyOptions) {
  return proxyOptions ? proxyAwareFetch(url, options, proxyOptions) : fetch(url, options);
}

async function getSessionId(clientJwt, signal, proxyOptions = null) {
  const response = await webFetch(`${ADAPTA_CLERK_URL}/v1/client`, {
    headers: {
      Cookie: `__client=${clientJwt}`,
      "User-Agent": USER_AGENT,
      Origin: ADAPTA_APP_URL,
    },
    signal: signal ?? undefined,
  }, proxyOptions);
  if (!response.ok) throw new Error(`Clerk /v1/client returned HTTP ${response.status}`);
  const body = await response.json();
  const active = body?.response?.sessions?.find?.((session) => session.status === "active");
  if (!active?.id) throw new Error("No active Clerk session found");
  return active.id;
}

async function refreshSessionJwt(clientJwt, sessionId, signal, proxyOptions = null) {
  const response = await webFetch(`${ADAPTA_CLERK_URL}/v1/client/sessions/${sessionId}/tokens`, {
    method: "POST",
    headers: {
      Cookie: `__client=${clientJwt}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Origin: ADAPTA_APP_URL,
    },
    signal: signal ?? undefined,
  }, proxyOptions);
  if (!response.ok) throw new Error(`Clerk token refresh returned HTTP ${response.status}`);
  const body = await response.json();
  if (typeof body?.jwt !== "string" || !body.jwt.startsWith("eyJ")) {
    throw new Error("Clerk token refresh did not return a valid JWT");
  }
  return body.jwt;
}

async function getSessionJwt(clientJwt, signal, proxyOptions = null) {
  const cached = sessionCache.get(cacheKey(clientJwt));
  if (cached && Date.now() < cached.expiresAt - 30_000) return cached.jwt;
  const sessionId = await getSessionId(clientJwt, signal, proxyOptions);
  const jwt = await refreshSessionJwt(clientJwt, sessionId, signal, proxyOptions);
  sessionCache.set(cacheKey(clientJwt), { jwt, expiresAt: jwtExpMs(jwt) || Date.now() + 55_000 });
  return jwt;
}

export function buildAdaptaMessages(messages) {
  const normalized = normalizeOpenAIMessages(messages);
  const adapted = normalized.history.map((msg) => ({
    role: msg.role,
    parts: [{ type: "text", text: msg.content }],
  }));
  if (normalized.currentMsg) adapted.push({ role: "user", parts: [{ type: "text", text: normalized.currentMsg }] });
  // Tool results are normalized into readable user turns before Adapta receives the prompt.
  if (normalized.systemMsg && adapted[0]?.role === "user") {
    adapted[0] = {
      ...adapted[0],
      parts: [{ type: "text", text: `${normalized.systemMsg}\n\n${adapted[0].parts[0].text}` }],
    };
  }
  return adapted;
}

function extractAdaptaDelta(event) {
  if (event?.type === "done" || event?.type === "end") return "__DONE__";
  if (event?.type !== "text-delta" || event?.id === "quick-response") return "";
  return typeof event.delta === "string" ? event.delta : "";
}

export class AdaptaWebExecutor extends BaseExecutor {
  constructor() {
    super("adapta-web", PROVIDERS["adapta-web"]);
  }

  async testConnection(credentials, signal, proxyOptions = null) {
    try {
      const clientJwt = extractAdaptaClientJwt(credentials?.apiKey || credentials?.accessToken || "");
      return !!clientJwt && !!(await getSessionId(clientJwt, signal, proxyOptions));
    } catch {
      return false;
    }
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const rawKey = credentials?.apiKey || credentials?.accessToken || "";
    const clientJwt = extractAdaptaClientJwt(rawKey);
    if (!clientJwt) {
      return { response: errorJson(401, "Missing Adapta credentials: paste the __client cookie from agent.adapta.one."), url: ADAPTA_STREAM_URL, headers: {}, transformedBody: body };
    }

    let sessionJwt;
    try {
      sessionJwt = await getSessionJwt(clientJwt, signal, proxyOptions);
    } catch (err) {
      log?.warn?.("ADAPTA-WEB", err?.message || String(err));
      return { response: errorJson(401, `Adapta auth failed: ${err?.message || String(err)}`), url: ADAPTA_STREAM_URL, headers: {}, transformedBody: body };
    }

    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const adaptaMessages = buildAdaptaMessages(messages);
    if (adaptaMessages.length === 0) {
      return { response: errorJson(400, "No messages provided"), url: ADAPTA_STREAM_URL, headers: {}, transformedBody: body };
    }

    const transformedBody = { messages: adaptaMessages, aiModelId: MODEL_ID_MAP[model] ?? DEFAULT_AI_MODEL_ID };
    const headers = {
      Authorization: `Bearer ${sessionJwt}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": USER_AGENT,
      Origin: ADAPTA_APP_URL,
      Referer: `${ADAPTA_APP_URL}/agentic-chat`,
    };
    const response = await webFetch(ADAPTA_STREAM_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal: signal ?? undefined,
    }, proxyOptions);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) sessionCache.delete(cacheKey(clientJwt));
      return { response: errorJson(response.status, `Adapta upstream returned HTTP ${response.status}`), url: ADAPTA_STREAM_URL, headers, transformedBody };
    }
    if (!response.body) return { response: errorJson(502, "Adapta returned an empty response body"), url: ADAPTA_STREAM_URL, headers, transformedBody };

    const id = `chatcmpl-adp-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    if (stream !== false) {
      return { response: streamingTextResponse({ source: response.body, model, id, created, extractDelta: extractAdaptaDelta, signal }), url: ADAPTA_STREAM_URL, headers, transformedBody };
    }
    const content = await collectTextFromEvents(response.body, extractAdaptaDelta, signal);
    return { response: openAICompletion({ id, created, model, content, prompt: JSON.stringify(messages) }), url: ADAPTA_STREAM_URL, headers, transformedBody };
  }
}
