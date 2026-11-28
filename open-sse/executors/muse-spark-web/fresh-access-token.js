// Ported from OmniRoute 4265bb2ad5477450a07d3a43ea33a62c6c874878 (MIT).
// DurinDoor #2034: the browser leg uses the selected connection's egress route.
import { createHash } from "node:crypto";
import { acquireBrowserContext, getBrowserPoolStatus, openPage, releaseBrowserContext } from "../../services/browserPool.js";
import { sanitizeErrorMessageWithSecrets } from "../../utils/error.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import {
  META_AI_ORIGIN,
  MuseBrowserRefusal,
  PROXY_CAPABLE_ENGINES,
  resolveMetaBrowserRoute,
  within,
  withKeyLock,
} from "./browser-route.js";
const META_AI_GRAPHQL_API = "https://www.meta.ai/api/graphql";
const META_AI_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const META_AI_HEISENBERG_DOC_ID = "954e9b193487fa4af750af87906e4313";
const ACCESS_TOKEN_RE = /accessToken[\\"]+:\s*[\\"]+ecto1:([A-Za-z0-9_-]+)[\\"]+/;
const META_TOKEN_CACHE = /* @__PURE__ */ new Map();
const META_TOKEN_TTL_MS = 4 * 60 * 1e3;
/** Stage bounds. The overall bound covers queueing, bootstrap, launch, page, navigation and body. */
export const MUSE_REFRESH_LIMITS = Object.freeze({
  overallMs: 45e3,
  launchMs: 20e3,
  pageMs: 10e3,
  navigationMs: 3e4,
  bodyMs: 10e3,
  maxHtmlChars: 8 * 1024 * 1024
});

/**
 * Refresh the Meta AI access token for one stored credential.
 *
 * The egress route is resolved first from `proxyOptions` (see `resolveMetaBrowserRoute`). A relay,
 * a strict route with no proxy, or a proxy the browser cannot apply is refused before the bootstrap
 * fetch, the cookie placement or any page work. The resolved proxy URL is passed to the browser pool
 * as `proxyUrl`, so the context that receives `ecto_1_sess` uses the same route as the bootstrap.
 * A proxied refresh on an engine outside `PROXY_CAPABLE_ENGINES` is refused before the cookie is
 * placed. The token cache and the pool key are both keyed by connection, cookie and route, so a
 * rotated cookie or a changed proxy never reuses an earlier token or context. Callers with the same
 * key are serialized; each stage is bounded and an abort closes any late page or context.
 *
 * Contracts here are proved with mocked pools and browsers. Live proxy and browser behaviour is
 * unverified.
 *
 * @param {string} cookieHeader - `ecto_1_sess=<value>` header for the selected connection
 * @param {AbortSignal|undefined} signal - caller cancellation
 * @param {string} [connectionId]
 * @param {object|null} [proxyOptions] - the selected connection's proxy options
 * @returns {Promise<{ok: true, token: string, updatedCookie?: string} | {ok: false, status?: number, error: string, refused?: boolean}>}
 */
async function fetchFreshAccessToken(cookieHeader, signal, connectionId = "", proxyOptions = null) {
  if (signal?.aborted) return { ok: false, refused: true, error: "Meta AI token refresh aborted before any work" };
  let route;
  try {
    route = resolveMetaBrowserRoute(proxyOptions);
  } catch (err) {
    return { ok: false, status: 503, refused: true, error: err.message };
  }
  const cacheKey = createHash("sha256").update(`${connectionId}\0${cookieHeader}\0${route.routeId}`).digest("hex").slice(0, 16);
  const fromCache = () => {
    for (const [key, entry] of META_TOKEN_CACHE) if (entry.expiresAt <= Date.now()) META_TOKEN_CACHE.delete(key);
    const cached = META_TOKEN_CACHE.get(cacheKey);
    return cached ? { ok: true, token: cached.token, updatedCookie: cached.updatedCookie } : null;
  };
  const hit = fromCache();
  if (hit) return hit;

  const overall = new AbortController();
  const onCallerAbort = () => overall.abort(signal.reason);
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  const overallTimer = setTimeout(() => overall.abort(new MuseBrowserRefusal("Meta AI token refresh deadline exceeded")), MUSE_REFRESH_LIMITS.overallMs);
  const secrets = [cookieHeader, cookieHeader.match(/(?:^|;\s*)ecto_1_sess=([^;]+)/)?.[1], route.proxyUrl];
  try {
    return await withKeyLock(cacheKey, overall.signal, (cleanups) => {
      const again = fromCache();
      if (again) return again;
      return refreshUncached({ cookieHeader, cacheKey, route, proxyOptions, signal: overall.signal, cleanups });
    }, MUSE_REFRESH_LIMITS.overallMs);
  } catch (err) {
    const refused = err instanceof MuseBrowserRefusal;
    return {
      ok: false,
      ...(refused ? { status: 503, refused: true } : {}),
      error: `fetchFreshAccessToken failed: ${sanitizeErrorMessageWithSecrets(err instanceof Error ? err.message : String(err), secrets)}`
    };
  } finally {
    clearTimeout(overallTimer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

async function refreshUncached({ cookieHeader, cacheKey, route, proxyOptions, signal, cleanups }) {
  const heisenbergResponse = await proxyAwareFetch(META_AI_GRAPHQL_API, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: cookieHeader,
      "User-Agent": META_AI_USER_AGENT,
      Origin: "https://meta.ai"
    },
    body: JSON.stringify({ doc_id: META_AI_HEISENBERG_DOC_ID, variables: {} }),
    signal,
    directFetch: (url, init) => globalThis.fetch(url, init)
  }, proxyOptions);
  if (!heisenbergResponse.ok) return { ok: false, status: heisenbergResponse.status >= 300 && heisenbergResponse.status < 400 ? 401 : heisenbergResponse.status, error: "Meta AI session refresh failed" };
  let updatedCookie;
  const setCookie = heisenbergResponse.headers.get("set-cookie") || "";
  const sessMatch = setCookie.match(/ecto_1_sess=([^;]+)/);
  if (sessMatch && sessMatch[1] && sessMatch[1] !== "") {
    updatedCookie = cookieHeader.replace(/ecto_1_sess=[^;]+/, `ecto_1_sess=${sessMatch[1]}`);
  }
  const effectiveCookie = updatedCookie || cookieHeader;
  const seams = _metaTokenBrowserPoolForTesting;
  const acquire = seams?.acquire || acquireBrowserContext;
  const release = seams?.release || releaseBrowserContext;
  const open = seams?.openPage || openPage;
  const poolKey = `meta-ai-token:${cacheKey}`;
  const releaseQuietly = () => Promise.resolve().then(() => release(poolKey)).catch(() => {});
  const stage = (promise, ms, label, onLate) => within(promise, { signal, ms, label, cleanups, onLate });

  const pooled = await stage(Promise.resolve().then(() => acquire(poolKey, {
    cookieDomain: "www.meta.ai",
    blockServiceWorkers: true,
    warmupUrl: null,
    userAgent: META_AI_USER_AGENT,
    ...(route.proxyUrl ? { proxyUrl: route.proxyUrl } : {})
  })), MUSE_REFRESH_LIMITS.launchMs, "browser launch", releaseQuietly);
  let page = null;
  try {
    if (route.proxyUrl) {
      // A seam without `engine` stands in for the plain Playwright Chromium adapter.
      const engine = seams ? (seams.engine ? seams.engine(pooled) : "chromium") : getBrowserPoolStatus().engine;
      if (!PROXY_CAPABLE_ENGINES.has(engine)) {
        throw new MuseBrowserRefusal("Meta AI browser refresh: this browser engine is not verified to apply a context proxy");
      }
    }
    page = await stage(Promise.resolve().then(() => open(pooled)), MUSE_REFRESH_LIMITS.pageMs, "page open", (late) => late?.close?.());
    await stage(pooled.context.addCookies([{ name: "ecto_1_sess", value: effectiveCookie.match(/(?:^|;\s*)ecto_1_sess=([^;]+)/)?.[1] || "", domain: "www.meta.ai", path: "/", secure: true }]), MUSE_REFRESH_LIMITS.pageMs, "cookie placement");
    await stage(Promise.resolve(page.route("**/*", (routed) => {
      const url = new URL(routed.request().url());
      return url.origin === META_AI_ORIGIN ? routed.continue() : routed.abort();
    })), MUSE_REFRESH_LIMITS.pageMs, "request routing");
    await stage(Promise.resolve(page.routeWebSocket("**/*", (socket) => socket.close())), MUSE_REFRESH_LIMITS.pageMs, "socket routing");
    await stage(Promise.resolve(page.goto("https://www.meta.ai/", {
      waitUntil: "networkidle",
      timeout: MUSE_REFRESH_LIMITS.navigationMs
    })), MUSE_REFRESH_LIMITS.navigationMs, "navigation");
    if (new URL(page.url()).origin !== META_AI_ORIGIN) return { ok: false, status: 401, error: "Meta AI session expired" };
    const html = await stage(Promise.resolve(page.content()), MUSE_REFRESH_LIMITS.bodyMs, "page body");
    if (typeof html !== "string" || html.length > MUSE_REFRESH_LIMITS.maxHtmlChars) {
      throw new MuseBrowserRefusal("Meta AI page body exceeded the refresh limit");
    }
    const match = html.match(ACCESS_TOKEN_RE);
    if (!match) {
      return { ok: false, status: 401, error: "Meta AI session expired; re-import your ecto_1_sess cookie" };
    }
    const token = `ecto1:${match[1]}`;
    META_TOKEN_CACHE.set(cacheKey, { token, updatedCookie, expiresAt: Date.now() + META_TOKEN_TTL_MS });
    return { ok: true, token, updatedCookie };
  } finally {
    await Promise.resolve().then(() => page?.close?.()).catch(() => {});
    await releaseQuietly();
  }
}
let _fetchFreshAccessTokenOverride;
function __setMuseSparkFreshTokenFetcherForTesting(fn) {
  _fetchFreshAccessTokenOverride = fn;
}
let _metaTokenBrowserPoolForTesting;
function __setMuseSparkBrowserPoolForTesting(seams) {
  _metaTokenBrowserPoolForTesting = seams;
}
function __resetMuseSparkTokenCacheForTesting() {
  META_TOKEN_CACHE.clear();
}
function __fetchFreshAccessTokenForTesting(cookieHeader, signal, connectionId, proxyOptions) {
  return fetchFreshAccessToken(cookieHeader, signal, connectionId, proxyOptions);
}
const _fetchFreshAccessTokenDispatch = (cookieHeader, signal, connectionId, proxyOptions) => _fetchFreshAccessTokenOverride ? _fetchFreshAccessTokenOverride(cookieHeader, signal, connectionId, proxyOptions) : fetchFreshAccessToken(cookieHeader, signal, connectionId, proxyOptions);
export {
  __fetchFreshAccessTokenForTesting,
  __resetMuseSparkTokenCacheForTesting,
  __setMuseSparkBrowserPoolForTesting,
  __setMuseSparkFreshTokenFetcherForTesting,
  _fetchFreshAccessTokenDispatch
};
