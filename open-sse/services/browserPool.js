/**
 * browserPool.js — Shared stealth browser pool for web-cookie providers.
 *
 * The DuckDuckGo VQD challenge and Claude web's Cloudflare Turnstile both
 * validate values that only a real browser can produce (DOM layout
 * measurements like offsetWidth/Height, getBoundingClientRect,
 * getComputedStyle, iframe contentWindow probes). Plain Node fetch + a
 * VM-stubs solver structurally runs the JS but cannot match those values,
 * so the server rejects the request.
 *
 * This pool keeps one Chromium instance warm and serves "browser contexts"
 * (one per caller-defined isolation key) on demand. Each context owns one or more pages; the
 * caller is expected to be polite (one page per request, close on done).
 *
 * The pool prefers `cloakbrowser` (npm) when available — its binary-level
 * fingerprint patches (--fingerprint-timezone, --fingerprint-locale, and
 * dozens more) are the only thing that gets past DuckDuckGo's anti-bot
 * in this environment. Falls back to plain `playwright` if cloakbrowser
 * is not installed; the fallback works for Claude web (which only needs
 * valid cookies) but not for DDG's VQD challenge.
 *
 * Opt-in: pool only launches Chromium when an executor explicitly asks
 * for a context, so users who never use the browser-backed path pay zero
 * startup cost. Set DURINDOOR_BROWSER_POOL=off to fully disable.
 */

import { Buffer } from "node:buffer";

import { connectObscuraBrowser } from "./obscura.js";

// Lightweight, cumulative browser-pool telemetry. Counters are incremented at
// lifecycle points and surfaced via getBrowserPoolMetrics().

function createBrowserPoolMetrics() {
  return {
    browserLaunches: 0,
    browserLaunchFailures: 0,
    contextsCreated: 0,
    contextsReused: 0,
    contextsEvicted: 0,
    contextsReleased: 0,
    contextCreateFailures: 0,
    shutdowns: 0,
    lastShutdownReason: null,
  };
}

const POOL_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const CONTEXT_TTL_MS = 10 * 60 * 1000; // 10 min — evict stale contexts
const EVICT_INTERVAL_MS = 60 * 1000; // check every 60s
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const state = {
  browser: null,
  engine: null,
  headedBrowser: null,
  contexts: new Map(),
  pendingContexts: new Map(),
  launching: null,
  headedLaunching: null,
  generation: 0,
  lastActivity: 0,
  idleTimer: null,
  evictTimer: null,
  cloakLaunch: null,
  cloakLaunchResolved: false,
  metrics: createBrowserPoolMetrics(),
};

function getCloakbrowserModuleId() {
  // Keep this computed: cloakbrowser is an optional runtime enhancer, and a literal
  // dynamic import with the package name makes Turbopack resolve it during route compilation.
  return ["cloak", "browser"].join("");
}

async function resolveCloakLaunch() {
  if (state.cloakLaunchResolved) return state.cloakLaunch;
  state.cloakLaunchResolved = true;
  try {
    const mod = await import(
      /* webpackIgnore: true */
      getCloakbrowserModuleId()
    );

    state.cloakLaunch = mod.launch ?? null;
  } catch {
    state.cloakLaunch = null;
  }
  return state.cloakLaunch;
}

function isPoolEnabled() {
  const flag = process.env.DURINDOOR_BROWSER_POOL;
  if (flag === undefined) return true;
  return flag !== "off" && flag !== "0" && flag !== "false";
}

function resetIdleTimer() {
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    void shutdownPool("idle-timeout");
  }, POOL_IDLE_TIMEOUT_MS);
  state.idleTimer.unref?.();
}

function evictStaleContexts() {
  const now = Date.now();
  for (const [key, pooled] of state.contexts) {
    if (now - pooled.lastUsed > CONTEXT_TTL_MS) {
      console.log(
        "[BrowserPool] Evicted stale context",
        "(idle",
        ((now - pooled.lastUsed) / 1000).toFixed(0) + "s)"
      );
      state.contexts.delete(key);
      state.metrics.contextsEvicted++;
      pooled.context.close().catch(() => {});
    }
  }
  // OmniRoute #12179: also evict pendingContexts entries that never resolved, so a hung
  // launch cannot pin the map (and the pool) open forever.
  const PENDING_TTL_MS = 5 * 60 * 1000;
  for (const [key, pending] of state.pendingContexts) {
    if (now - pending.createdAt > PENDING_TTL_MS) {
      state.pendingContexts.delete(key);
      state.metrics.contextsEvicted++;
    }
  }
  if (
    state.contexts.size === 0 &&
    state.pendingContexts.size === 0 &&
    !state.launching &&
    !state.headedLaunching
  ) {
    void shutdownPool("all-contexts-evicted");
  }
}

function startEvictTimer() {
  if (state.evictTimer) clearInterval(state.evictTimer);
  state.evictTimer = setInterval(() => evictStaleContexts(), EVICT_INTERVAL_MS);
  state.evictTimer.unref?.();
}

/**
 * Convert a connection proxy URL (http://, https://, socks5://, with optional
 * credentials) into Playwright's launch/context proxy option.
 * @param {string|null|undefined} proxyUrl
 * @returns {{server: string, username?: string, password?: string}|undefined}
 */
export function resolvePlaywrightProxy(proxyUrl) {
  if (!proxyUrl) return undefined;
  let url;
  try {
    url = new URL(proxyUrl);
  } catch {
    console.warn("[BrowserPool] Ignoring an invalid proxy URL");
    return undefined;
  }
  const scheme = url.protocol.startsWith("socks") ? "socks5" : url.protocol.replace(/:$/, "");
  const proxy = { server: `${scheme}://${url.hostname}:${url.port}` };
  if (url.username) {
    proxy.username = decodeURIComponent(url.username);
    proxy.password = decodeURIComponent(url.password || "");
  }
  return proxy;
}

function currentBrowser(headless) {
  const browser = headless ? state.browser : state.headedBrowser;
  if (browser?.isConnected()) return browser;
  if (browser) setCurrentBrowser(headless, null);
  return null;
}

function setCurrentBrowser(headless, browser) {
  if (headless) state.browser = browser;
  else state.headedBrowser = browser;
}

function currentBrowserLaunch(headless) {
  return headless ? state.launching : state.headedLaunching;
}

function setBrowserLaunch(headless, launch) {
  if (headless) state.launching = launch;
  else state.headedLaunching = launch;
}

function clearBrowserLaunch(headless, launch) {
  if (currentBrowserLaunch(headless) === launch) setBrowserLaunch(headless, null);
}

export function resolvePlainBrowserLaunchOptions(options) {
  const headless = options.headless !== false;
  const launchOptions = {
    headless,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      ...(!headless ? ["--window-position=-32000,-32000"] : []),
    ],
  };
  // A configured system Chrome serves both modes; Playwright's Chromium is the default.
  if (options.executablePath) launchOptions.executablePath = options.executablePath;
  return launchOptions;
}

export class BrowserUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "BrowserUnavailableError";
  }
}

const MISSING_BROWSER_RE = /Executable doesn't exist|playwright install|Cannot find module 'playwright'|Cannot find package 'playwright'/i;
const MISSING_DISPLAY_RE = /Missing X server|\$DISPLAY|headed browser without having a XServer/i;
let chromiumInstallAttempt = null;

// Opt-in first-use install (DURINDOOR_BROWSER_AUTO_INSTALL=1): downloads
// Playwright's Chromium into its cache once per process.
function installPlaywrightChromium() {
  chromiumInstallAttempt ??= (async () => {
    const { execFile } = await import("node:child_process");
    const { createRequire } = await import("node:module");
    const { dirname, join } = await import("node:path");
    const pkg = createRequire(import.meta.url).resolve("playwright/package.json");
    const cli = join(dirname(pkg), "cli.js");
    await new Promise((resolve, reject) => {
      execFile(process.execPath, [cli, "install", "chromium"], { timeout: 10 * 60_000 }, (err) =>
        err ? reject(err) : resolve()
      );
    });
  })();
  return chromiumInstallAttempt;
}

function autoInstallEnabled() {
  return /^(1|true|yes|on)$/i.test(process.env.DURINDOOR_BROWSER_AUTO_INSTALL || "");
}

/**
 * Launch Playwright's Chromium (or the configured system Chrome). A missing
 * package, browser binary or display becomes a BrowserUnavailableError with
 * the fix spelled out, so callers can fall back to another transport.
 */
async function launchPlainChromium(options) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    throw new BrowserUnavailableError(
      "The playwright package is not installed; run `npm install playwright`.",
      { cause: err }
    );
  }
  const launchOptions = resolvePlainBrowserLaunchOptions(options);
  try {
    return await chromium.launch(launchOptions);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (MISSING_BROWSER_RE.test(message) && autoInstallEnabled() && !launchOptions.executablePath) {
      await installPlaywrightChromium();
      return chromium.launch(launchOptions);
    }
    if (MISSING_BROWSER_RE.test(message)) {
      throw new BrowserUnavailableError(
        "Chromium is not installed. Run `npx playwright install chromium`, set " +
          "CHATGPT_WEB_CHROME_PATH to a Chrome binary, or set DURINDOOR_BROWSER_AUTO_INSTALL=1.",
        { cause: err }
      );
    }
    if (MISSING_DISPLAY_RE.test(message)) {
      throw new BrowserUnavailableError(
        "A headed browser needs a display. Run under Xvfb (xvfb-run) or set " +
          "DURINDOOR_CHATGPT_WEB_HEADLESS=1.",
        { cause: err }
      );
    }
    throw err;
  }
}

async function launchBrowserInstance(options, headless) {
  // A headed browser must be a real windowed Chromium, so the engine
  // preference below applies to the headless path only.
  if (!headless) return launchPlainChromium(options);

  // OmniRoute #12274: prefer Obscura (lightweight, browser-grade CDP) over a full
  // Chromium; fall back to cloakbrowser, then plain Chromium. Obscura's
  // lifecycle (one shared `obscura serve` per process) lives in ./obscura.js,
  // so executors like cloudflare-playground reuse the same server.
  const obscura = await connectObscuraBrowser();
  if (obscura) {
    state.engine = "obscura";
    return obscura.browser;
  }

  const cloakLaunch = await resolveCloakLaunch();
  if (cloakLaunch) {
    state.engine = "cloakbrowser";
    return cloakLaunch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }

  // Fallback: plain Playwright. Works for Claude web (cookie-only auth) but
  // DDG's VQD challenge will detect this Chromium build.
  state.engine = "chromium";
  return launchPlainChromium(options);
}

async function launchBrowser(options) {
  const headless = options.headless !== false;
  const existing = currentBrowser(headless);
  if (existing) return existing;
  const pending = currentBrowserLaunch(headless);
  if (pending) return pending;
  const generation = state.generation;
  const launch = (async () => {
    const browser = await launchBrowserInstance(options, headless);

    if (state.generation !== generation) {
      await browser.close().catch(() => {});
      throw new Error("Pool shut down during browser launch");
    }
    setCurrentBrowser(headless, browser);
    state.metrics.browserLaunches++;
    return browser;
  })();
  setBrowserLaunch(headless, launch);
  try {
    const browser = await launch;
    clearBrowserLaunch(headless, launch);
    return browser;
  } catch (err) {
    clearBrowserLaunch(headless, launch);
    state.metrics.browserLaunchFailures++;
    throw err;
  }
}

function parseCookieString(raw, domain) {
  return raw
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return null;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name || !value) return null;
      return {
        name,
        value,
        domain: domain.startsWith(".") ? domain : `.${domain}`,
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      };
    })
    .filter(Boolean);
}

// Clear a key from the pending-creation map once its promise settles, counting
// failures. Kept as a leaf helper so acquireBrowserContext stays under the
// function-length ceiling (OmniRoute #3368 PR7 metrics).
function settlePendingContext(key, failed) {
  if (failed) state.metrics.contextCreateFailures++;
  state.pendingContexts.delete(key);
}

// Seed a freshly created context with whatever session material the caller
// supplied — cookies for cookie-auth providers, localStorage for the ones (zai-web)
// whose session is a Bearer JWT the page reads at boot. Kept as a leaf helper so
// the creation closure stays under the complexity ceiling.
async function seedContextSession(context, options) {
  if (options.cookieString) {
    const cookies = parseCookieString(options.cookieString, options.cookieDomain);
    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }
  }

  if (!options.localStorage || Object.keys(options.localStorage).length === 0) return;

  const origin = new URL(options.localStorageOrigin || options.warmupUrl || "").origin;
  await context.addInitScript(
    ({ expectedOrigin, entries }) => {
      if (window.location.origin !== expectedOrigin) return;
      for (const [name, value] of entries) {
        window.localStorage.setItem(name, value);
      }
    },
    {
      expectedOrigin: origin,
      entries: Object.entries(options.localStorage),
    }
  );
}

async function createWarmupPage(context, warmupUrl) {
  if (!warmupUrl) return null;
  let page = null;
  try {
    page = await context.newPage();
    await page.goto(warmupUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Give the warmup a moment for upstream status/auth/country requests. The
    // first chat request otherwise pays this cost on the hot path.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return page;
  } catch {
    await page?.close().catch(() => {});
    return null;
  }
}

export async function acquireBrowserContext(key, options) {
  if (!isPoolEnabled()) {
    throw new BrowserUnavailableError(
      "browserPool: DURINDOOR_BROWSER_POOL=off — context requested but pool is disabled"
    );
  }
  const headless = options.headless !== false;
  const poolKey = `${headless ? "headless" : "headed"}:${key}`;
  const existing = state.contexts.get(poolKey);
  if (existing) {
    existing.lastUsed = Date.now();
    state.lastActivity = Date.now();
    state.metrics.contextsReused++;
    resetIdleTimer();
    return existing;
  }

  // Dedup concurrent creations for the same key
  const pending = state.pendingContexts.get(poolKey);
  if (pending) return pending.promise;

  const createPromise = (async () => {
    const [browser, proxy] = await Promise.all([
      launchBrowser(options),
      Promise.resolve(resolvePlaywrightProxy(options.proxyUrl)),
    ]);
    const isStealth = headless && (state.engine === "obscura" || state.cloakLaunch !== null);
    const contextOptions = {
      userAgent: options.userAgent || DEFAULT_USER_AGENT,
      locale: options.locale || "en-US",
      timezoneId: options.timezone || "America/New_York",
      viewport: { width: 1280, height: 800 },
    };
    if (options.storageState) contextOptions.storageState = options.storageState;
    if (proxy) contextOptions.proxy = proxy;
    const context = await browser.newContext(contextOptions);

    await seedContextSession(context, options);
    const warmupPage = await createWarmupPage(context, options.warmupUrl);

    // Guard: if shutdownPool() ran while we were creating this context,
    // the browser we obtained is now closed. Close our temp context and
    // throw so the caller knows to retry.
    if (currentBrowser(headless) !== browser) {
      await context.close().catch(() => {});
      if (warmupPage) {
        await warmupPage.close().catch(() => {});
      }
      throw new Error("Pool shut down during context creation");
    }

    const pooled = {
      id: poolKey,
      context,
      warmupPage,
      lastUsed: Date.now(),
      isStealth,
    };
    state.contexts.set(poolKey, pooled);
    state.metrics.contextsCreated++;
    state.lastActivity = Date.now();
    resetIdleTimer();
    startEvictTimer();
    return pooled;
  })();

  state.pendingContexts.set(poolKey, { promise: createPromise, createdAt: Date.now() });
  createPromise
    .then(() => settlePendingContext(poolKey, false))
    .catch(() => settlePendingContext(poolKey, true));

  return createPromise;
}

export async function openPage(pooled) {
  return pooled.context.newPage();
}

export async function releaseBrowserContext(key) {
  const resolvedKey = [key, `headless:${key}`, `headed:${key}`].find((candidate) =>
    state.contexts.has(candidate)
  );
  if (!resolvedKey) return;
  const pooled = state.contexts.get(resolvedKey);
  if (!pooled) return;
  state.contexts.delete(resolvedKey);
  state.metrics.contextsReleased++;
  try {
    await pooled.context.close();
  } catch {
    /* ignore */
  }
  if (state.contexts.size === 0) {
    await shutdownPool("last-context-closed");
  }
}

export async function shutdownPool(reason) {
  state.generation++;
  state.metrics.shutdowns++;
  state.metrics.lastShutdownReason = reason;
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
  if (state.evictTimer) {
    clearInterval(state.evictTimer);
    state.evictTimer = null;
  }
  state.pendingContexts.clear();
  for (const [key, pooled] of state.contexts) {
    try {
      await pooled.context.close();
    } catch {
      /* ignore */
    }
    state.contexts.delete(key);
  }
  if (state.browser) {
    try {
      await state.browser.close();
    } catch {
      /* ignore */
    }
    state.browser = null;
  }
  if (state.headedBrowser) {
    try {
      await state.headedBrowser.close();
    } catch {
      /* ignore */
    }
    state.headedBrowser = null;
  }
  state.launching = null;
  state.headedLaunching = null;
  // OmniRoute #12274: the shared Obscura server is owned by ./obscura.js and reused by
  // executors (cloudflare-playground), so closing the pool's CDP connection is
  // enough — never kill the server here.
  state.engine = null;
  state.lastActivity = Date.now();
  // Avoid unused-parameter lint: log reason via debug if anyone hooks
  // process.on('exit') and prints state.
  void reason;
}

export function getBrowserPoolStatus() {
  return {
    enabled: isPoolEnabled(),
    contexts: state.contexts.size,
    browserRunning: state.browser !== null || state.headedBrowser !== null,
    engine: state.engine,
    stealthAvailable: state.engine === "obscura" || state.cloakLaunch !== null,
    lastActivityAgoMs: state.lastActivity === 0 ? -1 : Date.now() - state.lastActivity,
  };
}

/**
 * OmniRoute #3368 PR7 — browser-pool observability. Returns live status plus cumulative
 * lifecycle telemetry (launches, context create/reuse/evict/release counts,
 * failures, shutdowns). Surfaced via the dashboard browser-pool status.
 */
export function getBrowserPoolMetrics() {
  return { status: getBrowserPoolStatus(), metrics: { ...state.metrics } };
}

/** Test-only: reset cumulative metrics so assertions start from a clean slate. */
export function __resetBrowserPoolMetricsForTest() {
  state.metrics = createBrowserPoolMetrics();
}

export async function readPageResponseBody(response) {
  const headers = {};
  for (const [name, value] of Object.entries(response.headers())) {
    headers[name] = value;
  }
  const body = await response.body();
  return { status: response.status(), headers, body: Buffer.from(body) };
}
