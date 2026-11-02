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

const DEFAULT_TIMEOUT_MS = 120000;

let transportPromise = null;

// A Transport carries the TLS emulation and connection pool but no cookie jar
// (upstream used a Session, whose jar would be shared by every caller), and
// each request runs with cookieMode "ephemeral".
async function loadTransport() {
  const wreq = await import("wreq-js");
  const transport = await wreq.createTransport({
    emulation: { tlsOptions: { cipherList: OPENCODE_CIPHER_LIST } },
  });
  return { wreq, transport };
}

/**
 * Resolve the free-tier transport, or null when wreq-js cannot load. The
 * result is cached for the process: a missing optional dependency does not
 * appear without a restart, so the warning is logged once.
 *
 * @returns {Promise<((url: string, options: object) => Promise<Response>) | null>}
 */
export async function getOpencodeTlsFetch() {
  transportPromise ??= loadTransport().catch((error) => {
    console.warn(
      `[opencode] wreq-js unavailable (${error?.message || "unknown error"}); ` +
      "OpenCode free-tier requests use native fetch and may be refused with 429. " +
      "Install the optional wreq-js dependency to send the accepted TLS fingerprint."
    );
    return null;
  });
  const loaded = await transportPromise;
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
    timeout: DEFAULT_TIMEOUT_MS,
    transport,
    cookieMode: "ephemeral",
    disableDefaultHeaders: true,
  };
  if (options.body !== undefined) init.body = options.body;
  if (options.signal) init.signal = options.signal;
  const res = await wreq.fetch(url, init);
  const headers = new Headers();
  res.headers?.forEach?.((value, key) => headers.append(key, value));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Drop the cached transport (tests). */
export function resetOpencodeTlsTransport() {
  const pending = transportPromise;
  transportPromise = null;
  pending?.then((loaded) => loaded?.transport?.close?.()).catch(() => {});
}

export const __test__ = { OPENCODE_CIPHER_LIST };
