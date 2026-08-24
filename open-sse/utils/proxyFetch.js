import { Readable } from "stream";
import { Agent, ProxyAgent, setGlobalDispatcher } from "undici";
import { MEMORY_CONFIG, PROXY_FETCH_POOL_CONFIG } from "../config/runtimeConfig.js";
import { dbg } from "./debugLog.js";
import { sanitizeErrorMessage } from "./error.js";
import {
  assertGuardedProbeDispatcherAddressAllowed,
  isGuardedProbeDispatcher,
  OutboundUrlGuardError } from
"./outboundUrlGuard.js";
import { digestMemoryKey } from "./memoryKey.js";
import {
  isQuotaBearingProviderRequest,
  runProviderAttemptDispatch } from
"../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { isFunction, isString, isUndefined } from "@/shared/utils/typeChecks.js";

let originalFetch = globalThis.fetch;
const DURINDOOR_FETCH_PATCH = Symbol.for("durindoor.proxyFetch.patched");
const NEXT_FETCH_PATCH = Symbol.for("next-patch");
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const proxyDispatchers = new Map();
let directDispatcher = null;
let bypassTransportForTesting = null;
let realIpResolverForTesting = null;

export function __setOriginalFetchForTesting(fn) {
  const prev = originalFetch;
  originalFetch = fn;
  return () => {originalFetch = prev;};
}

export function __setBypassTransportForTesting(transport) {
  const previous = bypassTransportForTesting;
  bypassTransportForTesting = transport;
  return () => {bypassTransportForTesting = previous;};
}

export function __setRealIpResolverForTesting(resolver) {
  const previous = realIpResolverForTesting;
  realIpResolverForTesting = resolver;
  return () => {realIpResolverForTesting = previous;};
}

export function __setProxyDispatcherForTesting(proxyUrl, dispatcher) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (normalized) proxyDispatchers.set(proxyDispatcherKey(normalized), dispatcher);
}

export function __clearProxyDispatchersForTesting() {
  proxyDispatchers.clear();
}

export function __getProxyDispatcherCacheSnapshotForTesting() {
  return {
    keys: [...proxyDispatchers.keys()],
    size: proxyDispatchers.size,
    maxSize: MEMORY_CONFIG.proxyDispatchersMaxSize
  };
}

// Happy Eyeballs (RFC 8305) for direct egress — avoids 30s+ stalls on broken-IPv6 hosts.
setGlobalDispatcher(new Agent({ connect: { autoSelectFamily: true } }));

// ─── TLS fingerprinting via got-scraping (browser-like JA3) ───────────────
// Disabled: not in use. Kept commented for future re-enable.
// Restore the original block to re-enable per-host JA3 spoofing.
/*
let _gotScraping = null;
let _gotScrapingChecked = false;
const _gotScrapingLoggedHosts = new Set();

async function getGotScraping() {
  if (_gotScrapingChecked) return _gotScraping;
  _gotScrapingChecked = true;
  try {
    const mod = await import("got-scraping");
    _gotScraping = typeof mod.gotScraping === "function" ? mod.gotScraping : null;
    if (_gotScraping) dbg("TLS", "got-scraping loaded (browser-like JA3 enabled)");
  } catch (e) {
    console.warn(`[ProxyFetch] got-scraping unavailable, falling back to native fetch: ${e.message}`);
    _gotScraping = null;
  }
  return _gotScraping;
}

async function gotScrapingFetch(url, options) {
  const gs = await getGotScraping();
  if (!gs) return null;

  const method = (options.method || "GET").toUpperCase();
  const headersInit = options.headers || {};
  const headers = headersInit instanceof Headers
    ? Object.fromEntries(headersInit.entries())
    : { ...headersInit };

  return new Promise((resolve, reject) => {
    let settled = false;
    const stream = gs.stream({
      url,
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : options.body,
      throwHttpErrors: false,
      retry: { limit: 0 },
      timeout: { request: undefined },
      followRedirect: false,
      decompress: true,
    });

    if (options.signal) {
      const onAbort = () => { try { stream.destroy(new Error("aborted")); } catch { } };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    stream.once("response", (res) => {
      if (settled) return;
      settled = true;
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers || {})) {
        if (Array.isArray(v)) v.forEach((x) => resHeaders.append(k, String(x)));
        else if (v != null) resHeaders.set(k, String(v));
      }
      const body = Readable.toWeb(stream);
      resolve(new Response(body, { status: res.statusCode, statusText: res.statusMessage || "", headers: resHeaders }));
    });

    stream.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function tryGotScrapingFetch(url, options) {
  try {
    const res = await gotScrapingFetch(url, options);
    if (res) {
      try {
        const host = new URL(typeof url === "string" ? url : url.toString()).hostname;
        if (!_gotScrapingLoggedHosts.has(host)) {
          _gotScrapingLoggedHosts.add(host);
          dbg("TLS", `using got-scraping for ${host}`);
        }
      } catch { }
    }
    return res;
  } catch (e) {
    console.warn(`[ProxyFetch] got-scraping request failed, fallback to native fetch: ${e.message}`);
    return null;
  }
}
*/

// DNS cache — use Map to avoid prototype pollution via malformed hostnames
const DNS_CACHE = new Map();
const MITM_BYPASS_HOSTS = [
"cloudcode-pa.googleapis.com",
"daily-cloudcode-pa.googleapis.com",
"api.individual.githubcopilot.com",
"q.us-east-1.amazonaws.com",
"codewhisperer.us-east-1.amazonaws.com",
"api2.cursor.sh"];

const GOOGLE_DNS_SERVERS = ["8.8.8.8", "8.8.4.4"];
const HTTPS_PORT = 443;
const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 300;

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function safeTransportError(error) {
  return sanitizeErrorMessage(error?.message || error);
}

function signalAbortError(signal) {
  return signal?.reason instanceof Error ?
  signal.reason :
  new DOMException("Provider request aborted", "AbortError");
}

function rethrowTransportAbort(error, signal) {
  if (signal?.aborted) throw signalAbortError(signal);
  if (error?.name === "AbortError") throw error;
}

function raceWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signalAbortError(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, signalAbortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

/** Resolve every IPv4 answer through Google DNS (bypass system DNS). */
async function resolveRealIPs(hostname) {
  if (realIpResolverForTesting) return realIpResolverForTesting(hostname);
  const cached = DNS_CACHE.get(hostname);
  if (cached && Date.now() < cached.expiry) return cached.ips;

  try {
    const dns = await import("dns");
    const { promisify } = await import("util");
    const resolver = new dns.Resolver();
    resolver.setServers(GOOGLE_DNS_SERVERS);
    const resolve4 = promisify(resolver.resolve4.bind(resolver));
    const addresses = await resolve4(hostname);
    DNS_CACHE.set(hostname, { ips: addresses, expiry: Date.now() + MEMORY_CONFIG.dnsCacheTtlMs });
    return addresses;
  } catch (error) {
    console.warn(`[ProxyFetch] DNS resolve failed for ${hostname}:`, safeTransportError(error));
    return [];
  }
}

/**
 * Check if request should bypass MITM DNS redirect
 */
function shouldBypassMitmDns(url) {
  try {
    const hostname = new URL(url).hostname;
    return MITM_BYPASS_HOSTS.some((host) => hostname.includes(host));
  } catch {return false;}
}

function shouldBypassByNoProxy(targetUrl, noProxyValue) {
  const noProxy = normalizeString(noProxyValue);
  if (!noProxy) return false;

  let hostname;
  try {hostname = new URL(targetUrl).hostname.toLowerCase();} catch {return false;}
  const patterns = noProxy.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

/**
 * Get proxy URL from environment
 */
function getEnvProxyUrl(targetUrl) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  let protocol;
  try {protocol = new URL(targetUrl).protocol;} catch {return null;}

  if (protocol === "https:") {
    return process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy;
  }

  return process.env.HTTP_PROXY || process.env.http_proxy ||
  process.env.ALL_PROXY || process.env.all_proxy;
}

/** Whether a custom transport must delegate routing to proxyAwareFetch. */
export function shouldUseProxyAwareTransport(targetUrl, proxyOptions = null) {
  if (
  proxyOptions?.strictProxy === true ||
  proxyOptions?.enabled === true ||
  proxyOptions?.connectionProxyEnabled === true ||
  Boolean(normalizeString(proxyOptions?.vercelRelayUrl)))
  return true;
  if (proxyOptions?.disableEnvProxy === true) return false;
  return Boolean(normalizeProxyUrl(getEnvProxyUrl(targetUrl)));
}

/**
 * Normalize proxy URL (allow host:port)
 */
function normalizeProxyUrl(proxyUrl) {
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  try {
    new URL(normalizedInput);
    return normalizedInput;
  } catch {
    // Allow "127.0.0.1:7890" style values
    return `http://${normalizedInput}`;
  }
}

function proxyDispatcherKey(normalizedProxyUrl) {
  return digestMemoryKey("proxy-dispatcher", normalizedProxyUrl);
}

/**
 * Parse proxy URL from various formats
 * Supports:
 * - ip:port
 * - ip:port:user:pass
 * - user:pass@ip:port
 * - protocol://ip:port
 * - protocol://user:pass@ip:port
 * - protocol://ip:port:user:pass
 */
function parseProxyUrl(proxyUrl) {
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  // Handle protocol:// prefix
  let urlStr = normalizedInput;
  if (urlStr.includes("://")) {
    urlStr = urlStr.split("://")[1];
  }

  // Handle user:pass@ip:port format
  let username = null;
  let password = null;
  let hostPort = urlStr;

  if (urlStr.includes("@")) {
    const [authPart, hostPortPart] = urlStr.split("@");
    hostPort = hostPortPart;

    if (authPart.includes(":")) {
      [username, password] = authPart.split(":");
    } else {
      username = authPart;
    }
  }

  // Handle ip:port:user:pass format (no @)
  if (hostPort.includes(":") && !hostPort.startsWith("http")) {
    const parts = hostPort.split(":");
    if (parts.length === 4) {
      // ip:port:user:pass format
      [hostPort, username, password] = parts;
    } else if (parts.length === 3) {
      // ip:port:user format (user without password)
      [hostPort, username] = parts;
    }
  }

  // Parse host and port
  let host = "";
  let port = "";
  let protocol = "http"; // default

  if (hostPort.includes("/")) {
    // Handle path-like formats
    const url = new URL(`http://${hostPort}`);
    host = url.hostname;
    port = url.port;
    protocol = url.protocol.replace(":", "");
  } else if (hostPort.includes(":")) {
    [host, port] = hostPort.split(":");
  } else {
    host = hostPort;
    port = "";
  }

  // Validate host
  if (!host || host === "") {
    return null;
  }

  // Build proxy URL
  let result = "";
  if (protocol) {
    result += `${protocol}://`;
  }

  if (username) {
    if (password) {
      result += `${username}:${password}@`;
    } else {
      result += `${username}@`;
    }
  }

  result += host;

  if (port) {
    result += `:${port}`;
  }

  return result;
}

/**
 * Parse multiple proxy URLs from a string (bulk import)
 * Supports comma-separated list
 */
function parseProxyUrls(proxyUrls) {
  if (!proxyUrls) return [];

  const urls = normalizeString(proxyUrls).split(",");
  const parsedUrls = [];

  for (const url of urls) {
    const parsed = parseProxyUrl(url.trim());
    if (parsed) {
      parsedUrls.push(parsed);
    }
  }

  return parsedUrls;
}

/**
 * Get proxy URL from various sources including bulk import
 */
function getProxyUrl(targetUrl, proxyOptions) {
  const options = proxyOptions || {};
  // First try connection-specific proxy
  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, options);
  if (connectionProxyUrl) return connectionProxyUrl;

  // Try environment variable
  const envProxyUrl = normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  if (envProxyUrl) return envProxyUrl;

  // Try bulk import proxy URLs (from proxyOptions.bulkImport)
  if (options.bulkImport) {
    const bulkUrls = Array.isArray(options.bulkImport) ?
    options.bulkImport :
    parseProxyUrls(options.bulkImport);

    for (const bulkUrl of bulkUrls) {
      try {
        // Test if proxy works by attempting to create a dispatcher
        const testDispatcher = new ProxyAgent({ uri: bulkUrl });
        return bulkUrl;
      } catch (e) {
        // Skip invalid proxy URLs
        continue;
      }
    }
  }

  return null;
}

function resolveConnectionProxyUrl(targetUrl, proxyOptions) {
  const enabled = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return null;

  const proxyUrlRaw = normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  if (!proxyUrlRaw) return null;

  const noProxy = normalizeString(proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy);
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  return normalizeProxyUrl(proxyUrlRaw);
}

/**
 * Create and cache one bounded undici proxy pool per selected proxy URL.
 * Reusing the dispatcher preserves proxy affinity while limiting connections
 * opened to each upstream origin under concurrent load.
 */
async function getDispatcher(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;
  const cacheKey = proxyDispatcherKey(normalized);

  if (!proxyDispatchers.has(cacheKey)) {
    // Evict oldest entry if max size reached
    if (proxyDispatchers.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
      const oldestKey = proxyDispatchers.keys().next().value;
      const oldestDispatcher = proxyDispatchers.get(oldestKey);
      proxyDispatchers.delete(oldestKey);
      try {
        // `Dispatcher.close()` waits for active streams. Eviction must not
        // block a new route merely because an older SSE request is long-lived.
        Promise.resolve(oldestDispatcher?.close?.()).catch(() => {});
      } catch {

        // The entry is already detached; cleanup must not prevent replacement.
      }}
    // proxyTunnel: true forces a CONNECT tunnel even for plain-HTTP targets.
    // undici 8.6+ defaults to forwarding plain-HTTP as an origin request
    // (GET http://host/…) which CONNECT-only proxies reject with 501. Safe on
    // undici <8.6: unknown option, ignored (those versions already tunneled).
    // Long-lived SSE streams must not be cut off by undici's default 300s
    // headers/body timeouts on a slow proxy hop (#1570). connectTimeout and
    // headersTimeout stay bounded (tunable via env); bodyTimeout:0 disables the
    // idle-body deadline so a streaming response can run indefinitely.
    const connectTimeout = parseInt(process.env.PROXY_CONNECT_TIMEOUT_MS, 10) || 90000;
    const headersTimeout = parseInt(process.env.PROXY_HEADERS_TIMEOUT_MS, 10) || 300000;
    proxyDispatchers.set(cacheKey, new ProxyAgent({
      uri: normalized,
      proxyTunnel: true,
      connectTimeout,
      headersTimeout,
      bodyTimeout: 0,
      connections: PROXY_FETCH_POOL_CONFIG.proxyConnectionsPerOrigin,
      keepAliveTimeout: PROXY_FETCH_POOL_CONFIG.keepAliveTimeoutMs,
      keepAliveMaxTimeout: PROXY_FETCH_POOL_CONFIG.keepAliveMaxTimeoutMs,
      maxCachedSessions: PROXY_FETCH_POOL_CONFIG.proxyMaxCachedSessions,
      pipelining: PROXY_FETCH_POOL_CONFIG.pipelining
    }));
  }

  return proxyDispatchers.get(cacheKey);
}

/**
 * Build options for the shared direct undici pool. One Agent is reused across
 * calls and maintains a bounded pool per origin without changing route choice.
 */
export function getDirectDispatcherOptionsForTest() {
  return {
    connections: PROXY_FETCH_POOL_CONFIG.directConnectionsPerOrigin,
    keepAliveTimeout: PROXY_FETCH_POOL_CONFIG.keepAliveTimeoutMs,
    keepAliveMaxTimeout: PROXY_FETCH_POOL_CONFIG.keepAliveMaxTimeoutMs,
    maxCachedSessions: PROXY_FETCH_POOL_CONFIG.directMaxCachedSessions,
    pipelining: PROXY_FETCH_POOL_CONFIG.pipelining,
    connect: {
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 1000
    }
  };
}

async function getDirectDispatcher() {
  if (directDispatcher) return directDispatcher;
  directDispatcher = new Agent(getDirectDispatcherOptionsForTest());
  return directDispatcher;
}

async function directFetch(url, options) {
  const dispatcher = options?.dispatcher || (await getDirectDispatcher());
  const currentFetch = globalThis.fetch;
  const isDurinDoorPatchedFetch = isFunction(currentFetch) &&
  hasOwn(currentFetch, DURINDOOR_FETCH_PATCH) &&
  currentFetch[DURINDOOR_FETCH_PATCH] === true;
  const isNextPatchedFetch = isFunction(currentFetch) &&
  globalThis[NEXT_FETCH_PATCH] === true &&
  hasOwn(currentFetch, "__nextPatched") &&
  currentFetch.__nextPatched === true &&
  hasOwn(currentFetch, "__nextGetStaticStore") && isFunction(
    currentFetch.__nextGetStaticStore) &&
  hasOwn(currentFetch, "_nextOriginalFetch") && isFunction(
    currentFetch._nextOriginalFetch);
  // A later Next wrapper can retain this module's patch through a dedupe
  // wrapper, and a second bundled module instance can install another DurinDoor
  // patch. Both identities must cross through this instance's captured fetch
  // to avoid A -> B -> A recursion. Ordinary unmarked replacements remain
  // supported for embedders and tests.
  const fetchImpl = !isFunction(currentFetch) ||
  currentFetch === patchedFetch ||
  isDurinDoorPatchedFetch ||
  isNextPatchedFetch ?
  originalFetch :
  currentFetch;
  return runProviderAttemptDispatch(() => fetchImpl(url, { ...options, dispatcher }));
}

/**
 * Create HTTPS request with manual socket connection (bypass DNS)
 */
export async function createBypassRequest(parsedUrl, realIP, options) {
  const abortError = () => signalAbortError(options?.signal);
  if (options?.signal?.aborted) throw abortError();
  const requestBody = await serializeBypassRequestBody(options?.body);
  const httpsModule = bypassTransportForTesting?.https ? null : await import("https");
  const tlsModule = bypassTransportForTesting?.tls ? null : await import("tls");
  // CJS modules expose exports via .default in ESM dynamic import context
  const https = bypassTransportForTesting?.https ?? httpsModule.default ?? httpsModule;
  const tls = bypassTransportForTesting?.tls ?? tlsModule.default ?? tlsModule;
  if (options?.signal?.aborted) throw abortError();

  return new Promise((resolve, reject) => {
    let socket = null;
    let req = null;
    let responseStream = null;
    let resolved = false;
    let settled = false;
    const cleanup = () => options?.signal?.removeEventListener?.("abort", onAbort);
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      const error = abortError();
      try {responseStream?.destroy?.(error);} catch {/* noop */}
      try {req?.destroy?.(error);} catch {/* noop */}
      try {socket?.destroy?.(error);} catch {/* noop */}
      if (!resolved) fail(error);
    };
    options?.signal?.addEventListener?.("abort", onAbort, { once: true });
    if (options?.signal?.aborted) {
      onAbort();
      return;
    }

    const reqOptions = {
      // Connect to the independently resolved address while authenticating
      // the certificate and SNI against the caller's original host.
      hostname: realIP,
      port: parsedUrl.port || HTTPS_PORT,
      servername: parsedUrl.hostname,
      checkServerIdentity: (_hostname, certificate) =>
      tls.checkServerIdentity(parsedUrl.hostname, certificate),

      rejectUnauthorized: true,
      agent: false,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || "POST",
      headers: {
        ...options.headers,
        Host: parsedUrl.host
      }
    };

    try {
      req = https.request(reqOptions, (res) => {
        responseStream = res;
        const response = {
          ok: res.statusCode >= HTTP_SUCCESS_MIN && res.statusCode < HTTP_SUCCESS_MAX,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: new Map(Object.entries(res.headers)),
          body: Readable.toWeb(res),
          text: async () => {
            const chunks = [];
            for await (const chunk of res) chunks.push(chunk);
            return Buffer.concat(chunks).toString();
          },
          json: async () => JSON.parse(await response.text())
        };
        resolved = true;
        settled = true;
        const finishBody = () => cleanup();
        res.once("end", finishBody);
        res.once("close", finishBody);
        resolve(response);
      });
      req.once?.("socket", (activeSocket) => {socket = activeSocket;});
      req.on("error", (error) => {
        if (!resolved) fail(error);
      });
      if (options?.signal?.aborted) {
        onAbort();
        return;
      }
      if (requestBody !== undefined) {
        req.write(requestBody);
      }
      req.end();
    } catch (error) {
      fail(error);
    }
  });
}

/** Preserve fetch BodyInit bytes when the DNS-bypass transport uses https.request. */
export async function serializeBypassRequestBody(body) {
  if (body == null) return undefined;
  if (isString(body) || Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (!isUndefined(Blob) && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  if (body instanceof URLSearchParams) return body.toString();
  if (isFunction(body?.getReader) || isFunction(body?.pipe)) {
    throw new TypeError("Streaming request bodies are not supported by the DNS-bypass transport");
  }
  return JSON.stringify(body);
}

/**
 * Route fetch through configured proxy transport. A DNS-guarded provider probe
 * is refused when proxy routing is selected because ProxyAgent replaces its
 * validating dispatcher and resolves the CONNECT target beyond that boundary.
 */
export async function proxyAwareFetch(url, options = {}, proxyOptions = null) {
  // Native fetch can hide method-preserving 307/308 redirects inside one call,
  // which would send a second quota-bearing request under the first dispatch
  // ticket. Provider runtime endpoints are fixed configuration, so redirects
  // fail closed and must never be enabled by caller-controlled options.
  if (isQuotaBearingProviderRequest()) options = { ...options, redirect: "error" };
  const targetUrl = isString(url) ? url : url.toString();

  const vercelRelayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const envProxyUrl = connectionProxyUrl || proxyOptions?.disableEnvProxy === true ?
  null :
  normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  const proxyUrl = connectionProxyUrl || envProxyUrl;

  // ProxyAgent resolves the CONNECT target outside our connector, so replacing
  // a guarded probe dispatcher would silently remove DNS-address validation.
  // Undici exposes no supported connector composition for ProxyAgent; refuse
  // only when proxy routing remains selected after NO_PROXY evaluation.
  if (isGuardedProbeDispatcher(options?.dispatcher) && (vercelRelayUrl || proxyUrl)) {
    throw new OutboundUrlGuardError("Guarded provider probe cannot use an outbound proxy", {
      code: "OUTBOUND_URL_GUARD_BLOCKED",
      url: targetUrl,
      hostname: new URL(targetUrl).hostname
    });
  }

  // Vercel relay: forward request via relay headers
  if (vercelRelayUrl) {
    const parsed = new URL(targetUrl);
    // new Headers() copies plain objects AND Headers instances; object spread
    // would silently drop entries from a Headers object (OmniRoute#7093).
    const relayHeaders = new Headers(options.headers);
    relayHeaders.set("x-relay-target", `${parsed.protocol}//${parsed.host}`);
    relayHeaders.set("x-relay-path", `${parsed.pathname}${parsed.search}`);
    return runProviderAttemptDispatch(() => originalFetch(vercelRelayUrl, { ...options, headers: relayHeaders }));
  }

  // A strict OAuth pool is an egress boundary, not a preference. If the
  // selected route cannot be used (including a NO_PROXY match), never allow
  // ambient or direct networking to take over.
  if (proxyOptions?.strictProxy === true && !proxyUrl) {
    throw new Error("[ProxyFetch] Proxy required but unavailable (strictProxy=true)");
  }

  // MITM DNS bypass: for known MITM-intercepted hosts, resolve real IP to avoid DNS spoof
  if (shouldBypassMitmDns(targetUrl)) {
    if (proxyUrl) {
      // Proxy resolves DNS externally (not affected by /etc/hosts) — use proxy directly
      try {
        const dispatcher = await getDispatcher(proxyUrl);
        return await runProviderAttemptDispatch(() => originalFetch(url, { ...options, dispatcher }));
      } catch (proxyError) {
        if (isQuotaDispatchUnavailable(proxyError)) throw proxyError;
        rethrowTransportAbort(proxyError, options.signal);
        if (proxyOptions?.strictProxy === true) {
          throw new Error("[ProxyFetch] Proxy required but failed (strictProxy=true)");
        }
        console.warn(`[ProxyFetch] Proxy failed, falling back to direct bypass: ${safeTransportError(proxyError)}`);
      }
    }
    // No proxy — manually resolve real IP to bypass DNS spoof. A guarded probe
    // validates the full answer set before selecting one, preserving its
    // connection-time security boundary instead of downgrading to first-answer.
    try {
      const parsedUrl = new URL(targetUrl);
      const realIPs = await raceWithSignal(resolveRealIPs(parsedUrl.hostname), options.signal);
      if (isGuardedProbeDispatcher(options?.dispatcher)) {
        for (const address of realIPs) {
          assertGuardedProbeDispatcherAddressAllowed(options.dispatcher, address);
        }
      }
      if (realIPs.length) {
        if (options.signal?.aborted) {
          throw options.signal.reason instanceof Error ?
          options.signal.reason :
          new DOMException("Provider request aborted", "AbortError");
        }
        return await runProviderAttemptDispatch(() => createBypassRequest(parsedUrl, realIPs[0], options));
      }
    } catch (error) {
      if (error instanceof OutboundUrlGuardError) throw error;
      if (isQuotaDispatchUnavailable(error)) throw error;
      rethrowTransportAbort(error, options.signal);
      console.warn(`[ProxyFetch] MITM bypass failed: ${safeTransportError(error)}`);
    }
  }

  if (proxyUrl) {
    try {
      const dispatcher = await getDispatcher(proxyUrl);
      return await runProviderAttemptDispatch(() => originalFetch(url, { ...options, dispatcher }));
    } catch (proxyError) {
      if (isQuotaDispatchUnavailable(proxyError)) throw proxyError;
      rethrowTransportAbort(proxyError, options.signal);
      // If strictProxy is enabled, fail hard instead of falling back to direct
      if (proxyOptions?.strictProxy === true) {
        throw new Error("[ProxyFetch] Proxy required but failed (strictProxy=true)");
      }
      console.warn(`[ProxyFetch] Proxy failed, falling back to direct: ${safeTransportError(proxyError)}`);
      return directFetch(url, options);
    }
  }

  // got-scraping disabled — use undici direct egress with Happy Eyeballs.
  // (Re-enable per-host by wrapping with tryGotScrapingFetch when needed)
  return directFetch(url, options);
}

/**
 * Patched global fetch with env-proxy support and MITM DNS bypass
 */
async function patchedFetch(url, options = {}) {
  const { proxyOptions, ...restOptions } = options;
  return proxyAwareFetch(url, restOptions, proxyOptions || null);
}

Object.defineProperty(patchedFetch, DURINDOOR_FETCH_PATCH, {
  value: true,
  enumerable: false,
  configurable: false,
  writable: false
});

// Idempotency guard — only patch once to avoid wrapping multiple times
if (globalThis.fetch !== patchedFetch) {
  globalThis.fetch = patchedFetch;
}

export default patchedFetch;