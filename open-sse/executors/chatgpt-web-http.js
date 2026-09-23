/**
 * ChatGPT Web HTTP transport — the fallback behind the browser transport in
 * ./chatgpt-web.js (ported from OmniRoute before its #11754 retirement).
 *
 * Routes requests through chatgpt.com's internal SSE API using a Plus/Pro
 * subscription session cookie, translating between OpenAI chat completions
 * format and ChatGPT's internal protocol.
 *
 * Auth pipeline (per request):
 *   1. exchangeSession()          GET  /api/auth/session       cookie → JWT accessToken (cached ~5min)
 *   2. prepareChatRequirements()  POST /backend-api/sentinel/chat-requirements
 *                                                              → { proofofwork.seed, difficulty, persona }
 *   3. solveProofOfWork()         SHA3-512 hash loop           → "gAAAAAB…" sentinel proof token
 *   4. fetch /backend-api/conversation                         with Bearer + sentinel-proof-token + browser UA
 *
 * Response is the standard ChatGPT SSE format (cumulative `parts[0]` strings, not deltas).
 */

import { BaseExecutor } from "./base.js";
import { describeChatGptWebHttpError } from "./chatgptWebErrors.js";
import { prepareToolMessages } from "../translator/webTools.js";
import { buildToolModeResponse } from "./chatgptWebTools.js";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { sha3_512Hex } from "../utils/sha3-512.js";
import { tlsFetchChatGpt, TlsClientUnavailableError } from "../services/chatgptTlsClient.js";
import {
  storeChatGptImage,
  getChatGptImageConversationContext,
  __resetChatGptImageCacheForTesting,
} from "../services/chatgptImageCache.js";
import { resolveChatGptModel, resolveChatGptSystemHints } from "./chatgpt-web/models.js";
import { cleanChatGptText } from "./chatgpt-web/citations.js";
import { resumeChatGptHandoff } from "./chatgpt-web/handoff.js";
import { runWithTlsProxyOptions } from "../services/tlsClientBase.js";
import {
  buildNextAuthSessionCookie,
  mergeRefreshedCookie,
} from "../../src/lib/providers/webCookieAuth.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const CHATGPT_BASE = "https://chatgpt.com";
const SESSION_URL = `${CHATGPT_BASE}/api/auth/session`;
const SENTINEL_PREPARE_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements/prepare`;
const SENTINEL_CR_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements`;
const CONV_URL = `${CHATGPT_BASE}/backend-api/f/conversation`;
const DEFAULT_PRO_POLL_TIMEOUT_MS = 20 * 60_000;
const DEFAULT_PRO_POLL_INTERVAL_MS = 4_000;

const CHATGPT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0";

// Captured from a real chatgpt.com browser session (April 2026).
const OAI_CLIENT_VERSION = "prod-81e0c5cdf6140e8c5db714d613337f4aeab94029";
const OAI_CLIENT_BUILD_NUMBER = "6128297";

// Per-cookie device ID. The browser stores a persistent `oai-did` cookie that
// uniquely identifies the device for OpenAI's risk model — we derive a stable
// UUID from a hash of the session cookie so that each account/connection gets
// its own device id, but it doesn't change between requests.
const deviceIdCache = new Map();
function deviceIdFor(cookie) {
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
    "User-Agent": CHATGPT_USER_AGENT,
  };
}

/** Headers ChatGPT's web client sends on backend-api requests. */
function oaiHeaders(sessionId, deviceId) {
  return {
    "OAI-Language": "en-US",
    "OAI-Device-Id": deviceId,
    "OAI-Client-Version": OAI_CLIENT_VERSION,
    "OAI-Client-Build-Number": OAI_CLIENT_BUILD_NUMBER,
    "OAI-Session-Id": sessionId,
  };
}

// ─── Session token cache ────────────────────────────────────────────────────

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5min — accessTokens are short-lived
const tokenCache = new Map();

function cookieKey(cookie) {
  // SHA-256 prefix (64 bits). Used as the Map key for tokenCache and
  // warmupCache; the previous 32-bit FNV-1a was small enough that a
  // birthday-paradox collision could surface one user's cached accessToken
  // to another's request. 64 bits is overkill for the 200-entry cache but
  // costs essentially nothing.
  // Not a password hash — SHA-256 is used to derive a short, collision-resistant
  // cache key from the session cookie. The output is a map lookup key.
  return createHash("sha256").update(cookie).digest("hex").slice(0, 16); // lgtm[js/insufficient-password-hash]
}

function tokenLookup(cookie) {
  const entry = tokenCache.get(cookieKey(cookie));
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    tokenCache.delete(cookieKey(cookie));
    return null;
  }
  return entry;
}

const TOKEN_CACHE_MAX = 200;

function tokenStore(cookie, entry) {
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

async function exchangeSession(cookie, signal) {
  const cached = tokenLookup(cookie);
  if (cached) return cached;

  const headers = {
    ...browserHeaders(),
    Accept: "application/json",
    Cookie: buildNextAuthSessionCookie(cookie),
  };

  const response = await tlsFetchChatGpt(SESSION_URL, {
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
  tokenStore(cookie, entry);
  return entry;
}

class SessionAuthError extends Error {
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

const warmupCache = new Map();
const WARMUP_TTL_MS = 60_000;
const WARMUP_CACHE_MAX = 200;

async function runSessionWarmup(accessToken, accountId, sessionId, deviceId, cookie, signal, log) {
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
      const r = await tlsFetchChatGpt(url, {
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

function configuredProPollTimeoutMs() {
  const raw = Number(process.env.DURINDOOR_CGPT_WEB_PRO_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PRO_POLL_TIMEOUT_MS;
  return Math.floor(raw);
}

function configuredProPollIntervalMs() {
  const raw = Number(process.env.DURINDOOR_CGPT_WEB_PRO_POLL_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PRO_POLL_INTERVAL_MS;
  return Math.floor(raw);
}

async function prepareChatRequirements(
  accessToken,
  accountId,
  sessionId,
  deviceId,
  cookie,
  dplInfo,
  signal,
  log
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
  const prepResp = await tlsFetchChatGpt(SENTINEL_PREPARE_URL, {
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
  const crResp = await tlsFetchChatGpt(SENTINEL_CR_URL, {
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

class SentinelBlockedError extends Error {
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

let dplCache = null;
const DPL_TTL_MS = 60 * 60 * 1000;

async function fetchDpl(cookie, signal) {
  if (dplCache && Date.now() < dplCache.expiresAt) {
    return { dpl: dplCache.dpl, scriptSrc: dplCache.scriptSrc };
  }
  const headers = {
    ...browserHeaders(),
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    Cookie: buildNextAuthSessionCookie(cookie),
  };
  const response = await tlsFetchChatGpt(`${CHATGPT_BASE}/`, {
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

function randomHex(n) {
  return randomBytes(Math.ceil(n / 2))
    .toString("hex")
    .slice(0, n);
}

// ─── Browser fingerprint key lists (used in prekey config[10..12]) ─────────
// Chosen to look like real navigator/document/window inspection. The unicode
// MINUS SIGN (U+2212) in the navigator strings matches what `Object.toString()`
// produces in real browsers — Sentinel checks for it.

const NAVIGATOR_KEYS = [
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

const DOCUMENT_KEYS = [
  "_reactListeningkfj3eavmks",
  "_reactListeningo743lnnpvdg",
  "location",
  "scrollingElement",
  "documentElement",
];

const WINDOW_KEYS = [
  "webpackChunk_N_E",
  "__NEXT_DATA__",
  "chrome",
  "history",
  "screen",
  "navigation",
  "scrollX",
  "scrollY",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildPrekeyConfig(userAgent, dpl, scriptSrc) {
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
const POW_YIELD_EVERY = 1000;

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function solvePow(opts) {
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

async function buildPrepareToken(config, log) {
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

async function solveProofOfWork(seed, difficulty, config, log) {
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
const DATA_URI_IMAGE_RE = /!\[([^\]]*)\]\(data:image\/[^)]+\)/g;
const CACHED_IMAGE_URL_RE = /\/v1\/chatgpt-web\/image\/([a-f0-9]{16,64})(?=[)\s"'<>]|$)/gi;

function stripInlinedImages(content) {
  return content.replace(DATA_URI_IMAGE_RE, (_, alt) =>
    alt ? `[${alt}: generated image]` : "[generated image]"
  );
}

function findCachedImageContext(content) {
  let latest = null;
  // String.prototype.matchAll consumes a fresh iterator and ignores the
  // regex's lastIndex, so no manual reset is required.
  for (const match of content.matchAll(CACHED_IMAGE_URL_RE)) {
    const id = match[1];
    const context = getChatGptImageConversationContext(id);
    if (context) latest = context;
  }
  return latest;
}

function parseOpenAIMessages(messages) {
  let systemMsg = "";
  const history = [];
  let latestImageContext = null;

  for (const msg of messages) {
    let role = String(msg.role || "user");
    if (role === "developer") role = "system";

    let content = "";
    if (isString(msg.content)) {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((c) => c.type === "text")
        .map((c) => String(c.text || ""))
        .join(" ");
    }
    content = stripInlinedImages(content);
    const imageContext = findCachedImageContext(content);
    if (imageContext) latestImageContext = imageContext;
    if (!content.trim()) continue;

    if (role === "system") {
      systemMsg += (systemMsg ? "\n" : "") + content;
    } else if (role === "user" || role === "assistant") {
      history.push({ role, content });
    }
  }

  let currentMsg = "";
  if (history.length > 0 && history[history.length - 1].role === "user") {
    currentMsg = history.pop().content;
  }

  return { systemMsg, history, currentMsg, latestImageContext };
}

/**
 * Cheap heuristic: does the last user turn look like an image-generation
 * request? Used to decide whether to disable Temporary Chat mode.
 *
 * Why a heuristic instead of always disabling Temporary Chat: when
 * `history_and_training_disabled: false`, every conversation gets saved to
 * the user's chatgpt.com history. For text-only chats that's noise — a
 * dozen "DurinDoor" entries clutter the sidebar and can interact with
 * ChatGPT's memory. We pay that cost only when the user actually wants an
 * image, since Temporary Chat refuses image_gen with the message
 * "I cannot generate images in this chat".
 *
 * False positives (text chat misclassified as image) → unnecessary history
 * entry. False negatives (image request misclassified as text) → ChatGPT
 * refuses image_gen and the user retries. Tuning leans toward false
 * positives (we'd rather pollute history than refuse image generation).
 */
const IMAGE_GEN_REGEXES = [
  // verb + (anything within 40 chars) + image-noun
  /\b(?:generate|create|make|draw|paint|render|produce|design|sketch|illustrate|show me)\b[\s\S]{0,40}\b(?:image|picture|photo|photograph|drawing|illustration|sketch|painting|portrait|logo|icon|art|artwork|wallpaper|render|graphic)\b/i,
  // image-noun + "of" — "image of a kitten", "picture of mountains"
  /\b(?:image|picture|photo|photograph|illustration|drawing|painting|render)\s+of\b/i,
  // direct verb + a/an article — "draw a kitten", "paint an apple"
  /\b(?:draw|paint|sketch|render|illustrate)\s+(?:me\s+)?(?:a|an|some|the)\s+\w+/i,
  // explicit slash command users sometimes type — "/imagine ..."
  /^\s*\/(?:image|imagine|img|draw|paint)\b/im,
];

/**
 * Markers Open WebUI uses for its background tool prompts (follow-up
 * suggestions, title generation, tag categorization). These prompts embed
 * the prior conversation in `<chat_history>` blocks and frequently quote
 * the user's earlier "generate an image of..." request — which would
 * trip the image-gen regex below. Skip them so we don't unnecessarily
 * disable Temporary Chat and trigger image_gen on background tasks.
 *
 * Catching just one of these markers is enough; tool prompts always
 * include several together.
 */
const OPENWEBUI_TOOL_PROMPT_MARKERS = [
  /<chat_history>/i,
  /^### Task:/im,
  /\bJSON format:\s*\{/i,
  /\bfollow_?ups\b.*\barray of strings\b/i,
];

const OPENWEBUI_IMAGE_CONTEXT_MARKERS = [
  /<context>\s*The requested image has been (?:created|edited and created) by the system successfully/i,
  /<context>\s*The requested image has been edited and created and is now being shown to the user/i,
  /<context>\s*Image generation was attempted but failed/i,
];

function hasOpenWebUIImageContext(parsed) {
  return OPENWEBUI_IMAGE_CONTEXT_MARKERS.some((re) => re.test(parsed.systemMsg));
}

function looksLikeImageGenRequest(parsed) {
  // Inspect only the latest user turn — historical turns are irrelevant
  // (and could trigger false positives if the user mentioned an image
  // generated previously).
  const text = parsed.currentMsg.trim();
  if (!text) return false;
  if (OPENWEBUI_TOOL_PROMPT_MARKERS.some((re) => re.test(text))) return false;
  if (hasOpenWebUIImageContext(parsed)) return false;
  return IMAGE_GEN_REGEXES.some((re) => re.test(text));
}

const IMAGE_EDIT_REGEXES = [
  /\b(?:edit|adjust|modify|change|update|alter|revise|retouch|fix)\b[\s\S]{0,120}\b(?:it|image|picture|photo|lighting|background|style|color|colour|composition|scene|time of day)\b/i,
  /\b(?:make|turn|set|switch)\s+(?:it|the\s+(?:image|picture|photo|scene))\b[\s\S]{0,120}\b/i,
  /\b(?:add|remove|replace)\b[\s\S]{0,120}\b(?:it|image|picture|photo|background|sky|person|object|text|logo)\b/i,
  /\b(?:brighter|darker|night|daytime|time of day|sunset|sunrise|morning|evening|lighting|relight|background|style)\b/i,
  /^\s*(?:now|then|also)\b[\s\S]{0,120}\b(?:make|turn|change|adjust|add|remove|replace|edit)\b/i,
];

function looksLikeImageEditRequest(parsed) {
  if (!parsed.latestImageContext) return false;
  const text = parsed.currentMsg.trim();
  if (!text) return false;
  if (OPENWEBUI_TOOL_PROMPT_MARKERS.some((re) => re.test(text))) return false;
  if (hasOpenWebUIImageContext(parsed)) return false;
  return IMAGE_EDIT_REGEXES.some((re) => re.test(text));
}

function buildConversationBody(parsed, modelSlug, parentMessageId, options) {
  // Critical: do NOT send prior turns as separate `assistant` and `user`
  // messages in the `messages` array. ChatGPT's web API ("action: next")
  // treats those as in-progress turns and the model will literally CONTINUE
  // a prior assistant response in the new generation — observed as
  // `[1] -> [12] -> [1123]` across three turns.
  //
  // Instead, fold all prior history into the system message and send only
  // the current user message as a single new turn. The model then sees a
  // single prompt with full context and responds fresh.
  const systemParts = [];
  if (parsed.systemMsg.trim()) {
    systemParts.push(parsed.systemMsg.trim());
  }
  const continuation = options.continuation ?? null;

  if (!continuation && parsed.history.length > 0) {
    const formatted = parsed.history
      .map((h) => `${h.role === "assistant" ? "Assistant" : "User"}: ${h.content}`)
      .join("\n\n");
    systemParts.push(
      `Prior conversation (for context — answer only the new user message below):\n\n${formatted}`
    );
  }

  const messages = [];
  if (systemParts.length > 0) {
    messages.push({
      id: randomUUID(),
      author: { role: "system" },
      content: { content_type: "text", parts: [systemParts.join("\n\n")] },
    });
  }

  const systemHints = options.systemHints;

  const currentUserContent = hasOpenWebUIImageContext(parsed)
    ? "Briefly acknowledge the image result described in the system context. Do not generate, edit, or request another image."
    : parsed.currentMsg || "";

  const currentUserMessage = {
    id: randomUUID(),
    author: { role: "user" },
    content: { content_type: "text", parts: [currentUserContent] },
  };
  if (systemHints.length > 0) currentUserMessage.metadata = { system_hints: [...systemHints] };
  messages.push(currentUserMessage);

  const conversationBody = {
    action: "next",
    messages,
    model: modelSlug,
    // Text-only API-style requests start fresh because clients replay full
    // history. Generated-image edits are the exception: ChatGPT needs the
    // original conversation node to adjust the actual image, not just a
    // markdown URL echoed back in a synthetic history block.
    conversation_id: continuation?.conversationId ?? null,
    parent_message_id: continuation?.parentMessageId ?? parentMessageId,
    timezone_offset_min: -new Date().getTimezoneOffset(),
    // Temporary Chat is the default. Disable it only for image generation /
    // image edits, where ChatGPT needs durable conversation state for tools.
    history_and_training_disabled: !options.persistConversation,
    suggestions: [],
    websocket_request_id: randomUUID(),
    conversation_mode: { kind: "primary_assistant" },
    supports_buffering: true,
    force_parallel_switch: "auto",
    paragen_cot_summary_display_override: "allow",
  };
  if (systemHints.length > 0) conversationBody.system_hints = [...systemHints];
  if (options.thinkingEffort) conversationBody.thinking_effort = options.thinkingEffort;
  return conversationBody;
}

// ─── ChatGPT SSE parsing ────────────────────────────────────────────────────

/**
 * A part inside `content.parts` for a `multimodal_text` content_type.
 * ChatGPT puts image references in a part with content_type "image_asset_pointer"
 * and an asset_pointer like "file-service://file-XXXX" (final) or
 * "sediment://..." (in-progress preview).
 */
async function* readChatGptSseEvents(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];
  let eventName = null;

  function flush() {
    if (dataLines.length === 0) {
      eventName = null;
      return null;
    }
    const payload = dataLines.join("\n");
    dataLines = [];
    const sseEventName = eventName;
    eventName = null;
    const trimmed = payload.trim();
    if (!trimmed || trimmed === "[DONE]") return "done";
    try {
      const parsed = JSON.parse(trimmed);
      if (sseEventName && !parsed.type) parsed.type = sseEventName;
      return parsed;
    } catch {
      console.warn("[chatgpt-web] stream event JSON parse failed");
      return null;
    }
  }

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const rawLine = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

        if (line === "") {
          const parsed = flush();
          if (parsed === "done") return;
          if (parsed) yield parsed;
          continue;
        }
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().startsWith("data:")) {
      dataLines.push(buffer.trim().slice(5).trimStart());
    }
    const tail = flush();
    if (tail && tail !== "done") yield tail;
  } finally {
    reader.releaseLock();
  }
}

// ─── Content extraction ─────────────────────────────────────────────────────
// ChatGPT SSE chunks contain CUMULATIVE content (full text so far in `parts[0]`),
// not deltas. Diff against the emitted length to produce incremental tokens —
// same pattern perplexity-web.js uses for markdown blocks (lines 386-397).

/**
 * Pull image asset pointers out of a multimodal_text parts array.
 *
 * For text-only messages parts is `["text..."]` and this returns `[]`. For
 * `image_gen` tool output, parts looks like:
 *   [
 *     { content_type: "image_asset_pointer",
 *       asset_pointer: "file-service://file-abc..." or "sediment://..." }
 *   ]
 * We collect every asset_pointer seen so the caller can resolve them once
 * the stream terminates.
 */
function extractImagePointers(parts) {
  const out = [];
  for (const p of parts) {
    if (!p || !isObject(p)) continue;
    const obj = p;
    if (obj.content_type === "image_asset_pointer" && isString(obj.asset_pointer)) {
      out.push(obj.asset_pointer);
    }
  }
  return out;
}

async function* extractContent(eventStream, signal) {
  // ChatGPT may echo prior assistant turns at the start of the stream with
  // status: "finished_successfully" and full content, before sending the new
  // generation. If we emit those bytes downstream, streaming consumers see
  // the previous answer prepended to the new one (visible in Open WebUI as
  // run-on output across turns). Strategy: only emit deltas after we've seen
  // status === "in_progress" for the current message id (i.e., it's being
  // generated live in this stream). Echoes always arrive already finished
  // and never transition through in_progress, so they get suppressed. An
  // end-of-stream fallback handles the rare case where a real turn arrives
  // as a single already-finished event (instant/cached responses).
  let conversationId = null;
  let currentId = null;
  let currentParts = "";
  let currentMetadata;
  let emittedLen = 0;
  let isLive = false;
  // Dedupe pointers across echoes / repeated events. Order-preserving Set.
  const imagePointers = new Map();
  // True if we observed signals the assistant kicked off the async image_gen
  // tool (see ContentChunk.imageGenAsync). The actual image arrives later via
  // WebSocket / polling — caller handles that.
  let imageGenAsync = false;
  let handoff = false;
  let resumeToken = null;

  for await (const event of readChatGptSseEvents(eventStream, signal)) {
    if (event.error) {
      const msg =
        isString(event.error)
          ? event.error
          : event.error.message || "ChatGPT stream error";
      yield { error: msg, done: true };
      return;
    }

    if (event.conversation_id) conversationId = event.conversation_id;

    if (event.type === "resume_conversation_token") {
      if (isString(event.token) && event.token) resumeToken = event.token;
      continue;
    }

    if (event.type === "stream_handoff") {
      handoff = true;
      yield {
        conversationId: conversationId ?? undefined,
        handoff: true,
        resumeToken: resumeToken ?? undefined,
      };
      continue;
    }

    // Detect image_gen on top-level "server_ste_metadata" events. These don't
    // have a `message` field so the post-message guard would skip them, but
    // they're the most reliable signal — `turn_use_case: "image gen"`.
    //
    // Originally we also accepted `meta.tool_invoked === true`, but ChatGPT
    // sets that flag for ANY internal tool the assistant uses (reasoning
    // chains, web search, calc, file_search, etc.). That made plain text
    // turns spuriously emit the "Generating image…" placeholder + 30s
    // WebSocket wait. Image gen has a more specific signal we can rely on:
    // either `turn_use_case === "image gen"` here, or an `image_gen_task_id`
    // on a tool-role message (handled below).
    if (event.type === "server_ste_metadata") {
      const meta = event.metadata;
      if (meta && meta.turn_use_case === "image gen") {
        imageGenAsync = true;
      }
    }

    const m = event.message;
    if (!m) continue;

    // Tool messages with `image_gen_task_id` in metadata (the "Processing
    // image..." card) confirm the async image_gen flow. We don't surface the
    // tool message itself as text — it's just a placeholder — but we mark
    // imageGenAsync so the executor knows to poll for the final image.
    if (m.metadata && isString(m.metadata.image_gen_task_id)) {
      imageGenAsync = true;
    }

    if (m.author?.role !== "assistant") continue;

    const id = m.id ?? null;
    const status = m.status ?? "";

    if (id && id !== currentId) {
      currentId = id;
      currentParts = "";
      currentMetadata = undefined;
      emittedLen = 0;
      isLive = false;
    }

    if (m.metadata && isObject(m.metadata)) {
      currentMetadata = m.metadata;
    }

    if (status === "in_progress") {
      isLive = true;
    }

    const parts = m.content?.parts ?? [];
    if (parts.length === 0) continue;

    // Image asset pointers: only collect once the message is finalized
    // (status === "finished_successfully"). The same pointer may also appear
    // on echoed prior turns at the head of the stream; that's fine — the Set
    // dedupes, and the resolver in the executor produces the same URL either
    // way. We could restrict to isLive-only to avoid resolving echoes, but
    // that makes single-event instant responses (no in_progress phase) lose
    // their image. Letting echoes through is harmless for correctness; the
    // executor resolves each unique pointer at most once.
    if (status === "finished_successfully" || status === "" || isLive) {
      for (const ptr of extractImagePointers(parts)) {
        const existing = imagePointers.get(ptr);
        imagePointers.set(
          ptr,
          existing?.messageId ? existing : imagePointerEntry(ptr, id)
        );
      }
    }

    const cumulative = parts.map((p) => (isString(p) ? p : "")).join("");
    if (cumulative.length > currentParts.length) {
      currentParts = cumulative;
    }

    if (isLive && currentParts.length > emittedLen) {
      const delta = currentParts.slice(emittedLen);
      emittedLen = currentParts.length;
      yield {
        delta,
        answer: currentParts,
        conversationId: conversationId ?? undefined,
        messageId: currentId ?? undefined,
        metadata: currentMetadata,
      };
    }
  }

  // End-of-stream fallback: if we never observed status === "in_progress"
  // for the current id (single-event reply, cached/instant response), emit
  // the accumulated content now so the consumer doesn't get an empty stream.
  if (!isLive && currentParts.length > emittedLen) {
    yield {
      delta: currentParts.slice(emittedLen),
      answer: currentParts,
      conversationId: conversationId ?? undefined,
      messageId: currentId ?? undefined,
      metadata: currentMetadata,
    };
  }

  yield {
    delta: "",
    answer: currentParts,
    conversationId: conversationId ?? undefined,
    messageId: currentId ?? undefined,
    metadata: currentMetadata,
    imagePointers: imagePointers.size > 0 ? Array.from(imagePointers.values()) : undefined,
    imageGenAsync,
    handoff,
    resumeToken: resumeToken ?? undefined,
    done: true,
  };
}

// ─── Long-running Pro handoff polling ──────────────────────────────────────

function textFromContentPart(part) {
  if (isString(part)) return part;
  if (!part || !isObject(part)) return "";
  const obj = part;
  for (const key of ["text", "content", "summary"]) {
    const value = obj[key];
    if (isString(value)) return value;
  }
  return "";
}

function detailMessageText(message) {
  const content = message.content;
  if (!content) return "";
  if (isString(content.text)) return content.text;
  const parts = content.parts ?? [];
  return parts.map(textFromContentPart).join("");
}

function extractFinalAssistantAnswer(detail) {
  const nodes = Object.values(detail.mapping ?? {});
  let best = null;

  for (const node of nodes) {
    const message = node.message;
    if (!message || message.author?.role !== "assistant") continue;
    if (message.metadata?.is_visually_hidden === true) continue;
    const contentType = message.content?.content_type ?? "";
    if (contentType.includes("thought") || contentType.includes("reasoning")) continue;

    const text = detailMessageText(message).trim();
    if (!text) continue;
    const finished = message.status === "finished_successfully" && message.end_turn !== false;
    const sort = message.update_time ?? message.create_time ?? 0;
    if (
      !best ||
      (finished && (!best.finished || sort >= best.sort)) ||
      (!finished && !best.finished && sort >= best.sort)
    ) {
      best = { text, messageId: message.id, metadata: message.metadata, finished, sort };
    }
  }

  if (!best) return null;
  return {
    text: best.text,
    messageId: best.messageId,
    metadata: best.metadata,
    finished: best.finished,
  };
}

function delayWithAbort(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function decodeUtf8DataUrl(text) {
  const marker = ";base64,";
  if (!text.startsWith("data:") || !text.includes(marker)) return text;
  const base64 = text.slice(text.indexOf(marker) + marker.length);
  return new TextDecoder().decode(Buffer.from(base64, "base64"));
}

async function fetchConversationDetail(conversationId, ctx) {
  const url = `${CHATGPT_BASE}/backend-api/conversation/${encodeURIComponent(conversationId)}`;
  const headers = {
    ...browserHeaders(),
    ...oaiHeaders(ctx.sessionId, ctx.deviceId),
    Accept: "application/json",
    Authorization: `Bearer ${ctx.accessToken}`,
    Cookie: buildNextAuthSessionCookie(ctx.cookie),
  };
  if (ctx.accountId) headers["chatgpt-account-id"] = ctx.accountId;

  try {
    const response = await tlsFetchChatGpt(url, {
      method: "GET",
      headers,
      timeoutMs: 30_000,
      signal: ctx.signal,
      // The native tls-client text path can surface UTF-8 JSON as mojibake
      // (e.g. 👉 becomes ðŸ‘‰). Ask for raw bytes and decode as UTF-8 here so
      // the final answer appended after Pro stream_handoff preserves Unicode.
      byteResponse: true,
    });
    if (response.status >= 400) {
      ctx.log?.warn?.(
        "CGPT-WEB",
        `conversation poll ${response.status}: ${(response.text || "").slice(0, 300)}`
      );
      return { detail: null, terminal: [401, 403, 404].includes(response.status) };
    }
    if (!response.text) return { detail: null, terminal: false };
    return {
      detail: JSON.parse(decodeUtf8DataUrl(response.text)),
      terminal: false,
    };
  } catch (err) {
    ctx.log?.warn?.(
      "CGPT-WEB",
      `conversation poll failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return { detail: null, terminal: false };
  }
}

async function pollForFinalAssistantAnswer(conversationId, ctx) {
  const started = Date.now();
  const timeoutMs = configuredProPollTimeoutMs();
  const intervalMs = configuredProPollIntervalMs();
  let last = null;
  let terminalPollFailure = false;

  while (!ctx.signal?.aborted && Date.now() - started < timeoutMs) {
    const { detail, terminal } = await fetchConversationDetail(conversationId, ctx);
    if (detail) {
      const answer = extractFinalAssistantAnswer(detail);
      if (answer) {
        last = answer;
        if (answer.finished) return answer;
      }
    }
    if (terminal) {
      terminalPollFailure = true;
      break;
    }
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) break;
    await delayWithAbort(Math.min(intervalMs, remaining), ctx.signal);
  }

  if (last) {
    ctx.log?.warn?.(
      "CGPT-WEB",
      terminalPollFailure
        ? `conversation poll stopped before finished_successfully; returning latest assistant text for ${conversationId}`
        : `conversation poll timed out before finished_successfully; returning latest assistant text for ${conversationId}`
    );
  } else {
    ctx.log?.warn?.(
      "CGPT-WEB",
      terminalPollFailure
        ? `conversation poll stopped without assistant text for ${conversationId}`
        : `conversation poll timed out without assistant text for ${conversationId}`
    );
  }
  return last;
}

// ─── OpenAI SSE format ──────────────────────────────────────────────────────

function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Resolves a ChatGPT asset_pointer to a downloadable URL, given the live
 * conversation_id (needed for sediment:// pointers). Returns null on failure
 * so the caller can decide whether to surface a placeholder or skip silently.
 */
/**
 * True when ChatGPT emitted an image asset pointer (the image WAS generated
 * upstream) but none of the pointers could be resolved to a downloadable URL
 * — so the assistant text carries no image markdown. Lets callers surface an
 * accurate "generated but not retrievable" error instead of the misleading
 * "no image was produced". Escalated mesh report: image visible in the ChatGPT
 * chat but returned to DurinDoor as a bare "completed without image markdown".
 */
export function detectImageResolutionFailure(pointerCount, resolvedCount) {
  return pointerCount > 0 && resolvedCount === 0;
}

/** Build the final markdown block for a list of resolved image URLs. */
function imageMarkdown(urls) {
  if (urls.length === 0) return "";
  // Two leading newlines → ensure separation from any prior text the model
  // produced ("Here is your kitten:\n\n![image](...)"). One image per line.
  return "\n\n" + urls.map((u) => `![image](${u})`).join("\n\n");
}

async function resolveImagePointers(
  pointers,
  conversationId,
  resolver,
  log,
  fallbackParentMessageId
) {
  if (!pointers || pointers.length === 0 || !resolver) return [];
  const urls = [];
  for (const ref of pointers) {
    try {
      const url = await resolver(
        ref.pointer,
        conversationId,
        ref.messageId ?? fallbackParentMessageId
      );
      if (url) urls.push(url);
    } catch (err) {
      log?.warn?.(
        "CGPT-WEB",
        `Image resolve failed (${ref.pointer}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return urls;
}

function buildStreamingResponse(
  eventStream,
  model,
  cid,
  created,
  resolver,
  // Optional poller for async image_gen — when ChatGPT processes the request
  // out-of-band ("Lots of people are creating images right now"), the SSE
  // stream finishes without an image_asset_pointer. The executor passes a
  // closure here that knows how to poll the conversation endpoint.
  pollAsyncImage,
  // Native Temporary Chat handoff continuation. ChatGPT provides a short-lived
  // conduit token, which resumes the turn without saving it to chat history.
  resumeFinalAnswer,
  // Legacy fallback for handoffs that omit the conduit token.
  pollFinalAnswer,
  log,
  signal
) {
  const encoder = new TextEncoder();

  return new ReadableStream(
    {
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id: cid,
                object: "chat.completion.chunk",
                created,
                model,
                system_fingerprint: null,
                choices: [
                  { index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null },
                ],
              })
            )
          );

          let conversationId = null;
          let imagePointers;
          let imageGenAsync = false;
          let handoff = false;
          let resumeToken = null;
          let emittedText = "";
          let polledFinalAnswer = null;
          let parentCandidateMessageId = null;

          const emitRenderedDelta = (content) => {
            if (!content) return;
            emittedText += content;
            controller.enqueue(
              encoder.encode(
                sseChunk({
                  id: cid,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  system_fingerprint: null,
                  choices: [
                    {
                      index: 0,
                      delta: { content },
                      finish_reason: null,
                      logprobs: null,
                    },
                  ],
                })
              )
            );
          };

          const emitRenderedAnswer = (rawText, metadata) => {
            const rendered = cleanChatGptText(rawText, metadata);
            if (!rendered || rendered.length <= emittedText.length) return;
            if (!rendered.startsWith(emittedText)) {
              // We cannot retract bytes already streamed. This should be rare;
              // it mainly protects clients if ChatGPT rewrites earlier text.
              const common = commonPrefixLength(rendered, emittedText);
              if (common < emittedText.length) return;
            }
            emitRenderedDelta(rendered.slice(emittedText.length));
          };

          const appendFinalAnswer = (text, metadata) => {
            const cleaned = cleanChatGptText(text, metadata);
            const finalTrimmed = cleaned.trim();
            if (!finalTrimmed) return;
            const emittedTrimmed = emittedText.trim();
            if (emittedTrimmed === finalTrimmed || emittedTrimmed.endsWith(finalTrimmed)) return;
            const prefix = emittedTrimmed && !emittedText.endsWith("\n") ? "\n\n" : "";
            emitRenderedDelta(`${prefix}${cleaned}`);
          };

          // Heartbeat: long async work (Pro polling, WebSocket image-gen,
          // 2-3 MB image fetch) leaves the SSE quiet and Open WebUI times out
          // at ~30s (`disconnect: ResponseAborted`). SSE comments and empty
          // `delta:{}` chunks are both filtered upstream
          // (`hasValuableContent` in open-sse/utils/streamHelpers.js), so
          // heartbeats are zero-width-space content deltas (`"​"`): they pass
          // the filter and render invisibly.
          const startHeartbeat = (intervalMs = 5_000) => {
            const heartbeatChunk = sseChunk({
              id: cid,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [{ index: 0, delta: { content: "​" }, finish_reason: null, logprobs: null }],
            });
            const timer = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(heartbeatChunk));
              } catch {
                // Controller may already be closed if the client disconnected
                // — just stop firing.
                console.warn("[chatgpt-web] heartbeat enqueue failed - controller closed");
                clearInterval(timer);
              }
            }, intervalMs);
            return () => clearInterval(timer);
          };

          for await (const chunk of extractContent(eventStream, signal)) {
            if (chunk.conversationId) conversationId = chunk.conversationId;
            if (chunk.messageId) parentCandidateMessageId = chunk.messageId;
            if (chunk.handoff) handoff = true;
            if (chunk.resumeToken) resumeToken = chunk.resumeToken;
            if (chunk.error) {
              controller.enqueue(
                encoder.encode(
                  sseChunk({
                    id: cid,
                    object: "chat.completion.chunk",
                    created,
                    model,
                    system_fingerprint: null,
                    choices: [
                      {
                        index: 0,
                        delta: { content: `[Error: ${chunk.error}]` },
                        finish_reason: null,
                        logprobs: null,
                      },
                    ],
                  })
                )
              );
              break;
            }

            if (chunk.done) {
              imagePointers = chunk.imagePointers;
              imageGenAsync = chunk.imageGenAsync ?? false;
              handoff = handoff || (chunk.handoff ?? false);
              if (chunk.resumeToken) resumeToken = chunk.resumeToken;
              if (chunk.messageId) parentCandidateMessageId = chunk.messageId;
              break;
            }

            if (chunk.answer) {
              emitRenderedAnswer(chunk.answer, chunk.metadata);
            }
          }

          if (resumeFinalAnswer && conversationId && handoff && resumeToken) {
            const stopHb = startHeartbeat();
            try {
              const resumed = await resumeFinalAnswer(conversationId, resumeToken);
              if (resumed?.text) {
                polledFinalAnswer = resumed;
                if (resumed.messageId) parentCandidateMessageId = resumed.messageId;
              }
            } finally {
              stopHb();
            }
          }

          if (!polledFinalAnswer && pollFinalAnswer && conversationId && handoff) {
            const stopHb = startHeartbeat();
            try {
              const polled = await pollFinalAnswer(conversationId);
              if (polled?.text) {
                polledFinalAnswer = polled;
                if (polled.messageId) parentCandidateMessageId = polled.messageId;
              }
            } finally {
              stopHb();
            }
          }

          if (polledFinalAnswer) {
            appendFinalAnswer(polledFinalAnswer.text, polledFinalAnswer.metadata);
          }

          // Async image_gen ends the SSE with a "Processing image..."
          // placeholder; poll the conversation endpoint in the background for
          // the final pointer (only when in-stream pointers are empty).
          if (
            imageGenAsync &&
            conversationId &&
            (!imagePointers || imagePointers.length === 0) &&
            pollAsyncImage
          ) {
            // Tell the user something is happening — long polls otherwise
            // look like a hang on the client side. The "..." plus a typing
            // cue renders nicely in Open WebUI.
            controller.enqueue(
              encoder.encode(
                sseChunk({
                  id: cid,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  system_fingerprint: null,
                  choices: [
                    {
                      index: 0,
                      delta: { content: "_Generating image…_\n\n" },
                      finish_reason: null,
                      logprobs: null,
                    },
                  ],
                })
              )
            );
            const stopHb = startHeartbeat();
            try {
              const polled = await pollAsyncImage(conversationId);
              if (polled.length > 0) imagePointers = polled;
            } catch (err) {
              log?.warn?.(
                "CGPT-WEB",
                `Async image poll failed: ${err instanceof Error ? err.message : String(err)}`
              );
            } finally {
              stopHb();
            }
          }

          // Resolve and append any image markdown after the text deltas finish
          // streaming. Downloading and caching the image bytes can take 1-3
          // seconds for big images, so keep the heartbeat running here too.
          const stopHb2 = startHeartbeat();
          let urls = [];
          try {
            urls = await resolveImagePointers(
              imagePointers,
              conversationId,
              resolver,
              log,
              parentCandidateMessageId
            );
          } finally {
            stopHb2();
          }
          // Bail out cleanly if the client disconnected during the wait —
          // any further enqueue throws "Invalid state: Controller is
          // already closed". Better to no-op than to surface that as a
          // server error.
          if (signal?.aborted) return;
          const mdBlock = imageMarkdown(urls);
          const safeEnqueue = (bytes) => {
            try {
              controller.enqueue(bytes);
              return true;
            } catch {
              console.warn("[chatgpt-web] controller enqueue failed");
              return false;
            }
          };
          // The image markdown is now a small URL (we cache the bytes in
          // memory and serve them at /v1/chatgpt-web/image/<id>), so a
          // single SSE chunk is fine — no aiohttp LineTooLong concerns
          // and the markdown renderer in Open WebUI sees the URL whole
          // and renders an `<img>` immediately.
          if (mdBlock) {
            if (
              !safeEnqueue(
                encoder.encode(
                  sseChunk({
                    id: cid,
                    object: "chat.completion.chunk",
                    created,
                    model,
                    system_fingerprint: null,
                    choices: [
                      {
                        index: 0,
                        delta: { content: mdBlock },
                        finish_reason: null,
                        logprobs: null,
                      },
                    ],
                  })
                )
              )
            )
              return;
          }

          if (
            !safeEnqueue(
              encoder.encode(
                sseChunk({
                  id: cid,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  system_fingerprint: null,
                  choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
                })
              )
            )
          )
            return;
          safeEnqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              sseChunk({
                id: cid,
                object: "chat.completion.chunk",
                created,
                model,
                system_fingerprint: null,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: `[Stream error: ${err instanceof Error ? err.message : String(err)}]`,
                    },
                    finish_reason: "stop",
                    logprobs: null,
                  },
                ],
              })
            )
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } finally {
          try {
            controller.close();
          } catch {}
        }
      },
    },
    { highWaterMark: 16384 }
  );
}

async function buildNonStreamingResponse(
  eventStream,
  model,
  cid,
  created,
  currentMsg,
  resolver,
  pollAsyncImage,
  resumeFinalAnswer,
  pollFinalAnswer,
  log,
  signal
) {
  let fullAnswer = "";
  let conversationId = null;
  let imagePointers;
  let imageGenAsync = false;
  let handoff = false;
  let resumeToken = null;
  let answerMetadata;
  let parentCandidateMessageId = null;

  for await (const chunk of extractContent(eventStream, signal)) {
    if (chunk.conversationId) conversationId = chunk.conversationId;
    if (chunk.messageId) parentCandidateMessageId = chunk.messageId;
    if (chunk.handoff) handoff = true;
    if (chunk.resumeToken) resumeToken = chunk.resumeToken;
    if (chunk.error) {
      return new Response(
        JSON.stringify({
          error: { message: chunk.error, type: "upstream_error", code: "CHATGPT_ERROR" },
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
    if (chunk.done) {
      fullAnswer = chunk.answer || fullAnswer;
      answerMetadata = chunk.metadata ?? answerMetadata;
      imagePointers = chunk.imagePointers;
      imageGenAsync = chunk.imageGenAsync ?? false;
      handoff = handoff || (chunk.handoff ?? false);
      if (chunk.resumeToken) resumeToken = chunk.resumeToken;
      if (chunk.messageId) parentCandidateMessageId = chunk.messageId;
      break;
    }
    if (chunk.answer) {
      fullAnswer = chunk.answer;
      answerMetadata = chunk.metadata ?? answerMetadata;
    }
  }

  let resumedAnswer = null;
  if (resumeFinalAnswer && conversationId && handoff && resumeToken) {
    resumedAnswer = await resumeFinalAnswer(conversationId, resumeToken);
    if (resumedAnswer?.text) {
      fullAnswer = resumedAnswer.text;
      answerMetadata = resumedAnswer.metadata ?? answerMetadata;
      if (resumedAnswer.messageId) parentCandidateMessageId = resumedAnswer.messageId;
    }
  }

  if (
    !resumedAnswer?.text &&
    pollFinalAnswer &&
    conversationId &&
    (handoff || !fullAnswer.trim())
  ) {
    const polled = await pollFinalAnswer(conversationId);
    if (polled?.text) {
      fullAnswer = polled.text;
      answerMetadata = polled.metadata ?? answerMetadata;
      if (polled.messageId) parentCandidateMessageId = polled.messageId;
    }
  }

  fullAnswer = cleanChatGptText(fullAnswer, answerMetadata);

  // Async image gen: SSE ended with "Processing image..." — poll for the
  // final pointer the same way the streaming path does.
  if (
    imageGenAsync &&
    conversationId &&
    (!imagePointers || imagePointers.length === 0) &&
    pollAsyncImage
  ) {
    try {
      const polled = await pollAsyncImage(conversationId);
      if (polled.length > 0) imagePointers = polled;
    } catch (err) {
      log?.warn?.(
        "CGPT-WEB",
        `Async image poll failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const urls = await resolveImagePointers(
    imagePointers,
    conversationId,
    resolver,
    log,
    parentCandidateMessageId
  );
  // The image genuinely exists upstream but no pointer resolved to a URL
  // (unknown asset scheme, download 403/expired, oversize). Flag it so the
  // image-generation handler can report an accurate "generated but not
  // retrievable" error instead of the misleading "no image markdown" 502.
  const imageResolutionFailed = detectImageResolutionFailure(
    imagePointers?.length ?? 0,
    urls.length
  );
  if (imageResolutionFailed && log?.warn) {
    const schemes = (imagePointers ?? [])
      .map((p) => p.pointer.split("://")[0] || p.pointer.slice(0, 24))
      .join(", ");
    log.warn(
      "CGPT-WEB",
      `Image generated upstream but no asset pointer resolved (schemes: ${schemes}) — surfacing as unretrievable`
    );
  }
  fullAnswer += imageMarkdown(urls);
  const promptTokens = Math.ceil(currentMsg.length / 4);
  const completionTokens = Math.ceil(fullAnswer.length / 4);

  const completion = {
      id: cid,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: null,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: fullAnswer },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
  };
  if (imageResolutionFailed) completion.x_image_resolution_failed = true;
  return new Response(JSON.stringify(completion), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Error response helpers ─────────────────────────────────────────────────

function errorResponse(status, message, code) {
  const error = { message, type: "upstream_error" };
  if (code) error.code = code;
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function imagePointerEntry(pointer, messageId) {
  const entry = { pointer };
  if (messageId) entry.messageId = messageId;
  return entry;
}

function normalizePublicBaseUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function firstForwardedValue(value) {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

function isLocalBaseUrl(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  } catch {
    console.warn("[chatgpt-web] URL parse failed, falling back to regex");
    return /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b/i.test(baseUrl);
  }
}

function deriveHeaderBaseUrl(clientHeaders) {
  const headers = clientHeaders ?? {};
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;

  const forwardedHost = firstForwardedValue(lower["x-forwarded-host"]);
  const forwardedProto = firstForwardedValue(lower["x-forwarded-proto"]);
  const host = forwardedHost || firstForwardedValue(lower["host"]);
  if (!host) return null;

  // Default to http for IPs, localhost, and explicit host:port values where
  // TLS is not a safe assumption. Reverse proxies can override via
  // x-forwarded-proto, and deployments can force the exact value with
  // DURINDOOR_PUBLIC_BASE_URL.
  const isPlain =
    host.includes("localhost") ||
    /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(host) ||
    host.endsWith(".local") ||
    host.includes(":");
  const proto = forwardedProto || (isPlain ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Build the absolute base URL the client should use to fetch our cached
 * images at /v1/chatgpt-web/image/<id>. The most reliable value is an
 * explicit browser-facing origin because relay clients such as Open WebUI
 * often reach DurinDoor from a container while the user's browser needs a
 * LAN, tunnel, or reverse-proxy URL.
 */
function derivePublicBaseUrl(clientHeaders, log) {
  const explicitPublicBase = normalizePublicBaseUrl(process.env.DURINDOOR_PUBLIC_BASE_URL);
  if (explicitPublicBase) {
    log?.debug?.("CGPT-WEB", `derivePublicBaseUrl: using DURINDOOR_PUBLIC_BASE_URL`);
    return explicitPublicBase;
  }

  const headerBase = deriveHeaderBaseUrl(clientHeaders);
  const configuredBase =
    normalizePublicBaseUrl(process.env.BASE_URL) ||
    normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);

  log?.debug?.(
    "CGPT-WEB",
    `derivePublicBaseUrl: configured=${configuredBase ?? "-"} header=${headerBase ?? "-"}`
  );

  if (configuredBase && (!headerBase || !isLocalBaseUrl(configuredBase))) return configuredBase;
  if (headerBase) return headerBase;
  if (configuredBase) return configuredBase;

  return `http://localhost:${process.env.PORT || 20128}`;
}

// ─── Image asset resolution ────────────────────────────────────────────────
// ChatGPT's image_gen tool emits `image_asset_pointer` parts whose
// `asset_pointer` is one of:
//
//   file-service://file-XXXX        → resolved via /backend-api/files/{id}/download
//   sediment://file-XXXX            → resolved via /backend-api/conversation/{conv_id}/attachment/{id}/download
//
// Both endpoints return JSON `{ download_url: "<azure-blob-sas-url>", ... }`.
// The signed URL has a limited lifetime (typically a few hours), but that's
// usually sufficient for the user to view the image in their UI right after
// generation. Persistent storage can be layered on later if needed.

const FILE_SERVICE_PREFIX = "file-service://";
const SEDIMENT_PREFIX = "sediment://";

async function fetchDownloadUrl(endpoint, ctx) {
  const headers = {
    ...browserHeaders(),
    ...oaiHeaders(ctx.sessionId, ctx.deviceId),
    Accept: "application/json",
    Authorization: `Bearer ${ctx.accessToken}`,
    Cookie: buildNextAuthSessionCookie(ctx.cookie),
  };
  if (ctx.accountId) headers["chatgpt-account-id"] = ctx.accountId;

  const response = await tlsFetchChatGpt(endpoint, {
    method: "GET",
    headers,
    timeoutMs: 30_000,
    signal: ctx.signal,
  });
  if (response.status !== 200) {
    ctx.log?.warn?.(
      "CGPT-WEB",
      `Image download URL fetch failed (${response.status}) for ${endpoint}`
    );
    return null;
  }
  let parsed = {};
  try {
    parsed = JSON.parse(response.text || "{}");
  } catch {
    console.warn("[chatgpt-web] image download URL parse failed");
    return null;
  }
  return parsed.download_url ?? null;
}

/**
 * Download a chatgpt.com signed image URL and re-serve it from DurinDoor's
 * short-lived image cache. The URLs returned by /files/<id>/download and
 * /conversation/<cid>/attachment/<fid>/download point at chatgpt.com's
 * estuary endpoint, which 403s for any request without the user's session
 * cookie. Downstream clients (Open WebUI, OpenAI-compatible apps) won't
 * have those cookies, so we download once via the authenticated TLS client
 * and return a browser-fetchable DurinDoor URL.
 */
const IMAGE_DOWNLOAD_MAX_BYTES = 8 * 1024 * 1024;

async function imageUrlToCachedImageUrl(signedUrl, ctx, imageContext) {
  const headers = {
    ...browserHeaders(),
    Accept: "image/*,*/*;q=0.8",
    Authorization: `Bearer ${ctx.accessToken}`,
    Cookie: buildNextAuthSessionCookie(ctx.cookie),
  };
  if (ctx.accountId) headers["chatgpt-account-id"] = ctx.accountId;

  let response;
  try {
    response = await tlsFetchChatGpt(signedUrl, {
      method: "GET",
      headers,
      timeoutMs: 60_000,
      signal: ctx.signal,
      // Required for binary payloads — the underlying tls-client returns
      // bytes as a `data:<mime>;base64,...` string when this is true.
      // Without it, raw image bytes get mangled by UTF-8 decoding.
      byteResponse: true,
    });
  } catch (err) {
    ctx.log?.warn?.(
      "CGPT-WEB",
      `Image fetch failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }

  if (response.status !== 200) {
    ctx.log?.warn?.(
      "CGPT-WEB",
      `Image fetch returned HTTP ${response.status} (${(response.text || "").slice(0, 120)})`
    );
    return null;
  }

  if (response.text == null || response.text.length === 0) return null;

  // tls-client-node already returns binary bodies as a "data:<mime>;base64,..."
  // string (see node_modules/tls-client-node/dist/response.js — its bytes()
  // method splits on the comma to extract base64). Decode back into bytes
  // so we can hand them to the cache.
  let bytes;
  let mime;
  if (/^data:[^;]{1,256};base64,/.test(response.text)) {
    const commaIdx = response.text.indexOf(",");
    const header = response.text.slice(5, commaIdx); // strip "data:"
    mime = header.split(";")[0] || "image/png";
    bytes = Buffer.from(response.text.slice(commaIdx + 1), "base64");
  } else {
    // Plain-text body (shouldn't happen for binary downloads with
    // byteResponse:true, but handle defensively).
    bytes = Buffer.from(response.text, "binary");
    mime = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  }
  if (bytes.length === 0 || bytes.length > IMAGE_DOWNLOAD_MAX_BYTES) {
    if (bytes.length > IMAGE_DOWNLOAD_MAX_BYTES) {
      ctx.log?.warn?.(
        "CGPT-WEB",
        `Image too large to cache (${bytes.length} bytes > ${IMAGE_DOWNLOAD_MAX_BYTES}); skipping`
      );
    }
    return null;
  }
  // Cache the image and return a stable HTTP URL pointing at our own
  // /v1/chatgpt-web/image/<id> route. Streaming the raw base64 back via
  // SSE deltas works but Open WebUI's progressive markdown renderer shows
  // each chunk as plain text mid-stream — the user sees megabytes of
  // base64 scroll past before the image renders. URL-based delivery
  // produces a small markdown delta and renders instantly when the
  // browser fetches the URL.
  const id = storeChatGptImage(bytes, mime, undefined, imageContext);
  return `${ctx.publicBaseUrl}/v1/chatgpt-web/image/${id}`;
}

/**
 * Resolve the async image_gen result by registering a WebSocket with
 * chatgpt.com and listening for the image_asset_pointer.
 *
 * Background: when chatgpt.com is busy ("Lots of people are creating images
 * right now") the image_gen tool defers — the initial SSE finishes with a
 * "Processing image..." placeholder and the real image arrives over a
 * WebSocket pubsub. (We checked: the conversation tree at
 * `/backend-api/conversation/{id}` is NOT updated when the image lands, so
 * polling that endpoint does nothing.)
 *
 * Flow:
 *   1. POST /backend-api/register-websocket → { wss_url, expires_at, ... }
 *   2. Open the wss_url with the standard WebSocket client.
 *      Auth lives in the URL (signed access token), so we don't need the
 *      TLS-impersonation transport here.
 *   3. Each WS message is JSON like { type: "wss-message", data: { ...
 *      conversation event ... } }. The conversation event has the same
 *      shape as the SSE events from /backend-api/f/conversation.
 *   4. Watch for assistant messages with multimodal_text + image_asset_pointer
 *      OR a `message_stream_complete` for the conversation. Resolve when
 *      either pointer arrives or the timeout fires.
 */
async function registerWebSocket(ctx) {
  // chatgpt.com migrated from POST /backend-api/register-websocket to a
  // GET-only endpoint under /backend-api/celsius/ws/user. The response shape
  // also changed from `{ wss_url }` → `{ websocket_url }`. Newer codebases
  // (g4f, etc.) all hit the celsius path; the legacy path now 404s.
  // Keep the legacy path as a fallback for older deployments.
  const candidates = [
    { url: `${CHATGPT_BASE}/backend-api/celsius/ws/user`, method: "GET" },
    { url: `${CHATGPT_BASE}/backend-api/register-websocket`, method: "POST" },
  ];
  const headers = {
    ...browserHeaders(),
    ...oaiHeaders(ctx.sessionId, ctx.deviceId),
    Accept: "application/json",
    Authorization: `Bearer ${ctx.accessToken}`,
    Cookie: buildNextAuthSessionCookie(ctx.cookie),
  };
  if (ctx.accountId) headers["chatgpt-account-id"] = ctx.accountId;

  for (const { url, method } of candidates) {
    let r;
    try {
      r = await tlsFetchChatGpt(url, {
        method,
        headers,
        body: method === "POST" ? "" : undefined,
        timeoutMs: 30_000,
        signal: ctx.signal,
      });
    } catch (err) {
      ctx.log?.warn?.(
        "CGPT-WEB",
        `register-websocket fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    if (r.status === 200) {
      try {
        const data = JSON.parse(r.text || "{}");

        const ws = data.websocket_url ?? data.wss_url;
        if (ws) {
          ctx.log?.debug?.("CGPT-WEB", `Got WebSocket URL via ${url}`);
          return ws;
        }
      } catch {
        console.warn("[chatgpt-web] WebSocket URL parse failed, falling through");
        /* fall through */
      }
    }
    ctx.log?.warn?.(
      "CGPT-WEB",
      `register-websocket via ${url} → ${r.status}: ${(r.text || "").slice(0, 200)}`
    );
  }
  return null;
}

async function waitForImageViaWebSocket(wssUrl, conversationId, timeoutMs, ctx) {
  return new Promise((resolve) => {
    const found = new Map();
    let resolved = false;
    let errored = false;
    let gotAnyMessage = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      try {
        ws.close();
      } catch {
        console.warn("[chatgpt-web] ws.close failed");
        /* ignore */
      }
      resolve({
        pointers: Array.from(found.values()),
        errored,
        gotAnyMessage,
      });
    };
    const ws = new WebSocket(wssUrl);
    const timer = setTimeout(() => {
      ctx.log?.warn?.("CGPT-WEB", `WebSocket image wait timed out after ${timeoutMs}ms`);
      finish();
    }, timeoutMs);
    const onAbort = () => {
      ctx.log?.debug?.("CGPT-WEB", "WebSocket aborted by client");
      finish();
    };
    ctx.signal?.addEventListener?.("abort", onAbort);
    ws.onopen = () => {
      gotAnyMessage = true;
      ctx.log?.debug?.("CGPT-WEB", "WebSocket open — waiting for image events");
    };
    ws.onerror = (e) => {
      errored = true;
      ctx.log?.warn?.("CGPT-WEB", `WebSocket error: ${e.message ?? "unknown"}`);
    };
    ws.onclose = () => {
      clearTimeout(timer);
      ctx.signal?.removeEventListener?.("abort", onAbort);
      finish();
    };
    ws.onmessage = (event) => {
      gotAnyMessage = true;
      let payload;
      const raw = isString(event.data) ? event.data : event.data.toString();
      try {
        payload = JSON.parse(raw);
      } catch {
        console.warn("[chatgpt-web] WebSocket event JSON parse failed");
        return;
      }
      // chatgpt.com's celsius WS frames look like:
      //   { type: "conversation-update",
      //     payload: { conversation_id: "...",
      //                update_content: { message: { ... }, ... } } }
      // Older deployments wrapped the conversation event directly as { data }.
      const obj = payload;
      const candidates = [];
      const innerPayload = obj.payload;
      const updateContent = innerPayload?.update_content;
      if (updateContent?.message) {
        candidates.push({
          message: updateContent.message,
          conversation_id: innerPayload?.conversation_id,
        });
      }
      // OmniRoute #7357: some deployments deliver the completion via update_content.messages[]
      // (plural array of { message: {...} } wrappers), not the singular field above.
      for (const entry of Array.isArray(updateContent?.messages) ? updateContent.messages : []) {
        const wrapped = entry?.message;
        if (wrapped) {
          candidates.push({
            message: wrapped,
            conversation_id: innerPayload?.conversation_id,
          });
        }
      }
      if (innerPayload?.message) {
        candidates.push({
          message: innerPayload.message,
          conversation_id: innerPayload.conversation_id,
        });
      }
      if (obj.data?.message) {
        candidates.push(obj.data);
      }

      for (const data of candidates) {
        if (data?.conversation_id && data.conversation_id !== conversationId) continue;
        const m = data?.message;
        // The async image_gen result arrives as a TOOL-role message
        // ({"author":{"role":"tool","name":"t2uay3k.sj1i4kz"}}), so we
        // accept tool messages here too — extractImagePointers does the
        // actual content_type filtering.
        if (Array.isArray(m?.content?.parts)) {
          for (const ptr of extractImagePointers(m.content?.parts ?? [])) {
            const existing = found.get(ptr);
            found.set(
              ptr,
              existing?.messageId ? existing : imagePointerEntry(ptr, m?.id)
            );
          }
        }
        if (m?.metadata && isObject(m.metadata)) {
          const md = m.metadata;
          const ptr = md.asset_pointer ?? md.image_asset_pointer;
          if (isString(ptr)) {
            const existing = found.get(ptr);
            found.set(
              ptr,
              existing?.messageId ? existing : imagePointerEntry(ptr, m?.id)
            );
          }
        }
      }
      if (found.size > 0) finish();
    };
  });
}

// Default 3-minute wait for the async image_gen tool to produce an image
// pointer over the celsius WebSocket. Tunable so deployments can stretch
// during chatgpt.com queue-deep windows ("Lots of people are creating
// images right now") without code changes.
const DEFAULT_ASYNC_IMAGE_TIMEOUT_MS = 180_000;

function configuredAsyncImageTimeoutMs() {
  const raw = Number(process.env.DURINDOOR_CGPT_WEB_IMAGE_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_ASYNC_IMAGE_TIMEOUT_MS;
  return Math.floor(raw);
}

async function pollForAsyncImage(conversationId, ctx, opts = {}) {
  const totalTimeoutMs = opts.timeoutMs ?? configuredAsyncImageTimeoutMs();
  const deadline = Date.now() + totalTimeoutMs;

  // One reconnect attempt on transport error: the WS endpoint is signed and
  // short-lived, and a network blip during the long wait would otherwise
  // lose the image entirely. The deadline is shared across attempts so we
  // never exceed the caller's budget.
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const wssUrl = await registerWebSocket(ctx);
    if (!wssUrl) {
      ctx.log?.warn?.(
        "CGPT-WEB",
        attempt === 0
          ? "Could not register WebSocket — async image gen not retrievable"
          : `WebSocket re-registration failed on retry attempt ${attempt + 1}`
      );
      if (attempt === 0) continue; // try again — registration can be flaky
      break; // fall through to the conversation-poll fallback below
    }
    ctx.log?.debug?.(
      "CGPT-WEB",
      `Registered WebSocket for async image (attempt ${attempt + 1}, ${remaining}ms remaining)`
    );
    const outcome = await waitForImageViaWebSocket(wssUrl, conversationId, remaining, ctx);
    if (outcome.pointers.length > 0) return outcome.pointers;
    if (ctx.signal?.aborted) return [];
    // Only retry when the connection died before producing anything useful.
    // A clean close with no pointers (e.g., upstream cancellation) shouldn't
    // burn a second attempt — the result would be the same.
    if (!outcome.errored || outcome.gotAnyMessage) break;
    ctx.log?.warn?.(
      "CGPT-WEB",
      `WebSocket attempt ${attempt + 1} ended in transport error before any frame; retrying`
    );
  }

  // Fallback: the async image websocket is unreliable in some environments —
  // register-websocket is Cloudflare-sensitive and the plain WebSocket lacks the
  // browser TLS fingerprint the HTTP client uses, so it can error or receive no
  // frames even though the image was generated. The image still lands in the
  // conversation, so poll it over the same authenticated HTTP path used
  // everywhere else and read the image_asset_pointer directly. This is the
  // durable fallback recommended in OmniRoute #7357.
  const pollDeadline = Math.max(deadline, Date.now() + 60_000);
  while (Date.now() < pollDeadline && !ctx.signal?.aborted) {
    const { detail } = await fetchConversationDetail(conversationId, ctx);
    const mapping = detail?.mapping;
    if (mapping) {
      // Prefer the newest message carrying image pointers, so a reused
      // conversation doesn't surface a stale image from an earlier turn.
      let newest = null;
      for (const node of Object.values(mapping)) {
        const message = node?.message;
        const parts = message?.content?.parts;
        if (!Array.isArray(parts)) continue;
        const pointers = extractImagePointers(parts).map((pointer) => ({
          pointer,
          messageId: message?.id,
        }));
        if (pointers.length === 0) continue;
        const at = message?.create_time ?? 0;
        if (!newest || at >= newest.at) newest = { pointers, at };
      }
      if (newest) {
        ctx.log?.info?.(
          "CGPT-WEB",
          `Recovered ${newest.pointers.length} image pointer(s) via conversation poll (websocket yielded none)`
        );
        return newest.pointers;
      }
    }
    await delayWithAbort(3_000, ctx.signal);
  }
  return [];
}

function makeImageResolver(ctx) {
  // Cache resolutions across the same request — the same pointer can show up
  // on multiple SSE events (in-progress + finished_successfully). One HTTP
  // round-trip per unique pointer is enough.
  const cache = new Map();

  return async (assetPointer, conversationId, parentMessageId) => {
    if (cache.has(assetPointer)) return cache.get(assetPointer) ?? null;

    let fileId = null;
    if (assetPointer.startsWith(FILE_SERVICE_PREFIX)) {
      fileId = assetPointer.slice(FILE_SERVICE_PREFIX.length);
    } else if (assetPointer.startsWith(SEDIMENT_PREFIX)) {
      fileId = assetPointer.slice(SEDIMENT_PREFIX.length);
    } else {
      ctx.log?.warn?.("CGPT-WEB", `Unknown asset_pointer scheme: ${assetPointer}`);
    }

    let signedUrl = null;
    if (fileId) {
      // Both endpoints return a chatgpt.com estuary URL signed for the
      // user's current session — that URL 403s without the cookie, so
      // downstream clients can't fetch it directly. We download once via
      // the authenticated TLS client and expose the bytes through
      // DurinDoor's short-lived image cache.
      //
      // /files/{id}/download is the historical path. It works for
      // chat-uploaded files and the older image_gen output format
      // (`file-XXXX`). Newer image-edit results from continued
      // conversations land with a `file_00000000XXXX` shape that 422s on
      // /files/{id}/download — they're conversation-scoped attachments
      // and only resolve through /conversation/{cid}/attachment/{fid}/
      // download. We try /files first because it's cheaper and works for
      // the common case, then fall through.
      signedUrl = await fetchDownloadUrl(
        `${CHATGPT_BASE}/backend-api/files/${encodeURIComponent(fileId)}/download`,
        ctx
      );
      if (!signedUrl && conversationId) {
        signedUrl = await fetchDownloadUrl(
          `${CHATGPT_BASE}/backend-api/conversation/${encodeURIComponent(conversationId)}/attachment/${encodeURIComponent(fileId)}/download`,
          ctx
        );
      }
    }

    let finalUrl = null;
    if (signedUrl) {
      // chatgpt.com signed URLs require the user's session cookie to fetch,
      // so we materialize the bytes into our own cache and emit an DurinDoor
      // URL. If that fails (oversize, network error, etc.) we return null —
      // never the signed URL — because handing it back would emit broken
      // markdown that 403s for the client. Better to drop the image silently
      // than render a broken link.
      finalUrl = await imageUrlToCachedImageUrl(
        signedUrl,
        ctx,
        conversationId && parentMessageId ? { conversationId, parentMessageId } : undefined
      );
    }
    cache.set(assetPointer, finalUrl);
    if (finalUrl) {
      const preview = finalUrl.startsWith("data:")
        ? `data:... (${finalUrl.length} chars)`
        : finalUrl.slice(0, 80) + "...";
      ctx.log?.debug?.("CGPT-WEB", `Resolved ${assetPointer} → ${preview}`);
    }
    return finalUrl;
  };
}

// ─── Executor ───────────────────────────────────────────────────────────────

export class ChatGptWebHttpExecutor extends BaseExecutor {
  constructor() {
    super("chatgpt-web", { id: "chatgpt-web", baseUrl: CONV_URL });
  }

  /**
   * Every tls-client call for this request, including those made from the SSE
   * stream's start(), inherits the connection's proxy options.
   */
  async execute(input) {
    return runWithTlsProxyOptions(input.proxyOptions ?? null, () => this.executeDirect(input));
  }

  async executeDirect({
    model,
    body,
    stream,
    credentials,
    signal,
    log,
    onCredentialsRefreshed,
    clientHeaders: explicitClientHeaders,
    requestContext,
  }) {
    const clientHeaders = explicitClientHeaders ?? requestContext?.clientHeaders ?? null;
    const messages = body?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array"),
        url: CONV_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Tool-call emulation (OmniRoute #5240, OmniRoute #7679): inject a `<tool>` contract when tools
    // are present; parsed back on the response side. Hardened for thinking models.
    const resolvedModel = resolveChatGptModel(model, body, credentials.providerSpecificData);
    const modelSlug = resolvedModel.slug;
    const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages(
      body || {},
      messages
    );

    if (!credentials.apiKey) {
      return {
        response: errorResponse(
          401,
          "ChatGPT auth failed — paste your __Secure-next-auth.session-token cookie value."
        ),
        url: CONV_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Pass the user's pasted cookie blob through to exchangeSession; the helper
    // accepts bare values, unchunked cookies, chunked (.0/.1) cookies, and full
    // "Cookie: ..." DevTools lines.
    const cookie = credentials.apiKey;

    // 1. Token exchange
    let tokenEntry;
    try {
      tokenEntry = await exchangeSession(cookie, signal);
    } catch (err) {
      if (err instanceof SessionAuthError) {
        log?.warn?.("CGPT-WEB", err.message);
        return {
          response: errorResponse(
            401,
            "ChatGPT auth failed — re-paste your __Secure-next-auth.session-token cookie from chatgpt.com.",
            "HTTP_401"
          ),
          url: SESSION_URL,
          headers: {},
          transformedBody: body,
        };
      }
      log?.error?.(
        "CGPT-WEB",
        `Session exchange failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return {
        response: errorResponse(
          502,
          `ChatGPT session exchange failed: ${err instanceof Error ? err.message : String(err)}`
        ),
        url: SESSION_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Surface any rotated cookie back to the caller so the DB credential is refreshed.
    if (tokenEntry.refreshedCookie && tokenEntry.refreshedCookie !== cookie) {
      const updated = { ...credentials, apiKey: tokenEntry.refreshedCookie };
      try {
        await onCredentialsRefreshed?.(updated);
      } catch (err) {
        log?.warn?.(
          "CGPT-WEB",
          `Failed to persist refreshed cookie: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // 2a. Warmup — GET / to scrape DPL + script src so the prekey looks legit.
    let dplInfo;
    try {
      dplInfo = await fetchDpl(cookie, signal);
    } catch (err) {
      log?.warn?.(
        "CGPT-WEB",
        `DPL warmup failed (continuing with fallback): ${err instanceof Error ? err.message : String(err)}`
      );
      dplInfo = {
        dpl: `dpl=${OAI_CLIENT_VERSION.replace(/^prod-/, "")}`,
        scriptSrc: `${CHATGPT_BASE}/_next/static/chunks/webpack-${randomHex(16)}.js`,
      };
    }

    // 2a'. Browser-like session warmup. Sentinel scores the session by whether
    // the client recently hit /me, /conversations, /models — same as a real
    // browser does on page load. Failures here are non-fatal; the worst case
    // is Sentinel still escalates to Turnstile.
    const sessionId = randomUUID();
    const turnTraceId = randomUUID();
    const deviceId = deviceIdFor(cookie);
    await runSessionWarmup(
      tokenEntry.accessToken,
      tokenEntry.accountId,
      sessionId,
      deviceId,
      cookie,
      signal,
      log
    );

    // 2b. Sentinel chat-requirements
    let reqs;
    try {
      reqs = await prepareChatRequirements(
        tokenEntry.accessToken,
        tokenEntry.accountId,
        sessionId,
        deviceId,
        cookie,
        dplInfo,
        signal,
        log
      );
    } catch (err) {
      if (err instanceof SentinelBlockedError) {
        log?.warn?.("CGPT-WEB", err.message);
        return {
          response: errorResponse(
            403,
            "ChatGPT blocked the request (Sentinel/Turnstile required). Try again later or open chatgpt.com in a browser to refresh state.",
            "SENTINEL_BLOCKED"
          ),
          url: SENTINEL_PREPARE_URL,
          headers: {},
          transformedBody: body,
        };
      }
      log?.error?.(
        "CGPT-WEB",
        `Sentinel failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return {
        response: errorResponse(
          502,
          `ChatGPT sentinel failed: ${err instanceof Error ? err.message : String(err)}`
        ),
        url: SENTINEL_PREPARE_URL,
        headers: {},
        transformedBody: body,
      };
    }

    log?.debug?.(
      "CGPT-WEB",
      `sentinel: token=${reqs.token ? "y" : "n"} pow=${reqs.proofofwork?.required ? "y" : "n"} turnstile=${reqs.turnstile?.required ? "y" : "n"}`
    );

    // Optional: if a turnstile token was supplied via providerSpecificData,
    // pass it through. Otherwise, send the request anyway — sometimes Sentinel
    // reports turnstile.required even when the conversation endpoint accepts
    // requests without it.
    const turnstileToken =
      isString(credentials.providerSpecificData?.turnstileToken)
        ? credentials.providerSpecificData.turnstileToken
        : null;

    // 3. Solve PoW (if required) — reuses the same browser-fingerprint config
    // shape as the prekey, just with the server-provided seed + difficulty.
    let proofToken = null;
    if (reqs.proofofwork?.required && reqs.proofofwork.seed && reqs.proofofwork.difficulty) {
      const powConfig = buildPrekeyConfig(CHATGPT_USER_AGENT, dplInfo.dpl, dplInfo.scriptSrc);
      proofToken = await solveProofOfWork(
        reqs.proofofwork.seed,
        reqs.proofofwork.difficulty,
        powConfig,
        log
      );
    }

    // 4. Build conversation request
    const parsed = parseOpenAIMessages(effectiveMessages);
    if (!parsed.currentMsg.trim() && parsed.history.length === 0) {
      return {
        response: errorResponse(400, "Empty user message"),
        url: CONV_URL,
        headers: {},
        transformedBody: body,
      };
    }

    // Toggle Temporary Chat off only when ChatGPT needs a durable image
    // conversation. Text requests, including GPT-5.6 Sol Pro, stay temporary so
    // they do not show up in the user's chatgpt.com sidebar/history.
    const imageEdit = looksLikeImageEditRequest(parsed);
    const continuation = imageEdit ? parsed.latestImageContext : null;
    const forImageGen = looksLikeImageGenRequest(parsed) || imageEdit;
    const persistConversation = forImageGen || !!continuation;
    if (forImageGen) {
      log?.debug?.(
        "CGPT-WEB",
        continuation
          ? "Image edit intent detected — continuing saved image conversation"
          : "Image-gen intent detected — disabling Temporary Chat for this turn"
      );
    } else if (resolvedModel.isPro) {
      log?.debug?.("CGPT-WEB", "GPT-5.6 Sol Pro text request — keeping Temporary Chat enabled");
    }

    const parentMessageId = continuation?.parentMessageId ?? randomUUID();
    const cgptBody = buildConversationBody(parsed, modelSlug, parentMessageId, {
      persistConversation,
      thinkingEffort: resolvedModel.effort,
      systemHints: resolveChatGptSystemHints(model),
      continuation,
    });

    const headers = {
      ...browserHeaders(),
      ...oaiHeaders(sessionId, deviceId),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${tokenEntry.accessToken}`,
      Cookie: buildNextAuthSessionCookie(cookie),
      "x-oai-turn-trace-id": turnTraceId,
    };
    if (tokenEntry.accountId) headers["chatgpt-account-id"] = tokenEntry.accountId;
    if (reqs.token) headers["openai-sentinel-chat-requirements-token"] = reqs.token;
    if (reqs.prepare_token)
      headers["openai-sentinel-chat-requirements-prepare-token"] = reqs.prepare_token;
    if (proofToken) headers["openai-sentinel-proof-token"] = proofToken;
    if (turnstileToken) headers["openai-sentinel-turnstile-token"] = turnstileToken;

    log?.info?.("CGPT-WEB", `Conversation request → ${modelSlug} (pow=${!!proofToken})`);

    let response;
    try {
      response = await tlsFetchChatGpt(CONV_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(cgptBody),
        timeoutMs: 120_000, // generations can take a while
        signal,
        // For real-time streaming, ask the TLS client to write the body to
        // a temp file and surface it as a ReadableStream as it arrives —
        // otherwise long generations buffer entirely before the client sees
        // anything (and the downstream HTTP request can time out).
        stream,
      });
    } catch (err) {
      log?.error?.("CGPT-WEB", `Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      const code = err instanceof TlsClientUnavailableError ? "TLS_UNAVAILABLE" : undefined;
      return {
        response: errorResponse(
          502,
          `ChatGPT connection failed: ${err instanceof Error ? err.message : String(err)}`,
          code
        ),
        url: CONV_URL,
        headers,
        transformedBody: cgptBody,
      };
    }

    if (response.status >= 400) {
      const status = response.status;
      // Log the upstream body on 4xx/5xx — error responses are small and the
      // upstream message is much more useful than our wrapper. Goes through
      // the executor logger so it respects the application's log config.
      log?.warn?.("CGPT-WEB", `conv ${status}: ${(response.text || "").slice(0, 400)}`);
      const errMsg = describeChatGptWebHttpError(status);
      if (status === 401 || status === 403) {
        tokenCache.delete(cookieKey(cookie));
      }
      log?.warn?.("CGPT-WEB", errMsg);
      return {
        response: errorResponse(status, errMsg, `HTTP_${status}`),
        url: CONV_URL,
        headers,
        transformedBody: cgptBody,
      };
    }

    // For streaming requests the TLS client returns a ReadableStream that
    // tails the temp file as it's written. For non-streaming requests, it
    // returns the full body as text — wrap that in a one-shot stream so the
    // existing SSE parser can consume it uniformly.
    let bodyStream;
    if (response.body) {
      bodyStream = response.body;
    } else if (response.text) {
      bodyStream = stringToStream(response.text);
    } else {
      return {
        response: errorResponse(502, "ChatGPT returned empty response body"),
        url: CONV_URL,
        headers,
        transformedBody: cgptBody,
      };
    }

    const cid = `chatcmpl-cgpt-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    const resolverCtx = {
      accessToken: tokenEntry.accessToken,
      accountId: tokenEntry.accountId,
      sessionId,
      deviceId,
      cookie,
      signal,
      log,
      publicBaseUrl: derivePublicBaseUrl(clientHeaders, log),
    };
    const imageResolver = makeImageResolver(resolverCtx);
    const pollAsyncImage = (conversationId) => pollForAsyncImage(conversationId, resolverCtx);
    const resumeFinalAnswer = (conversationId, resumeToken) =>
      resumeChatGptHandoff({
        conversationId,
        resumeToken,
        headers,
        timeoutMs: configuredProPollTimeoutMs(),
        signal,
        log,
        readContent: extractContent,
      });
    const pollFinalAnswer = resolvedModel.isPro
      ? (conversationId) => pollForFinalAssistantAnswer(conversationId, resolverCtx)
      : null;

    // Tool mode buffers (no live streaming) and is gated off the image-gen path.
    const toolMode = hasTools && !forImageGen;

    let finalResponse;
    if (stream && !toolMode) {
      const sseStream = buildStreamingResponse(
        bodyStream,
        model,
        cid,
        created,
        imageResolver,
        pollAsyncImage,
        resumeFinalAnswer,
        pollFinalAnswer,
        log,
        signal
      );
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(
        bodyStream,
        model,
        cid,
        created,
        parsed.currentMsg,
        imageResolver,
        pollAsyncImage,
        resumeFinalAnswer,
        pollFinalAnswer,
        log,
        signal
      );
      if (toolMode) {
        finalResponse = await buildToolModeResponse(finalResponse, requestedTools, stream, {
          cid,
          created,
          model,
        });
      }
    }

    return { response: finalResponse, url: CONV_URL, headers, transformedBody: cgptBody };
  }
}

function commonPrefixLength(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function stringToStream(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

// Test-only: clear caches between tests
export function __resetChatGptWebCachesForTesting() {
  tokenCache.clear();
  warmupCache.clear();
  deviceIdCache.clear();
  __resetChatGptImageCacheForTesting();
  dplCache = null;
}

export const __derivePublicBaseUrlForTesting = derivePublicBaseUrl;
