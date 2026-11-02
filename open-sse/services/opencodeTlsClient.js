// TLS-impersonating transport for opencode.ai's free tier (upstream ce060c79).
//
// Upstream measured (2026-10-26, one process, one egress IP) that the free gate
// keys on the TLS ClientHello: the same body and headers answered 429
// FreeUsageLimitError over Node's OpenSSL fingerprint and 200 over Bun's
// BoringSSL one. The match is on JA4's cipher-list hash, so the list below must
// stay verbatim.
//
// wreq-js is an optional native dependency. It is imported lazily on first use;
// when it (or its platform binding) is missing, getOpencodeTlsFetch() resolves
// to null, logs once, and the caller keeps native fetch.

const OPENCODE_CIPHER_LIST = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-ECDSA-AES128-SHA",
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-ECDSA-AES256-SHA",
  "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
  "AES128-SHA",
  "AES256-SHA",
].join(":");

// wreq's `timeout` bounds the whole request, body included, so any value would
// cut long SSE streams. 0 disables it; BaseExecutor's connect timer and the
// caller's signal bound the request instead.
const REQUEST_TIMEOUT_MS = 0;
// Fetch spec null-body statuses: `new Response(body)` throws for these.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

let transportPromise = null;
let proxyEnvWarned = false;

// wreq's native client reads HTTP(S)_PROXY / ALL_PROXY when the transport is
// created and has no switch to ignore them. The directFetch path must stay
// direct (proxyAwareFetch already applied the fork's proxy and NO_PROXY policy),
// so with any of them set the free tier keeps native fetch.
const PROXY_ENV_NAMES = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
function hasProxyEnv() {
  return PROXY_ENV_NAMES.some((name) => Boolean(process.env[name]?.trim()));
}

// A Transport carries the TLS emulation and connection pool but no cookie jar
// (upstream used a Session, whose jar would be shared by every caller), and
// each request runs with cookieMode "ephemeral".
// A failed import is final for the process (resolves null, logged once); a
// failed createTransport throws so the next request retries it.
async function loadTransport() {
  let wreq;
  try {
    wreq = await import("wreq-js");
  } catch (error) {
    console.warn(
      `[opencode] wreq-js unavailable (${error?.message || "unknown error"}); ` +
      "OpenCode free-tier requests use native fetch and may be refused with 429. " +
      "Install the optional wreq-js dependency to send the accepted TLS fingerprint."
    );
    return null;
  }
  const transport = await wreq.createTransport({
    emulation: { tlsOptions: { cipherList: OPENCODE_CIPHER_LIST } },
  });
  return { wreq, transport };
}

/**
 * Resolve the free-tier transport, or null when wreq-js cannot be used, in
 * which case the caller keeps native fetch.
 *
 * @returns {Promise<((url: string, options: object) => Promise<Response>) | null>}
 */
export async function getOpencodeTlsFetch() {
  if (hasProxyEnv()) {
    if (!proxyEnvWarned) {
      proxyEnvWarned = true;
      console.warn("[opencode] proxy environment variables are set; wreq-js would apply them on its own, so OpenCode free-tier requests use native fetch.");
    }
    return null;
  }
  transportPromise ??= loadTransport();
  let loaded;
  try {
    loaded = await transportPromise;
  } catch (error) {
    transportPromise = null;
    console.warn(`[opencode] wreq-js transport setup failed (${error?.message || "unknown error"}); using native fetch for this request.`);
    return null;
  }
  if (!loaded) return null;
  return (url, options = {}) => opencodeTlsFetch(loaded, url, options);
}

/**
 * Send one request through the impersonated TLS transport. Returns a native
 * Response with the live body stream, so downstream SSE consumers keep working.
 */
async function opencodeTlsFetch({ wreq, transport }, url, options) {
  const init = {
    method: options.method || "GET",
    headers: options.headers,
    redirect: options.redirect || "follow",
    timeout: REQUEST_TIMEOUT_MS,
    transport,
    cookieMode: "ephemeral",
    disableDefaultHeaders: true,
  };
  if (options.body !== undefined) init.body = options.body;
  if (options.signal) init.signal = options.signal;
  const res = await wreq.fetch(url, init);
  const headers = new Headers();
  res.headers?.forEach?.((value, key) => headers.append(key, value));
  let body = NULL_BODY_STATUSES.has(res.status) ? null : res.body ?? null;
  // wreq drops its abort listener once headers arrive; piping with the signal
  // keeps an abort cancelling the upstream body mid-stream.
  if (body && options.signal) body = body.pipeThrough(new TransformStream(), { signal: options.signal });
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

/** Drop the cached transport (tests). */
export function resetOpencodeTlsTransport() {
  const pending = transportPromise;
  transportPromise = null;
  pending?.then((loaded) => loaded?.transport?.close?.()).catch(() => {});
}

export const __test__ = { OPENCODE_CIPHER_LIST };
