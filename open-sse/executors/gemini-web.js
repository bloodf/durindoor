/**
 * Gemini Web executor (ported from OmniRoute).
 *
 * Drives the user's own signed-in gemini.google.com session. A pooled
 * Playwright Chromium opens a fresh context per request, seeds it with the
 * connection's Google cookies, types one flat prompt into the composer and
 * captures the first `StreamGenerate` response the page itself sends, or reads
 * the rendered answer when none arrives (see gemini-web-dom.js). No
 * request envelope is forged outside the page, so the page's own bootstrap
 * (SNlM0e token, f.sid, bl) and conversation creation stay Google's code.
 *
 * Auth     __Secure-1PSID + __Secure-1PSIDTS cookies (a pasted Cookie header,
 *          a bare PSID value, or browser-export JSON).
 * Stream   StreamGenerate returns cumulative snapshots in one body, so the
 *          answer is replayed as one OpenAI chunk plus a stop chunk.
 * Errors   A redirect to accounts.google.com, or a 401/403 from StreamGenerate,
 *          is a credential error (401/403). A 429 is a quota error (429).
 *
 * Ported from OmniRoute release/v3.8.55
 * (4265bb2ad5477450a07d3a43ea33a62c6c874878): open-sse/executors/gemini-web.ts,
 * gemini-web/{browserErrors,browserLease,capabilities,modeSelection}.ts,
 * utils/geminiCookies.ts and validateGeminiWebProvider in
 * src/lib/providers/validation/webProvidersB.ts. MIT.
 *
 * Registered in open-sse/executors/index.js. See docs/providers/gemini-web.mdx.
 */
import { BaseExecutor } from "./base.js";
import { createExecutorSender } from "./sendRequest.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { buildToolModeResponse } from "./chatgptWebTools.js";
import { isGeminiSignedOut, snapshotGeminiDom, waitForGeminiAnswer } from "./gemini-web-dom.js";
import { prepareToolMessages } from "../translator/webTools.js";
import { errorResponse, sanitizeErrorMessage } from "../utils/error.js";
import { resolveConnectProxyForRequest } from "../utils/proxyFetch.js";
import { getProviderValidationGuard, guardedProbeFetch, OutboundUrlGuardError } from "../utils/outboundUrlGuard.js";
import { resolvePlaywrightProxy } from "../services/browserPool.js";
import { isFunction, isRecord, isString } from "../../src/shared/utils/typeChecks.js";

const isObject = isRecord;

export const GEMINI_WEB_URL = "https://gemini.google.com/app";
export const GEMINI_WEB_ORIGIN = "https://gemini.google.com";
/**
 * Playwright proxy for the browser context, from the account's proxy options (OmniRoute #20739).
 * An assigned proxy that cannot be turned into a Playwright proxy fails closed instead of letting
 * the browser egress directly from the host IP.
 */
export function resolveGeminiWebBrowserProxy(proxyOptions) {
  const proxyUrl = resolveConnectProxyForRequest(GEMINI_WEB_URL, proxyOptions).proxyUrl;
  if (!proxyUrl) return undefined;
  const proxy = resolvePlaywrightProxy(proxyUrl);
  if (!proxy) throw new Error("Gemini Web proxy is invalid; refusing a direct connection");
  return proxy;
}

/** Response-label fallback when the request names no model. */
const DEFAULT_MODEL_ID = "gemini-2.5-pro";
const GEMINI_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const COMPOSER_SELECTOR = ".ql-editor, [contenteditable='true']";
const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;
const ROTATABLE_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC"];
export const GEMINI_WEB_UNSUPPORTED_CONTROL_CODE = "unsupported_control_for_provider";
export const GEMINI_WEB_BROWSER_IDLE_MS = 60_000;

// ─── Cookies ────────────────────────────────────────────────────────────────

// Domains whose cookies a browser sends to gemini.google.com.
const GEMINI_COOKIE_DOMAINS = new Set(["google.com", "gemini.google.com"]);
// Characters that would end a pair or the header itself.
const UNSAFE_COOKIE_NAME = /[\s;=\x00-\x1f\x7f]/;
const UNSAFE_COOKIE_VALUE = /[;\x00-\x1f\x7f]/;

/** Pairs from a Cookie-Editor style `[{ name, value, domain }]` export (9router#5837). */
function cookiePairsFromList(entries) {
  const pairs = new Map();
  for (const entry of entries) {
    if (!isObject(entry) || !isString(entry.name) || !isString(entry.value)) continue;
    const { name, domain } = entry;
    const value = entry.value.trim();
    if (!name || !value || UNSAFE_COOKIE_NAME.test(name) || UNSAFE_COOKIE_VALUE.test(value)) continue;
    if (isString(domain) && !GEMINI_COOKIE_DOMAINS.has(domain.toLowerCase().replace(/^\./, ""))) continue;
    pairs.set(name, value);
  }
  return Array.from(pairs, ([name, value]) => `${name}=${value}`);
}

/** Cookie pairs from JSON input, or null when the input is not a JSON cookie export. */
function cookiePairsFromJson(raw) {
  if (!raw.startsWith("{") && !raw.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.cookies;
    if (Array.isArray(list)) return cookiePairsFromList(list);
    const cookies = isObject(parsed.cookies) ? parsed.cookies : parsed;
    const pairs = Object.entries(cookies)
      .filter(([, value]) => isString(value) && value.trim().length > 0)
      .map(([name, value]) => `${name}=${value.trim()}`);
    return pairs.length > 0 ? pairs : null;
  } catch {
    return null;
  }
}

/** Normalize a pasted Gemini cookie header, bare PSID, or browser-export JSON. */
export function normalizeGeminiCookieInput(raw, cookieName = "__Secure-1PSID") {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  // A cookie list with nothing usable yields "" rather than a PSID made of JSON text.
  const jsonPairs = cookiePairsFromJson(trimmed);
  if (jsonPairs) return jsonPairs.join("; ");
  return trimmed.includes("=") ? trimmed : `${cookieName}=${trimmed}`;
}

/**
 * Normalize a pasted credential for the connection test and require a
 * non-empty `__Secure-1PSID`. Returns null when none is present, so callers can
 * reject before any network call.
 */
export function normalizeGeminiValidationCookie(raw) {
  const cookie = normalizeGeminiCookieInput(String(raw ?? "").trim().replace(/^cookie:\s*/i, ""));
  const psid = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("__secure-1psid="));
  if (!psid || psid.slice(psid.indexOf("=") + 1).trim().length === 0) return null;
  return cookie;
}

const COOKIE_ATTRIBUTES = new Set(["path", "domain", "expires", "max-age", "secure", "httponly", "samesite"]);

/** `name=value; name2=value2` to pairs, dropping Set-Cookie attributes. */
export function parseCookies(raw) {
  return String(raw ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return null;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (!name || !value || COOKIE_ATTRIBUTES.has(name.toLowerCase())) return null;
      return { name, value };
    })
    .filter(Boolean);
}

/**
 * Merge rotated __Secure-1PSID* cookies from the live cookie jar into the
 * stored string. Only the long-lived Gemini auth cookies are considered, so
 * short-lived analytics and consent cookies never become credentials.
 */
export function mergeRotatedGeminiCookies(originalCookie, jarCookies) {
  const jar = new Map(jarCookies.map((cookie) => [cookie.name, cookie.value]));
  const seen = new Set();
  const merged = parseCookies(originalCookie).map(({ name, value }) => {
    seen.add(name);
    return { name, value: ROTATABLE_COOKIES.includes(name) && jar.has(name) ? jar.get(name) : value };
  });
  for (const name of ROTATABLE_COOKIES) {
    if (!seen.has(name) && jar.has(name)) merged.push({ name, value: jar.get(name) });
  }
  return merged.map(({ name, value }) => `${name}=${value}`).join("; ");
}

const credentialString = (value) => (isString(value) ? value.trim() : "");

function providerString(data, keys) {
  if (!isObject(data)) return "";
  for (const key of keys) {
    const value = credentialString(data[key]);
    if (value) return value;
  }
  return "";
}

/** The Cookie header for one connection, from apiKey, `cookie` or the PSID fields. */
export function resolveGeminiWebCookie(credentials) {
  const direct = credentialString(credentials?.apiKey) || credentialString(credentials?.cookie);
  if (direct) return normalizeGeminiCookieInput(direct);
  const data = credentials?.providerSpecificData;
  const cookie = providerString(data, ["cookie"]);
  if (cookie) return normalizeGeminiCookieInput(cookie);
  const psid = providerString(data, ["__Secure-1PSID"]);
  const psidts = providerString(data, ["__Secure-1PSIDTS"]);
  return [
    psid ? normalizeGeminiCookieInput(psid, "__Secure-1PSID") : "",
    psidts ? normalizeGeminiCookieInput(psidts, "__Secure-1PSIDTS") : "",
  ].filter(Boolean).join("; ");
}

// ─── Prompt and response shaping ────────────────────────────────────────────

function flattenTextContent(content) {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return null;
  const text = [];
  for (const part of content) {
    if (!isObject(part) || part.type !== "text" || !isString(part.text)) return null;
    text.push(part.text);
  }
  return text.join("");
}

/**
 * Flatten OpenAI `messages[]` into the single prompt typed into the web UI.
 * The provider is stateless (no upstream conversation id is threaded), so the
 * history travels in the prompt. A single user turn without a system message is
 * returned unchanged.
 */
export function buildGeminiPrompt(messages) {
  const text = [];
  for (const message of messages) {
    const content = flattenTextContent(message.content);
    if (content?.trim()) text.push({ role: message.role, content });
  }
  const lastUser = text.filter((m) => m.role === "user").at(-1);
  const lastUserContent = lastUser?.content ?? "";
  const lastUserIdx = lastUser ? text.lastIndexOf(lastUser) : -1;
  const prior = text.filter((m, i) => i < lastUserIdx && (m.role === "user" || m.role === "assistant"));
  const system = text.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");

  if (prior.length === 0 && !system) return lastUserContent;
  if (prior.length === 0) return `System:\n${system}\n\n${lastUserContent}`;
  const history = prior.map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`);
  const parts = [];
  if (system) parts.push(`System:\n${system}`);
  parts.push(`Previous conversation:\n${history.join("\n\n")}`);
  parts.push(`Current user message:\n${lastUserContent}`);
  return parts.join("\n\n");
}

/**
 * Prompt for a request with a tool contract: every system message (the
 * client's own and the synthetic tool contract, in order), the rendered tool
 * rounds, then the current user ask.
 */
export function buildGeminiToolPrompt(messages) {
  const toolPrompt = messages
    .filter((m) => m.role === "system")
    .map((m) => flattenTextContent(m.content))
    .filter((content) => content !== null)
    .join("\n\n");
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
  const userText = flattenTextContent(messages[lastUserIdx]?.content) ?? "";

  const prior = [];
  for (const [index, m] of messages.entries()) {
    if (index === lastUserIdx) continue;
    const content = flattenTextContent(m.content);
    if (content?.trim()) {
      if (m.role === "user") prior.push(`User: ${content}`);
      else if (m.role === "assistant") prior.push(`Assistant: ${content}`);
      else if (m.role === "tool") {
        const id = isString(m.tool_call_id) ? m.tool_call_id : "";
        prior.push(id ? `Tool result [${id}]: ${content}` : `Tool result: ${content}`);
      }
    }
    for (const call of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
      const name = isString(call?.function?.name) ? call.function.name : "tool";
      const args = isString(call?.function?.arguments) ? call.function.arguments : "{}";
      const id = isString(call?.id) ? ` [${call.id}]` : "";
      prior.push(`Assistant requested tool${id}: ${name}(${args})`);
    }
  }
  if (prior.length === 0) return toolPrompt ? `${toolPrompt}\n\n${userText}` : userText;
  const parts = [];
  if (toolPrompt) parts.push(toolPrompt);
  parts.push(`Previous conversation:\n${prior.join("\n\n")}`);
  parts.push(`Current user message:\n${userText}`);
  return parts.join("\n\n");
}

/**
 * Parse a StreamGenerate body:
 *
 *   )]}'
 *   <length>
 *   [["wrb.fr", null, "<JSON string>"]]
 *
 * The inner JSON holds the answer at [4][0][1]. Every frame is a cumulative
 * snapshot, so only the last frame with text is kept.
 */
export function parseStreamResponse(raw) {
  let lastText = "";
  for (const rawLine of String(raw ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line || line === ")]}'" || /^\d+$/.test(line) || !line.includes("wrb.fr")) continue;
    try {
      const frame = JSON.parse(line);
      if (!Array.isArray(frame) || !Array.isArray(frame[0]) || frame[0][0] !== "wrb.fr") continue;
      const payload = frame[0][2];
      if (!isString(payload)) continue;
      const answer = JSON.parse(payload)?.[4]?.[0]?.[1];
      if (!Array.isArray(answer)) continue;
      const text = answer.filter(isString).join("");
      if (text) lastText = text;
    } catch {
      // An unparseable frame is skipped.
    }
  }
  return lastText;
}

function chatCompletion(content, model) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function streamChunk(content, model, finishReason = null) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
  };
}

function sseResponse(model, text) {
  const encoder = new TextEncoder();
  const frames = [streamChunk(text, model), streamChunk("", model, "stop")]
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`);
  frames.push("data: [DONE]\n\n");
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } },
  );
}

// ─── Request-contract guards ────────────────────────────────────────────────

const FORCING_TOOL_CHOICE_STRINGS = new Set(["required", "any"]);
const FORCING_TOOL_CHOICE_TYPES = new Set(["function", "tool", "any"]);
const SATISFIED_EFFORT_LEVELS = new Set(["none", "minimal"]);

const normalizedString = (value) => (isString(value) && value.trim() ? value.trim().toLowerCase() : null);

/** True when `tool_choice` demands a tool call, which prompt emulation cannot guarantee. */
export function isForcingToolChoice(toolChoice) {
  const asString = normalizedString(toolChoice);
  if (asString) return FORCING_TOOL_CHOICE_STRINGS.has(asString);
  if (isObject(toolChoice)) {
    const type = normalizedString(toolChoice.type);
    return type !== null && FORCING_TOOL_CHOICE_TYPES.has(type);
  }
  return false;
}

/** True when `reasoning_effort` asks for more than "none"/"minimal". */
export function requestsThinkingBudget(effort) {
  const value = normalizedString(effort);
  return value !== null && !SATISFIED_EFFORT_LEVELS.has(value);
}

// ─── Mode selection ─────────────────────────────────────────────────────────
// The selectors are unvalidated guesses at Gemini's DOM. Selection never trusts
// a click: the active-mode indicator is read back, and an unconfirmed switch is
// rejected (400) instead of answering under a label that never ran.

const MODE_TOGGLE =
  '[data-test-id="bard-mode-menu-button"], button[aria-haspopup="menu"][aria-label*="model" i]';
const MODE_INDICATOR =
  '[data-test-id="bard-mode-menu-button"] .mode-title, [data-test-id="bard-mode-menu-button"]';

const MODEL_MODES = {
  "gemini-3.1-pro": { isDefault: true },
  "gemini-3.7-flash": { toggle: MODE_TOGGLE, indicator: MODE_INDICATOR, expected: /\bflash\b(?!.*\blite\b)/i },
  "gemini-3.1-flash-lite": { toggle: MODE_TOGGLE, indicator: MODE_INDICATOR, expected: /flash.*\blite\b/i },
};

const EXTENDED_THINKING_MODE = {
  toggle:
    '[data-test-id="deep-think-toggle"], button[aria-label*="extended thinking" i], button[aria-label*="deep think" i]',
  indicator: '[data-test-id="deep-think-toggle"][aria-pressed="true"], [data-test-id="deep-think-toggle"].is-active',
  expected: /thinking|deep think/i,
};

const MODE_FAILURE_DETAIL = {
  unknown_model: "it is not one of the advertised, selectable gemini-web models",
  control_not_found: "the Gemini UI control used to switch modes was not found",
  indicator_not_found: "the active-mode indicator used to confirm the switch was not found",
  indicator_mismatch: "the active-mode indicator did not confirm the switch after attempting it",
};

async function readIndicatorText(element) {
  try {
    const text = await element.textContent?.();
    if (isString(text)) return text;
    return (await element.innerText?.()) ?? null;
  } catch {
    return null;
  }
}

async function selectMode(page, mode, timeout = 5000) {
  if (!mode) return { confirmed: false, reason: "unknown_model" };
  if (mode.isDefault) return { confirmed: true };
  const toggle = await page.waitForSelector(mode.toggle, { timeout }).catch(() => null);
  if (!toggle) return { confirmed: false, reason: "control_not_found" };
  await toggle.click();
  // The signed-out "Sign in" item can exist only inside the open mode menu.
  if (await isGeminiSignedOut(page)) return { confirmed: false, reason: "signed_out" };
  const indicator = await page.waitForSelector(mode.indicator, { timeout }).catch(() => null);
  if (!indicator) return { confirmed: false, reason: "indicator_not_found" };
  const text = await readIndicatorText(indicator);
  if (!text || !mode.expected.test(text)) return { confirmed: false, reason: "indicator_mismatch" };
  return { confirmed: true };
}

const modeFailureMessage = (label, reason) =>
  `Model provider "gemini-web" could not verify that "${label}" is actually active in the Gemini web UI ` +
  `(${MODE_FAILURE_DETAIL[reason] || "the switch could not be verified"}). The request was rejected instead of ` +
  "answering under a model or mode label that may not be accurate.";

// ─── Browser lease ──────────────────────────────────────────────────────────
// One Chromium process, a fresh context per request: two accounts never share a
// page. The process closes after it has been idle.

let slot = null;
let pendingLaunch = null;
let inflight = 0;
let idleTimer = null;

const alive = (browser) => !isFunction(browser.isConnected) || browser.isConnected();

function clearIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

async function acquireBrowser(launch) {
  clearIdle();
  if (slot && alive(slot.browser) && (slot.launch === launch || inflight > 0)) {
    inflight += 1;
    return slot.browser;
  }
  if (pendingLaunch) {
    inflight += 1;
    try {
      return await pendingLaunch;
    } catch (error) {
      inflight = Math.max(0, inflight - 1);
      throw error;
    }
  }
  if (slot) {
    const previous = slot.browser;
    slot = null;
    await previous.close().catch(() => {});
  }
  inflight += 1;
  // Publish the in-flight promise before invoking/awaiting the launcher. Deferring
  // the call also covers launchers that throw synchronously.
  const launching = Promise.resolve().then(() => launch({ headless: true })).then((browser) => {
    slot = { launch, browser };
    return browser;
  });
  pendingLaunch = launching;
  try {
    return await launching;
  } catch (error) {
    inflight = Math.max(0, inflight - 1);
    throw error;
  } finally {
    if (pendingLaunch === launching) pendingLaunch = null;
  }
}

async function releaseBrowser(browser) {
  inflight = Math.max(0, inflight - 1);
  if (inflight > 0 || slot?.browser !== browser) return;
  clearIdle();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (inflight === 0 && slot?.browser === browser) {
      slot = null;
      void browser.close().catch(() => {});
    }
  }, GEMINI_WEB_BROWSER_IDLE_MS);
  idleTimer.unref?.();
}

/** Test seam: drop the leased browser and any idle timer. */
export async function resetGeminiBrowserLeaseForTests() {
  clearIdle();
  inflight = 0;
  pendingLaunch = null;
  const previous = slot?.browser;
  slot = null;
  if (previous) await previous.close().catch(() => {});
}

// Playwright is imported once per process and shared: concurrent first requests never race two
// module loads (a test runner's module mock could otherwise answer only one of them).
let playwrightModule = null;
function loadPlaywright() {
  playwrightModule ??= import("playwright").catch((error) => {
    playwrightModule = null;
    throw error;
  });
  return playwrightModule;
}

// One launcher per Playwright launch function, so repeated requests share lease identity.
const launchers = new WeakMap();
function stableLauncher(chromium) {
  const key = chromium.launch;
  if (!launchers.has(key)) launchers.set(key, (options) => chromium.launch(options));
  return launchers.get(key);
}

// ─── Error classification ───────────────────────────────────────────────────

const isMissingBrowserExecutable = (message) => {
  const lower = String(message || "").toLowerCase();
  return lower.includes("executable doesn't exist") || lower.includes("executablenotfound") ||
    lower.includes("playwright install") || (lower.includes("chromium") && lower.includes("download"));
};
const isBrowserClosedError = (message) => /(?:page|context|browser) has been closed|browser has been closed/i.test(message);
const isSelectorFailure = (error) =>
  error.name === "TimeoutError" || error.message.includes("waitForSelector") ||
  error.message.includes("actionability") || error.message.includes("interception");
const abortStatus = (signal) => {
  if (!signal?.aborted) return null;
  return signal.reason?.name === "TimeoutError" ? 504 : 499;
};

/** Per-request response wait, overridable with GEMINI_WEB_RESPONSE_TIMEOUT_MS (1s to 10min). */
export function resolveResponseTimeoutMs(env = process.env) {
  const parsed = Number(env.GEMINI_WEB_RESPONSE_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed >= 1000 && parsed <= 600_000 ? parsed : DEFAULT_RESPONSE_TIMEOUT_MS;
}

const SIGN_IN_PAGE = /^https?:\/\/accounts\.google\.com\//i;

const SESSION_EXPIRED_MESSAGE =
  "Gemini Web session expired or not signed in. Re-capture your __Secure-1PSID and __Secure-1PSIDTS cookies from gemini.google.com.";

function sessionExpired(status = 401) {
  return errorResponse(status, SESSION_EXPIRED_MESSAGE, { type: "authentication_error", code: "gemini_web_session_expired" });
}

function signedOut() {
  return errorResponse(
    401,
    "Gemini Web session is signed out: the stored cookie expired or was rotated. Export a fresh cookie from a signed-in browser and update the connection.",
    { type: "authentication_error", code: "gemini_web_signed_out" },
  );
}

/**
 * Click the composer, re-querying it when Gemini re-rendered it (it does so
 * shortly after load) and the first handle came back detached.
 */
async function focusComposer(page) {
  for (let attempt = 1; ; attempt++) {
    const composer = await page.waitForSelector(COMPOSER_SELECTOR, { timeout: 10_000 });
    try {
      await composer.click();
      return;
    } catch (error) {
      if (attempt >= 3 || !/not attached|detached/i.test(String(error?.message))) throw error;
      await page.waitForTimeout(500);
    }
  }
}

function quotaExceeded() {
  return errorResponse(
    429,
    "Gemini Web usage limit reached for this account. Wait for the limit to reset or use another connection.",
    { type: "rate_limit_error", code: "gemini_web_quota_exceeded" },
  );
}

// ─── Executor ───────────────────────────────────────────────────────────────

export class GeminiWebExecutor extends BaseExecutor {
  constructor() {
    super("gemini-web", { id: "gemini-web", baseUrl: GEMINI_WEB_URL });
  }

  /** Format-only pre-check: no network call and no browser launch. */
  async testConnection(credentials) {
    try {
      return parseCookies(resolveGeminiWebCookie(credentials)).length > 0;
    } catch {
      return false;
    }
  }

  async persistRotatedCookies(context, cookie, credentials, onCredentialsRefreshed, log) {
    if (!onCredentialsRefreshed) return;
    try {
      const merged = mergeRotatedGeminiCookies(cookie, await context.cookies());
      if (merged && merged !== cookie) await onCredentialsRefreshed({ ...credentials, apiKey: merged });
    } catch (error) {
      log?.warn?.("GEMINI-WEB", `Failed to persist rotated cookie: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  result(input, response) {
    return { response, url: GEMINI_WEB_URL, headers: {}, transformedBody: input.body };
  }

  async execute(input) {
    const { model, body, stream, credentials, signal, log, onCredentialsRefreshed } = input;
    const rawBody = body ?? {};

    if (isForcingToolChoice(rawBody.tool_choice)) {
      log?.warn?.("GEMINI-WEB", 'Rejected request: "tool_choice" is not supported by this provider');
      return this.result(input, errorResponse(
        400,
        'Model provider "gemini-web" cannot guarantee a forced tool call. Its tool support is prompt-emulated, so ' +
          '"tool_choice" values that require one ("required", "any", or a named function) cannot be honored. ' +
          'Use "auto" for best-effort tool calling.',
        { type: "invalid_request_error", code: GEMINI_WEB_UNSUPPORTED_CONTROL_CODE },
      ));
    }
    const wantsExtendedThinking = requestsThinkingBudget(rawBody.reasoning_effort);

    const cookie = resolveGeminiWebCookie(credentials);
    if (!cookie) {
      return this.result(input, errorResponse(401, "Missing Gemini cookies", { type: "authentication_error", code: "gemini_web_missing_cookies" }));
    }

    const messages = Array.isArray(rawBody.messages) ? rawBody.messages : [];
    const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages(rawBody, messages);
    const prompt = hasTools ? buildGeminiToolPrompt(effectiveMessages) : buildGeminiPrompt(messages);

    const hasUserMessage = messages.some((m) => m.role === "user" && Boolean(flattenTextContent(m.content)?.trim()));
    const lastUserContent = messages.filter((m) => m.role === "user").at(-1)?.content;
    const unreadableLastUserArray = hasTools && Array.isArray(lastUserContent) && !flattenTextContent(lastUserContent)?.trim();
    if (!prompt || !hasUserMessage || unreadableLastUserArray) {
      return this.result(input, errorResponse(400, "No user message found"));
    }

    const modelId = model || DEFAULT_MODEL_ID;
    const sender = createExecutorSender(this, input);
    let sent = null;
    // Every result after the prompt is submitted carries its quota ticket.
    const carry = (response) => {
      transferProviderAttemptDispatch(sent, response);
      return { ...this.result(input, response), attemptStartedAt: sender.attemptStartedAt };
    };
    let browser = null;
    let context = null;
    let abortBrowser = null;
    try {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");
      const { chromium } = await loadPlaywright();
      browser = await acquireBrowser(stableLauncher(chromium));
      abortBrowser = () => void context?.close().catch(() => {});
      signal?.addEventListener("abort", abortBrowser, { once: true });

      const proxy = resolveGeminiWebBrowserProxy(input.proxyOptions);
      const contextOptions = { userAgent: GEMINI_USER_AGENT, serviceWorkers: "block" };
      if (proxy) contextOptions.proxy = proxy;
      context = await browser.newContext(contextOptions);
      await context.addCookies(parseCookies(cookie).map(({ name, value }) => ({
        name, value, domain: ".google.com", path: "/", secure: true,
      })));

      const page = await context.newPage();
      // Chromium follows redirects before Playwright can act on response events.
      const redirectSession = await context.newCDPSession?.(page);
      if (redirectSession) {
        redirectSession.on("Fetch.requestPaused", async ({ request, requestId, responseStatusCode, responseHeaders }) => {
          const location = responseHeaders?.find(({ name }) => name.toLowerCase() === "location");
          const destination = location && URL.parse(location.value, request.url);
          if (responseStatusCode >= 300 && responseStatusCode < 400 && responseStatusCode !== 304 &&
              (!destination || destination.origin !== URL.parse(request.url)?.origin)) {
            await redirectSession.send("Fetch.fulfillRequest", { requestId, responseCode: 401, responseHeaders: [], body: "" }).catch(() => {});
          } else {
            await redirectSession.send("Fetch.continueResponse", { requestId }).catch(() => {});
          }
        });
        await redirectSession.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Response" }] });
      }
      let responseText = "";
      let captured = false;
      let upstreamStatus = null;
      let promptSubmitted = false;
      const seenResponseUrls = [];
      const responsePromise = new Promise((resolve) => {
        page.on("response", async (resp) => {
          try {
            const seen = new URL(resp.url());
            const bare = `${seen.origin}${seen.pathname}`;
            if (promptSubmitted && !seenResponseUrls.includes(bare) && seenResponseUrls.length < 20) seenResponseUrls.push(bare);
          } catch {
            // about:blank and data: URLs are not worth reporting.
          }
          if (!resp.url().includes("StreamGenerate") || captured) return;
          captured = true;
          const status = isFunction(resp.status) ? resp.status() : 200;
          if (status >= 400) {
            upstreamStatus = status;
          } else {
            try {
              responseText = parseStreamResponse(await resp.text());
            } catch {
              // An unreadable body falls through to the unparseable-response 502.
            }
          }
          resolve();
        });
      });

      const navigation = await page.goto(GEMINI_WEB_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");
      // A redirect to the Google sign-in page is an expired or missing session.
      if (AUTH_FAILURE_STATUSES.has(navigation?.status?.()) || SIGN_IN_PAGE.test(String(page.url?.() ?? ""))) return this.result(input, sessionExpired());
      await page.waitForSelector(COMPOSER_SELECTOR, { timeout: 10_000 });
      // A signed-out page still has a composer, so readiness alone proves nothing.
      if (await isGeminiSignedOut(page)) return this.result(input, signedOut());

      if (model) {
        const selection = await selectMode(page, MODEL_MODES[modelId]);
        if (selection.reason === "signed_out") return this.result(input, signedOut());
        if (!selection.confirmed) {
          log?.warn?.("GEMINI-WEB", `Rejected request: could not confirm Gemini UI mode for "${modelId}" (${selection.reason})`);
          return this.result(input, errorResponse(400, modeFailureMessage(modelId, selection.reason), {
            type: "invalid_request_error", code: GEMINI_WEB_UNSUPPORTED_CONTROL_CODE,
          }));
        }
      }
      if (wantsExtendedThinking) {
        const selection = await selectMode(page, EXTENDED_THINKING_MODE);
        if (selection.reason === "signed_out") return this.result(input, signedOut());
        if (!selection.confirmed) {
          log?.warn?.("GEMINI-WEB", `Rejected request: could not confirm Extended Thinking (${selection.reason})`);
          return this.result(input, errorResponse(400, modeFailureMessage("Extended Thinking", selection.reason), {
            type: "invalid_request_error", code: GEMINI_WEB_UNSUPPORTED_CONTROL_CODE,
          }));
        }
      }

      await focusComposer(page);
      // Only an answer newer than what the page already shows belongs to this prompt.
      const baseline = await snapshotGeminiDom(page);
      // insertText dispatches one input event, so an embedded newline cannot
      // trigger the composer's Enter-submits handler before the explicit Enter.
      await page.keyboard.insertText(prompt);
      await page.waitForTimeout(300);
      // Submitting the prompt is the one physical send; page setup is not.
      sent = await sender.sendRequest(GEMINI_WEB_URL, { signal }, input.proxyOptions, {
        transport: async () => {
          promptSubmitted = true;
          await page.keyboard.press("Enter");
          return {};
        },
      });

      const domText = await waitForGeminiAnswer(page, {
        baseline,
        network: responsePromise,
        isDecided: () => Boolean(responseText) || upstreamStatus !== null,
        timeoutMs: resolveResponseTimeoutMs(),
      });
      // Fixed here: a StreamGenerate read still in flight must not change the answer later.
      const answerText = responseText || domText;
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Request aborted");

      if (!answerText) {
        if (upstreamStatus === 401 || upstreamStatus === 403) return carry(sessionExpired(upstreamStatus));
        if (upstreamStatus === 429) return carry(quotaExceeded());
        if (SIGN_IN_PAGE.test(String(page.url?.() ?? ""))) return carry(sessionExpired());
        return carry(new Response(JSON.stringify({
          error: upstreamStatus ? `Gemini answered HTTP ${upstreamStatus}` : "No response from Gemini",
          code: captured ? "gemini_web_unparseable_response" : "gemini_web_no_response",
          seen_response_urls: seenResponseUrls,
        }), { status: 502, headers: { "Content-Type": "application/json" } }));
      }

      await this.persistRotatedCookies(context, cookie, credentials, onCredentialsRefreshed, log);

      if (hasTools) {
        const cid = `chatcmpl-gwe-${crypto.randomUUID().slice(0, 12)}`;
        const buffered = new Response(JSON.stringify(chatCompletion(answerText, modelId)), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
        return carry(await buildToolModeResponse(buffered, requestedTools, Boolean(stream), {
          cid, created: Math.floor(Date.now() / 1000), model: modelId, idSeed: "gwe",
        }));
      }
      if (stream) return carry(sseResponse(modelId, answerText));
      return carry(new Response(JSON.stringify(chatCompletion(answerText, modelId)), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    } catch (error) {
      if (isQuotaDispatchUnavailable(error)) throw error;
      const message = error instanceof Error ? error.message : "Unknown error";
      if (isMissingBrowserExecutable(message)) {
        return carry(new Response(JSON.stringify({
          error: "Gemini Web requires the Playwright Chromium browser, which is not installed. Run `npx playwright install chromium` on the host.",
        }), { status: 503, headers: { "Content-Type": "application/json" } }));
      }
      const aborted = abortStatus(signal);
      if (aborted || isBrowserClosedError(message)) {
        return carry(new Response(JSON.stringify({ error: sanitizeErrorMessage(message) }), {
          status: aborted ?? 502, headers: { "Content-Type": "application/json" },
        }));
      }
      // A selector failure is terminal: the DOM did not match, so retrying cannot help.
      const status = error instanceof Error && isSelectorFailure(error) ? 400 : 500;
      return carry(new Response(JSON.stringify({ error: sanitizeErrorMessage(message) }), {
        status, headers: { "Content-Type": "application/json" },
      }));
    } finally {
      if (abortBrowser) signal?.removeEventListener("abort", abortBrowser);
      try {
        await context?.close();
      } catch {
        // A close error cannot change the response.
      }
      if (browser) await releaseBrowser(browser);
    }
  }
}

// ─── Connection validation ──────────────────────────────────────────────────

const AUTH_FAILURE_STATUSES = new Set([401, 403]);

/**
 * Read-only session check: GET gemini.google.com/app with the pasted cookies. A
 * signed-in page carries the `SNlM0e` token; a signed-out landing page answers
 * 200 to any junk cookie, so a bare 200 is not enough. Redirects are not
 * followed: a cross-origin redirect is a dead session. No conversation is
 * created. Same shape as the specialty validators in providerProbe.js.
 */
export async function validateGeminiWebSession({ apiKey, fetcher = fetch }) {
  const raw = String(apiKey || "").trim();
  if (!raw) return { valid: false, status: null, error: "Paste your __Secure-1PSID cookie from gemini.google.com" };
  const cookie = normalizeGeminiValidationCookie(raw);
  if (!cookie) {
    return { valid: false, status: null, error: "No __Secure-1PSID cookie found - paste it from gemini.google.com DevTools > Cookies" };
  }
  let response;
  try {
    response = await guardedProbeFetch(GEMINI_WEB_URL, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        Cookie: cookie,
        Origin: GEMINI_WEB_ORIGIN,
        Referer: `${GEMINI_WEB_ORIGIN}/`,
        "User-Agent": GEMINI_USER_AGENT,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    }, getProviderValidationGuard(), fetcher);
  } catch (error) {
    if (error instanceof OutboundUrlGuardError) return { valid: false, status: null, blocked: true, error: error.message };
    return { valid: false, status: null, unavailable: true, error: "Provider unavailable - network request failed" };
  }

  const { status } = response;
  if (AUTH_FAILURE_STATUSES.has(status)) {
    return { valid: false, status, error: "Invalid or expired __Secure-1PSID cookie - re-capture it from gemini.google.com" };
  }
  if (status === 429) return { valid: false, status, unavailable: true, error: "Gemini is rate limiting this session - try again later" };
  if (status >= 300 && status < 400) {
    const location = response.headers.get("location") ?? "";
    const destination = location && URL.parse(location, GEMINI_WEB_URL);
    if (destination?.origin === GEMINI_WEB_ORIGIN) return { valid: true, status };
    return { valid: false, status, error: "Gemini session redirected - re-capture __Secure-1PSID from gemini.google.com" };
  }
  if (status === 200) {
    const html = await response.text().catch(() => "");
    if (/"SNlM0e"\s*:\s*"[^"]+"/.test(html)) return { valid: true, status };
    return { valid: false, status, error: "Not signed in - gemini.google.com did not accept the cookie. Re-capture __Secure-1PSID" };
  }
  if (status >= 500) return { valid: false, status, unavailable: true, error: "Provider unavailable - try again later" };
  return { valid: false, status, error: `Gemini validation failed (HTTP ${status})` };
}

export default GeminiWebExecutor;
