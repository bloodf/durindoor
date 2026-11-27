/** Internal ChatGPT Web session helpers; public compatibility exports live in ../chatgpt-web-http.js. */
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { sha3_512Hex } from "../../utils/sha3-512.js";
import { tlsFetchChatGpt as tlsFetchChatGptRaw } from "../../services/chatgptTlsClient.js";
import { __resetChatGptImageCacheForTesting } from "../../services/chatgptImageCache.js";
import { buildNextAuthSessionCookie, mergeRefreshedCookie } from "../../../src/lib/providers/webCookieAuth.js";

// Request-local so concurrent ChatGPT Web and Codex calls retain their own policy.
export const redirectPolicy = new AsyncLocalStorage();
export const tlsFetchChatGpt = (url, options) => tlsFetchChatGptRaw(
  url, redirectPolicy.getStore() === true ? { ...options, sameOriginRedirects: true } : options
);

// The TLS client buffers non-streaming replies, so the header deadline must not
// undercut its own 120s conversation timeout and 10s grace.
export const SEND_DEADLINE_MS = 130_000;

/** Send one TLS-client request through the shared sender. */
export const sendTls = (sender, url, options, quotaBearing = false) => sender.sendRequest(url, { signal: options.signal }, null, {
  quotaBearing,
  transport: ({ signal }) => tlsFetchChatGpt(url, { ...options, signal })
});

export async function proxyAgentForWebSocket(proxyUrl) {
  try {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    return new HttpsProxyAgent(proxyUrl);
  } catch {
    try {
      const { SocksProxyAgent } = await import("socks-proxy-agent");
      return new SocksProxyAgent(proxyUrl);
    } catch {
      return null;
    }
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const CHATGPT_BASE = "https://chatgpt.com";
export const SESSION_URL = `${CHATGPT_BASE}/api/auth/session`;
export const SENTINEL_PREPARE_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements/prepare`;
export const SENTINEL_CR_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements`;
export const CONV_URL = `${CHATGPT_BASE}/backend-api/f/conversation`;
export const DEFAULT_PRO_POLL_TIMEOUT_MS = 20 * 60_000;
export const DEFAULT_PRO_POLL_INTERVAL_MS = 4_000;

export const CHATGPT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0";

// Captured from a real chatgpt.com browser session (April 2026).
export const OAI_CLIENT_VERSION = "prod-81e0c5cdf6140e8c5db714d613337f4aeab94029";
export const OAI_CLIENT_BUILD_NUMBER = "6128297";

// Per-cookie device ID. The browser stores a persistent `oai-did` cookie that
// uniquely identifies the device for OpenAI's risk model — we derive a stable
// UUID from a hash of the session cookie so that each account/connection gets
// its own device id, but it doesn't change between requests.
export const deviceIdCache = new Map();
export function deviceIdFor(cookie) {
  const key = cookieKey(cookie);
  let id = deviceIdCache.get(key);
  if (!id) {
    // Synthesize a UUID v4-shaped string from a SHA-256 of the cookie. Stable,
    // deterministic per cookie, no PII (the cookie's already secret).
    // Not a password hash — SHA-256 is used to derive a stable UUID from the
    // session cookie for device-id fingerprinting. The output is a cache key.
    const h = createHash("sha256").update(cookie).digest("hex"); // lgtm[js/insufficient-password-hash]
    id =
      `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-` +
      `${((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-` +
      h.slice(20, 32);
    if (deviceIdCache.size >= 200) {
      const first = deviceIdCache.keys().next().value;
      if (first) deviceIdCache.delete(first);
    }
    deviceIdCache.set(key, id);
  }
  return id;
}

// DurinDoor model IDs select a GPT-5.6 Sol performance lane. Captured browser
// requests use one of `gpt-5-6`, `gpt-5-6-thinking`, or `gpt-5-6-pro`.

// ─── Browser-like default headers ──────────────────────────────────────────

export function browserHeaders() {
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
    "User-Agent": CHATGPT_USER_AGENT,
  };
}

/** Headers ChatGPT's web client sends on backend-api requests. */
export function oaiHeaders(sessionId, deviceId) {
  return {
    "OAI-Language": "en-US",
    "OAI-Device-Id": deviceId,
    "OAI-Client-Version": OAI_CLIENT_VERSION,
    "OAI-Client-Build-Number": OAI_CLIENT_BUILD_NUMBER,
    "OAI-Session-Id": sessionId,
  };
}

// ─── Session token cache ────────────────────────────────────────────────────

export const TOKEN_TTL_MS = 5 * 60 * 1000; // 5min — accessTokens are short-lived
export const tokenCache = new Map();

export function cookieKey(cookie) {
  // SHA-256 prefix (64 bits). Used as the Map key for tokenCache and
  // warmupCache; the previous 32-bit FNV-1a was small enough that a
  // birthday-paradox collision could surface one user's cached accessToken
  // to another's request. 64 bits is overkill for the 200-entry cache but
  // costs essentially nothing.
  // Not a password hash — SHA-256 is used to derive a short, collision-resistant
  // cache key from the session cookie. The output is a map lookup key.
  return createHash("sha256").update(cookie).digest("hex").slice(0, 16); // lgtm[js/insufficient-password-hash]
}

export function tokenLookup(cookie) {
  const entry = tokenCache.get(cookieKey(cookie));
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    tokenCache.delete(cookieKey(cookie));
    return null;
  }
  return entry;
}

export const TOKEN_CACHE_MAX = 200;

export function tokenStore(cookie, entry) {
  // Bound the cache to TOKEN_CACHE_MAX entries (FIFO). Same shape as the
  // image cache and warmup cache — drop the oldest before inserting.
  if (tokenCache.size >= TOKEN_CACHE_MAX && !tokenCache.has(cookieKey(cookie))) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey) tokenCache.delete(firstKey);
  }
  tokenCache.set(cookieKey(cookie), entry);
}

// Conversation continuity is intentionally not cached. Open WebUI and most
// OpenAI-API-style clients re-send the full history each turn, so each
// request just starts a fresh conversation. Temporary Chat mode is the
// default; it gets disabled per-request only for image-gen prompts, since
// that mode rejects the image_gen tool.

// ─── /api/auth/session — exchange cookie for JWT ────────────────────────────

export async function exchangeSession(cookie, signal, sender) {
  const cached = tokenLookup(cookie);
  if (cached) return cached;

  const headers = {
    ...browserHeaders(),
    Accept: "application/json",
    Cookie: buildNextAuthSessionCookie(cookie),
  };

  const response = await sendTls(sender, SESSION_URL, {
    method: "GET",
    headers,
    timeoutMs: 30_000,
    signal,
  });

  if (response.status === 401 || response.status === 403) {
    throw new SessionAuthError("Invalid session cookie");
  }
  if (response.status >= 400) {
    throw new Error(`Session exchange failed (HTTP ${response.status})`);
  }

  const refreshed = mergeRefreshedCookie(cookie, response.headers.get("set-cookie"));
  let data = {};
  try {
    data = JSON.parse(response.text || "{}");
  } catch {
    console.warn("[chatgpt-web] session response JSON parse failed");
    /* empty body or non-JSON */
  }
  if (!data.accessToken) {
    throw new SessionAuthError("Session response missing accessToken — cookie likely expired");
  }

  const expiresAt = data.expires ? new Date(data.expires).getTime() : Date.now() + TOKEN_TTL_MS;
  const entry = {
    accessToken: data.accessToken,
    accountId: data.user?.id ?? null,
    expiresAt: Math.min(expiresAt, Date.now() + TOKEN_TTL_MS),
    refreshedCookie: refreshed ?? undefined,
  };
  // A rotated cookie is a write candidate for this request only. Never replay
  // it from the token cache after the gateway accepts or rejects the write.
  if (!refreshed || refreshed === cookie) tokenStore(cookie, entry);
  return entry;
}

export class SessionAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionAuthError";
  }
}

// ─── /backend-api/sentinel/chat-requirements ────────────────────────────────

// ─── Session warmup ────────────────────────────────────────────────────────
// Mimics chatgpt.com's page-load fetch sequence so Sentinel sees a "warm"
// browsing session. Cached per (cookie, access-token) pair for 60s to avoid
// hammering the warmup endpoints on every chat completion.

export const warmupCache = new Map();
export const WARMUP_TTL_MS = 60_000;
export const WARMUP_CACHE_MAX = 200;

export async function runSessionWarmup(accessToken, accountId, sessionId, deviceId, cookie, signal, log, sender) {
  const key = cookieKey(cookie) + ":" + accessToken.slice(-8);
  const now = Date.now();
  const last = warmupCache.get(key);
  if (last && now - last < WARMUP_TTL_MS) return;
  // Bound the cache: drop the oldest entry once we hit the cap. Map iteration
  // order is insertion order, so the first key is the oldest.
  if (warmupCache.size >= WARMUP_CACHE_MAX && !warmupCache.has(key)) {
    const first = warmupCache.keys().next().value;
    if (first) warmupCache.delete(first);
  }
  warmupCache.set(key, now);

  const headers = {
    ...browserHeaders(),
    ...oaiHeaders(sessionId, deviceId),
    Accept: "*/*",
    Authorization: `Bearer ${accessToken}`,
    Cookie: buildNextAuthSessionCookie(cookie),
    Priority: "u=1, i",
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;

  const urls = [
    `${CHATGPT_BASE}/backend-api/me`,
    `${CHATGPT_BASE}/backend-api/conversations?offset=0&limit=28&order=updated`,
    `${CHATGPT_BASE}/backend-api/models?history_and_training_disabled=false`,
  ];

  for (const url of urls) {
    try {
      const r = await sendTls(sender, url, {
        method: "GET",
        headers,
        timeoutMs: 15_000,
        signal,
      });
      log?.debug?.("CGPT-WEB", `warmup ${url.split("/backend-api/")[1]} → ${r.status}`);
    } catch (err) {
      log?.debug?.(
        "CGPT-WEB",
        `warmup ${url} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

export function configuredProPollTimeoutMs() {
  const raw = Number(process.env.DURINDOOR_CGPT_WEB_PRO_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PRO_POLL_TIMEOUT_MS;
  return Math.floor(raw);
}

export function configuredProPollIntervalMs() {
  const raw = Number(process.env.DURINDOOR_CGPT_WEB_PRO_POLL_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PRO_POLL_INTERVAL_MS;
  return Math.floor(raw);
}

export async function prepareChatRequirements(
  accessToken,
  accountId,
  sessionId,
  deviceId,
  cookie,
  dplInfo,
  signal,
  log,
  sender
) {
  const config = buildPrekeyConfig(CHATGPT_USER_AGENT, dplInfo.dpl, dplInfo.scriptSrc);
  const prekey = await buildPrepareToken(config, log);

  const headers = {
    ...browserHeaders(),
    ...oaiHeaders(sessionId, deviceId),
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    Cookie: buildNextAuthSessionCookie(cookie),
    Priority: "u=1, i",
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;

  // Stage 1: POST /chat-requirements/prepare → { prepare_token, ... }
  const prepResp = await sendTls(sender, SENTINEL_PREPARE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ p: prekey }),
    timeoutMs: 30_000,
    signal,
  });
  if (prepResp.status === 401 || prepResp.status === 403) {
    throw new SentinelBlockedError(`Sentinel /prepare blocked (HTTP ${prepResp.status})`);
  }
  if (prepResp.status >= 400) {
    throw new Error(`Sentinel /prepare failed (HTTP ${prepResp.status})`);
  }
  let prepData = {};
  try {
    prepData = JSON.parse(prepResp.text || "{}");
  } catch {
    console.warn("[chatgpt-web] chat requirements prep JSON parse failed");
    /* keep empty */
  }
  // Stage 2: POST /chat-requirements with the prepare_token in the body. This
  // is the call that actually returns the chat-requirements-token used on the
  // conversation request.
  if (!prepData.prepare_token) {
    return prepData; // pass through whatever we got — caller handles missing fields
  }

  const crBody = { p: prekey, prepare_token: prepData.prepare_token };
  const crResp = await sendTls(sender, SENTINEL_CR_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(crBody),
    timeoutMs: 30_000,
    signal,
  });
  if (crResp.status === 401 || crResp.status === 403) {
    throw new SentinelBlockedError(`Sentinel /chat-requirements blocked (HTTP ${crResp.status})`);
  }
  if (crResp.status >= 400) {
    // Fall back to whatever /prepare returned — some accounts may not need stage 2.
    return prepData;
  }
  try {
    const crData = JSON.parse(crResp.text || "{}");
    // Merge: prepare_token from stage 1, everything else from stage 2.
    return { ...crData, prepare_token: prepData.prepare_token };
  } catch {
    console.warn("[chatgpt-web] chat requirements response JSON parse failed");
    return prepData;
  }
}

export class SentinelBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "SentinelBlockedError";
  }
}

// ─── Proof-of-work solver ──────────────────────────────────────────────────
// Mimics the openai-sentinel / chat2api algorithm. The browser sends a base64-encoded
// JSON config string; the server combines it with a seed and expects a SHA3-512 hash
// whose hex-prefix is ≤ the difficulty target.
//
// Reference: github.com/leetanshaj/openai-sentinel, github.com/lanqian528/chat2api
// Returns "gAAAAAB" + base64 of the winning config (server-recognised prefix).

// ─── DPL / script-src cache (warmup) ────────────────────────────────────────
// Sentinel's prekey check inspects whether config[5]/config[6] reference a real
// chatgpt.com deployment (DPL hash + a script URL from the HTML). We GET / once
// per hour to scrape these — same trick chat2api uses.

export let dplCache = null;
export const DPL_TTL_MS = 60 * 60 * 1000;

export async function fetchDpl(cookie, signal, sender) {
  if (dplCache && Date.now() < dplCache.expiresAt) {
    return { dpl: dplCache.dpl, scriptSrc: dplCache.scriptSrc };
  }
  const headers = {
    ...browserHeaders(),
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    Cookie: buildNextAuthSessionCookie(cookie),
  };
  const response = await sendTls(sender, `${CHATGPT_BASE}/`, {
    method: "GET",
    headers,
    timeoutMs: 20_000,
    signal,
  });
  const html = response.text || "";
  const dplMatch = html.match(/data-build="([^"]+)"/);
  const dpl = dplMatch ? `dpl=${dplMatch[1]}` : `dpl=${OAI_CLIENT_VERSION.replace(/^prod-/, "")}`;
  const scriptMatch = html.match(/<script[^>]+src="(https?:\/\/[^"]*\.js[^"]*)"/);
  const scriptSrc =
    scriptMatch?.[1] ?? `${CHATGPT_BASE}/_next/static/chunks/webpack-${randomHex(16)}.js`;
  dplCache = { dpl, scriptSrc, expiresAt: Date.now() + DPL_TTL_MS };
  return { dpl, scriptSrc };
}

export function randomHex(n) {
  return randomBytes(Math.ceil(n / 2))
    .toString("hex")
    .slice(0, n);
}

// ─── Browser fingerprint key lists (used in prekey config[10..12]) ─────────
// Chosen to look like real navigator/document/window inspection. The unicode
// MINUS SIGN (U+2212) in the navigator strings matches what `Object.toString()`
// produces in real browsers — Sentinel checks for it.

export const NAVIGATOR_KEYS = [
  "webdriver−false",
  "geolocation",
  "languages",
  "language",
  "platform",
  "userAgent",
  "vendor",
  "hardwareConcurrency",
  "deviceMemory",
  "permissions",
  "plugins",
  "mediaDevices",
];

export const DOCUMENT_KEYS = [
  "_reactListeningkfj3eavmks",
  "_reactListeningo743lnnpvdg",
  "location",
  "scrollingElement",
  "documentElement",
];

export const WINDOW_KEYS = [
  "webpackChunk_N_E",
  "__NEXT_DATA__",
  "chrome",
  "history",
  "screen",
  "navigation",
  "scrollX",
  "scrollY",
];

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function buildPrekeyConfig(userAgent, dpl, scriptSrc) {
  const screenSizes = [3000, 4000, 3120, 4160];
  const cores = [8, 16, 24, 32];
  const dateStr = new Date().toString();
  const perfNow = performance.now();
  const epochOffset = Date.now() - perfNow;

  return [
    pick(screenSizes),
    dateStr,
    4294705152,
    0, // mutated by solver
    userAgent,
    scriptSrc,
    dpl,
    "en-US",
    "en-US,en",
    0, // mutated by solver
    pick(NAVIGATOR_KEYS),
    pick(DOCUMENT_KEYS),
    pick(WINDOW_KEYS),
    perfNow,
    randomUUID(),
    "",
    pick(cores),
    epochOffset,
  ];
}

/**
 * Build the `p` (prekey) value sent in the chat-requirements POST body.
 *
 * Format: "<prefix>" + base64(JSON(config)), with a PoW solver loop mutating
 * config[3] to find a hash whose hex prefix is ≤ the target difficulty.
 * Mirrors chat2api / openai-sentinel.
 *   - prepare:      prefix="gAAAAAC", seed=""           (target "0fffff")
 *   - chat-requirements: prefix="gAAAAAB", seed=<server seed>  (target=difficulty)
 *
 * Submitting an unsolved token still works on low-friction accounts, so we
 * fall back to that after exhausting the iteration budget — but emit a warn
 * log so production can see when it happens.
 */
// PoW solvers run up to 100k–500k SHA3-512 hashes. To avoid blocking the
// Node event loop on a busy server, we yield with `setImmediate` every
// POW_YIELD_EVERY iterations — roughly every ~5ms of work — so concurrent
// requests and I/O still get scheduled. Wall time is approximately the same
// as the synchronous version; what changes is fairness, not throughput.
export const POW_YIELD_EVERY = 1000;

export function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function solvePow(opts) {
  const cfg = [...opts.config];
  for (let i = 0; i < opts.maxIter; i++) {
    if (i > 0 && i % POW_YIELD_EVERY === 0) await yieldToEventLoop();
    cfg[3] = i;
    const json = JSON.stringify(cfg);
    const b64 = Buffer.from(json).toString("base64");
    // Portable SHA3-512 — pure-JS fallback under Electron/BoringSSL (OmniRoute #5531).
    const hash = sha3_512Hex(opts.seed + b64);
    if (opts.target && hash.slice(0, opts.target.length) <= opts.target) {
      return `${opts.prefix}${b64}`;
    }
  }
  opts.log?.warn?.(
    "CGPT-WEB",
    `PoW (${opts.label}) exhausted ${opts.maxIter} iterations against target=${opts.target || "<empty>"}; submitting unsolved token (Sentinel may reject)`
  );
  const b64 = Buffer.from(JSON.stringify(cfg)).toString("base64");
  return `${opts.prefix}${b64}`;
}

export async function buildPrepareToken(config, log) {
  return solvePow({
    config,
    seed: "",
    target: "0fffff",
    prefix: "gAAAAAC",
    maxIter: 100_000,
    label: "prepare",
    log,
  });
}

export async function solveProofOfWork(seed, difficulty, config, log) {
  return solvePow({
    config,
    seed,
    target: (difficulty || "").toLowerCase(),
    prefix: "gAAAAAB",
    maxIter: 500_000,
    label: "conversation",
    log,
  });
}

// ─── OpenAI → ChatGPT message translation ───────────────────────────────────

/**
 * Strip embedded `data:image/...` URIs out of message content so prior
 * generated images don't get fed back into chatgpt.com on the next turn.
 *
 * Why: when image generation succeeds we emit `![image](data:image/png;base64,...)`
 * — frequently 2–4 MB. Chat clients (Open WebUI, OpenAI-style apps) replay
 * the full conversation history on the next request, so without this strip
 * we'd send megabytes of base64 back upstream. chatgpt.com responds with an
 * empty body when that happens (verified: 502 "ChatGPT returned empty
 * response body" on the very next turn after an image gen succeeds), and
 * even if it didn't, a single inlined image is well past the model's context
 * limit. Replacing with a short placeholder keeps semantic continuity
 * without the bytes.
 */

// Test-only: clear caches between tests
export function __resetChatGptWebCachesForTesting() {
  tokenCache.clear();
  warmupCache.clear();
  deviceIdCache.clear();
  __resetChatGptImageCacheForTesting();
  dplCache = null;
}

