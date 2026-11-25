// Ported from OmniRoute 4265bb2ad5477450a07d3a43ea33a62c6c874878 (MIT).
import { createHash } from "node:crypto";
import { acquireBrowserContext, openPage, releaseBrowserContext } from "../../services/browserPool.js";
import { sanitizeErrorMessage } from "../../utils/error.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
const META_AI_GRAPHQL_API = "https://www.meta.ai/api/graphql";
const META_AI_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const META_AI_HEISENBERG_DOC_ID = "954e9b193487fa4af750af87906e4313";
const ACCESS_TOKEN_RE = /accessToken[\\"]+:\s*[\\"]+ecto1:([A-Za-z0-9_-]+)[\\"]+/;
const META_TOKEN_CACHE = /* @__PURE__ */ new Map();
const META_TOKEN_TTL_MS = 4 * 60 * 1e3;
async function fetchFreshAccessToken(cookieHeader, signal, connectionId = "", proxyOptions = null) {
  const cacheKey = createHash("sha256").update(`${connectionId}\0${cookieHeader}`).digest("hex").slice(0, 16);
  for (const [key, entry] of META_TOKEN_CACHE) if (entry.expiresAt <= Date.now()) META_TOKEN_CACHE.delete(key);
  const cached = META_TOKEN_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, token: cached.token, updatedCookie: cached.updatedCookie };
  }
  try {
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
      signal: signal ?? void 0,
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
    const poolKey = `meta-ai-token:${cacheKey}`;
    const acquire = _metaTokenBrowserPoolForTesting?.acquire || acquireBrowserContext;
    const pooled = await acquire(poolKey, {
      cookieDomain: "www.meta.ai",
      blockServiceWorkers: true,
      warmupUrl: null,
      userAgent: META_AI_USER_AGENT
    });
    let page = null;
    const release = _metaTokenBrowserPoolForTesting?.release || releaseBrowserContext;
    try {
      const open = _metaTokenBrowserPoolForTesting?.openPage || openPage;
      page = await open(pooled);
      await pooled.context.addCookies([{ name: "ecto_1_sess", value: effectiveCookie.match(/(?:^|;\s*)ecto_1_sess=([^;]+)/)?.[1] || "", domain: "www.meta.ai", path: "/", secure: true }]);
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        return url.origin === "https://www.meta.ai" ? route.continue() : route.abort();
      });
      await page.routeWebSocket("**/*", socket => socket.close());
      const navPromise = page.goto("https://www.meta.ai/", {
        waitUntil: "networkidle",
        timeout: 3e4
      });
      if (signal) {
        const abortPromise = new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
        await Promise.race([navPromise, abortPromise]);
      } else {
        await navPromise;
      }
      if (new URL(page.url()).origin !== "https://www.meta.ai") return { ok: false, status: 401, error: "Meta AI session expired" };
      const html = await page.content();
      const match = html.match(ACCESS_TOKEN_RE);
      if (!match) {
        return { ok: false, status: 401, error: "Meta AI session expired; re-import your ecto_1_sess cookie" };
      }
      const token = `ecto1:${match[1]}`;
      META_TOKEN_CACHE.set(cacheKey, { token, updatedCookie, expiresAt: Date.now() + META_TOKEN_TTL_MS });
      return { ok: true, token, updatedCookie };
    } finally {
      await page?.close().catch(() => {
      });
      await release(poolKey);
    }
  } catch (err) {
    return {
      ok: false,
      error: `fetchFreshAccessToken failed: ${sanitizeErrorMessage(
        err instanceof Error ? err.message : String(err)
      )}`
    };
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
function __fetchFreshAccessTokenForTesting(cookieHeader, signal) {
  return fetchFreshAccessToken(cookieHeader, signal);
}
const _fetchFreshAccessTokenDispatch = (cookieHeader, signal, connectionId, proxyOptions) => _fetchFreshAccessTokenOverride ? _fetchFreshAccessTokenOverride(cookieHeader, signal, connectionId, proxyOptions) : fetchFreshAccessToken(cookieHeader, signal, connectionId, proxyOptions);
export {
  __fetchFreshAccessTokenForTesting,
  __resetMuseSparkTokenCacheForTesting,
  __setMuseSparkBrowserPoolForTesting,
  __setMuseSparkFreshTokenFetcherForTesting,
  _fetchFreshAccessTokenDispatch
};
