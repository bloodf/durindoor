import { randomUUID, createHash, randomBytes } from "node:crypto";
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
const SENTINEL_PREPARE_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements/prepare`;
const SENTINEL_REQUIREMENTS_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements`;
const CONVERSATION_URL = `${CHATGPT_BASE}/backend-api/f/conversation`;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const OAI_CLIENT_VERSION = "prod-81e0c5cdf6140e8c5db714d613337f4aeab94029";
const OAI_CLIENT_BUILD_NUMBER = "6128297";
const TOKEN_TTL_MS = 5 * 60 * 1000;
const SESSION_TOKEN_FAMILY_RE = /^__Secure-next-auth\.session-token(?:\.\d+)?$/;
const tokenCache = new Map();
const deviceIdCache = new Map();
let dplCache = null;

function browserHeaders() {
  return {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Origin: CHATGPT_BASE,
    Pragma: "no-cache",
    Referer: `${CHATGPT_BASE}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": USER_AGENT,
  };
}

function oaiHeaders(sessionId, deviceId) {
  return {
    "OAI-Language": "en-US",
    "OAI-Device-Id": deviceId,
    "OAI-Client-Version": OAI_CLIENT_VERSION,
    "OAI-Client-Build-Number": OAI_CLIENT_BUILD_NUMBER,
    "OAI-Session-Id": sessionId,
  };
}

function tokenKey(cookie) {
  return createHash("sha256").update(buildSessionCookieHeader(cookie)).digest("hex").slice(0, 32);
}

function deviceIdFor(cookie) {
  const key = tokenKey(cookie);
  let id = deviceIdCache.get(key);
  if (!id) {
    const h = createHash("sha256").update(buildSessionCookieHeader(cookie)).digest("hex");
    id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
    if (deviceIdCache.size >= 200) deviceIdCache.delete(deviceIdCache.keys().next().value);
    deviceIdCache.set(key, id);
  }
  return id;
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
      ...browserHeaders(),
      Accept: "application/json",
      Cookie: buildSessionCookieHeader(cookie),
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

async function fetchDpl(cookie, signal) {
  if (dplCache && Date.now() < dplCache.expiresAt) {
    return { dpl: dplCache.dpl, scriptSrc: dplCache.scriptSrc };
  }
  const response = await fetch(`${CHATGPT_BASE}/`, {
    method: "GET",
    headers: {
      ...browserHeaders(),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      Cookie: buildSessionCookieHeader(cookie),
    },
    signal: signal ?? undefined,
  });
  const html = await response.text().catch(() => "");
  const dplMatch = html.match(/data-build="([^"]+)"/);
  const dpl = dplMatch ? `dpl=${dplMatch[1]}` : `dpl=${OAI_CLIENT_VERSION.replace(/^prod-/, "")}`;
  const scriptMatch = html.match(/<script[^>]+src="(https?:\/\/[^"]*\.js[^"]*)"/);
  const scriptSrc = scriptMatch?.[1] ?? `${CHATGPT_BASE}/_next/static/chunks/webpack-${randomHex(16)}.js`;
  dplCache = { dpl, scriptSrc, expiresAt: Date.now() + 60 * 60 * 1000 };
  return { dpl, scriptSrc };
}

function randomHex(n) {
  return randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildPrekeyConfig(userAgent, dpl, scriptSrc) {
  const screenSizes = [3000, 4000, 3120, 4160];
  const cores = [8, 16, 24, 32];
  const perfNow = globalThis.performance?.now?.() ?? 0;
  return [
    pick(screenSizes),
    new Date().toString(),
    4294705152,
    0,
    userAgent,
    scriptSrc,
    dpl,
    "en-US",
    "en-US,en",
    0,
    pick(["webdriver−false", "geolocation", "languages", "language", "platform", "userAgent", "vendor", "hardwareConcurrency", "deviceMemory", "permissions", "plugins", "mediaDevices"]),
    pick(["_reactListeningkfj3eavmks", "_reactListeningo743lnnpvdg", "location", "scrollingElement", "documentElement"]),
    pick(["webpackChunk_N_E", "__NEXT_DATA__", "chrome", "history", "screen", "navigation", "scrollX", "scrollY"]),
    perfNow,
    randomUUID(),
    "",
    pick(cores),
    Date.now() - perfNow,
  ];
}

function sha3_512Hex(input) {
  return createHash("sha3-512").update(input).digest("hex");
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function solvePow({ config, seed, target, prefix, maxIter, label, log }) {
  const cfg = [...config];
  const normalizedTarget = String(target || "").toLowerCase();
  for (let i = 0; i < maxIter; i++) {
    if (i > 0 && i % 1000 === 0) await yieldToEventLoop();
    cfg[3] = i;
    const b64 = Buffer.from(JSON.stringify(cfg)).toString("base64");
    const hash = sha3_512Hex(seed + b64);
    if (normalizedTarget && hash.slice(0, normalizedTarget.length) <= normalizedTarget) {
      return `${prefix}${b64}`;
    }
  }
  log?.warn?.("CGPT-WEB", `PoW (${label}) exhausted ${maxIter} iterations against target=${normalizedTarget || "<empty>"}; submitting unsolved token`);
  return `${prefix}${Buffer.from(JSON.stringify(cfg)).toString("base64")}`;
}

function buildPrepareToken(config, log) {
  return solvePow({ config, seed: "", target: "0fffff", prefix: "gAAAAAC", maxIter: 100000, label: "prepare", log });
}

function solveProofOfWork(seed, difficulty, config, log) {
  return solvePow({ config, seed, target: difficulty, prefix: "gAAAAAB", maxIter: 500000, label: "conversation", log });
}

async function prepareChatRequirements({ accessToken, accountId, sessionId, deviceId, cookie, dplInfo, signal, log }) {
  const config = buildPrekeyConfig(USER_AGENT, dplInfo.dpl, dplInfo.scriptSrc);
  const prekey = await buildPrepareToken(config, log);
  const headers = {
    ...browserHeaders(),
    ...oaiHeaders(sessionId, deviceId),
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    Cookie: buildSessionCookieHeader(cookie),
    Priority: "u=1, i",
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;

  const prepareResponse = await fetch(SENTINEL_PREPARE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ p: prekey }),
    signal: signal ?? undefined,
  });
  if (prepareResponse.status === 401 || prepareResponse.status === 403) {
    const err = new Error(`Sentinel /prepare blocked (HTTP ${prepareResponse.status})`);
    err.code = "SENTINEL_BLOCKED";
    throw err;
  }
  if (!prepareResponse.ok) throw new Error(`Sentinel /prepare failed (HTTP ${prepareResponse.status})`);
  const prepareData = await prepareResponse.json().catch(() => ({}));
  if (!prepareData?.prepare_token) return prepareData || {};

  const requirementsResponse = await fetch(SENTINEL_REQUIREMENTS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ p: prekey, prepare_token: prepareData.prepare_token }),
    signal: signal ?? undefined,
  });
  if (requirementsResponse.status === 401 || requirementsResponse.status === 403) {
    const err = new Error(`Sentinel /chat-requirements blocked (HTTP ${requirementsResponse.status})`);
    err.code = "SENTINEL_BLOCKED";
    throw err;
  }
  if (!requirementsResponse.ok) return prepareData;
  const requirementsData = await requirementsResponse.json().catch(() => ({}));
  return { ...requirementsData, prepare_token: prepareData.prepare_token };
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
    ...browserHeaders(),
    ...oaiHeaders(sentinel.sessionId, sentinel.deviceId),
    Accept: "text/event-stream",
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    Cookie: buildSessionCookieHeader(cookie),
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
    const suppliedSentinel = credentials?.providerSpecificData?.chatgptWebSentinel || credentials?.providerSpecificData || {};
    const sessionId = randomUUID();
    const deviceId = deviceIdFor(token.refreshedCookie || rawCookie);
    let automaticSentinel = {};
    if (!suppliedSentinel?.requirementsToken && !suppliedSentinel?.proofToken) {
      try {
        let dplInfo;
        try {
          dplInfo = await fetchDpl(token.refreshedCookie || rawCookie, signal);
        } catch (err) {
          log?.warn?.("CGPT-WEB", `DPL warmup failed; using fallback (${err?.message || String(err)})`);
          dplInfo = {
            dpl: `dpl=${OAI_CLIENT_VERSION.replace(/^prod-/, "")}`,
            scriptSrc: `${CHATGPT_BASE}/_next/static/chunks/webpack-${randomHex(16)}.js`,
          };
        }
        const reqs = await prepareChatRequirements({
          accessToken: token.accessToken,
          accountId: token.accountId,
          sessionId,
          deviceId,
          cookie: token.refreshedCookie || rawCookie,
          dplInfo,
          signal,
          log,
        });
        let proofToken = null;
        if (reqs?.proofofwork?.required && reqs.proofofwork.seed && reqs.proofofwork.difficulty) {
          proofToken = await solveProofOfWork(
            reqs.proofofwork.seed,
            reqs.proofofwork.difficulty,
            buildPrekeyConfig(USER_AGENT, dplInfo.dpl, dplInfo.scriptSrc),
            log,
          );
        }
        automaticSentinel = {
          requirementsToken: reqs?.token,
          prepareToken: reqs?.prepare_token,
          proofToken,
          turnstileToken: typeof suppliedSentinel?.turnstileToken === "string" ? suppliedSentinel.turnstileToken : null,
        };
      } catch (err) {
        const status = err?.code === "SENTINEL_BLOCKED" ? 403 : 502;
        const code = err?.code === "SENTINEL_BLOCKED" ? "SENTINEL_BLOCKED" : undefined;
        return {
          response: errorJson(status, `ChatGPT sentinel failed: ${err?.message || String(err)}`, code),
          url: SENTINEL_PREPARE_URL,
          headers: {},
          transformedBody,
        };
      }
    }
    const sentinel = { ...automaticSentinel, ...suppliedSentinel, sessionId, deviceId };
    const headers = chatGptHeaders({
      accessToken: token.accessToken,
      accountId: token.accountId,
      cookie: token.refreshedCookie || rawCookie,
      sentinel,
    });

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
