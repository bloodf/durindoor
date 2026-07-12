import { ProxyAgent, fetch as undiciFetch } from "undici";
import { sanitizeErrorMessage } from "../../../open-sse/utils/error.js";
import { assertPublicUrl } from "@/shared/utils/ssrfGuard.js";

// Fixed probe target. Previously this endpoint accepted a caller-supplied
// `testUrl` from the request body, which turned the proxy-test route into
// an SSRF amplifier (the user-controlled `dispatcher` was a red herring —
// the URL itself was the weapon). The test exists to verify that a
// configured proxy can reach the public internet; the destination does
// not need to vary per-call.
export const DEFAULT_TEST_URL = "https://google.com/";
const DEFAULT_TIMEOUT_MS = 8000;

// Hard cap on 3xx hops. google.com and similar endpoints 301 http→https
// and/or to a country-specific TLD; a loop (A↔B) or a long chain is
// treated as failure.
const MAX_REDIRECT_HOPS = 5;

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
  let parsedProxyUrl = "";
  if (protocol) {
    parsedProxyUrl += `${protocol}://`;
  }

  if (username) {
    if (password) {
      parsedProxyUrl += `${username}:${password}@`;
    } else {
      parsedProxyUrl += `${username}@`;
    }
  }

  parsedProxyUrl += host;

  if (port) {
    parsedProxyUrl += `:${port}`;
  }

  return parsedProxyUrl;
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

export function getErrorMessage(err) {
  if (!err) return "Unknown error";
  const base = err?.message || String(err);
  const causeCode = err?.cause?.code || err?.code;
  const causeMessage = err?.cause?.message;
  const safeBase = sanitizeErrorMessage(base);
  const safeCauseMessage = causeMessage ? sanitizeErrorMessage(causeMessage) : "";
  const safeCauseCode = causeCode ? sanitizeErrorMessage(causeCode) : "";

  if (causeMessage && causeMessage !== base) {
    return safeCauseCode
      ? `${safeBase}: ${safeCauseMessage} (${safeCauseCode})`
      : `${safeBase}: ${safeCauseMessage}`;
  }

  if (causeCode && !base.includes(causeCode)) {
    return `${safeBase} (${safeCauseCode})`;
  }

  return safeBase;
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export async function testProxyUrl({ proxyUrl, timeoutMs } = {}) {
  const normalizedProxyUrl = normalizeString(proxyUrl);
  if (!normalizedProxyUrl) {
    return { ok: false, status: 400, error: "proxyUrl is required" };
  }

  // Parse proxy URL from various formats
  const parsedProxyUrl = parseProxyUrl(normalizedProxyUrl);
  if (!parsedProxyUrl) {
    return { ok: false, status: 400, error: "Invalid proxy URL format" };
  }

  const timeoutMsRaw = Number(timeoutMs);
  const normalizedTimeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.min(timeoutMsRaw, 30000)
      : DEFAULT_TIMEOUT_MS;

  let dispatcher;

  try {
    try {
      dispatcher = new ProxyAgent({ uri: parsedProxyUrl });
    } catch (err) {
      return {
        ok: false,
        status: 400,
        error: `Invalid proxy URL: ${sanitizeErrorMessage(err?.message || err)}`,
      };
    }

    let testUrl = DEFAULT_TEST_URL;
    const startedAt = Date.now();

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      // Re-validate on EVERY hop: a hostile proxy can 3xx the probe to a
      // private / metadata target. https: only — this test exists to
      // verify the proxy can reach the public internet; if it cannot
      // fetch https, it cannot proxy real traffic.
      try {
        assertPublicUrl(testUrl);
      } catch (guardErr) {
        return {
          ok: false,
          status: 400,
          error: `URL not allowed: ${sanitizeErrorMessage(guardErr?.message || "blocked")}`,
        };
      }
      let parsed;
      try {
        parsed = new URL(testUrl);
      } catch {
        return { ok: false, status: 400, error: "URL is not valid" };
      }
      if (parsed.protocol !== "https:") {
        return { ok: false, status: 400, error: "URL must use https:" };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

      let res;
      try {
        res = await undiciFetch(testUrl, {
          method: "HEAD",
          dispatcher,
          signal: controller.signal,
          redirect: "manual",
          headers: {
            "User-Agent": "9Router",
          },
        });
      } catch (err) {
        const message =
          err?.name === "AbortError"
            ? "Proxy test timed out"
            : getErrorMessage(err);
        return { ok: false, status: 500, error: message };
      } finally {
        clearTimeout(timer);
      }

      // 3xx with redirect:manual → re-validate Location and loop.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          return { ok: false, status: res.status, error: "Redirect without Location header" };
        }
        let next;
        try {
          next = new URL(location, testUrl).toString();
        } catch {
          return { ok: false, status: res.status, error: "Redirect Location is not a valid URL" };
        }
        testUrl = next;
        continue;
      }

      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        url: testUrl,
        elapsedMs: Date.now() - startedAt,
      };
    }

    return { ok: false, status: 508, error: "Too many redirects" };
  } finally {
    try {
      await dispatcher?.close?.();
    } catch {
      // ignore
    }
  }
}

/**
 * Test multiple proxy URLs in bulk
 * Supports comma-separated list or array of proxy URLs in various formats
 */
export async function testProxyUrls({ proxyUrls, timeoutMs } = {}) {
  if (!proxyUrls) {
    return [];
  }

  const urls = Array.isArray(proxyUrls) ? proxyUrls : parseProxyUrls(proxyUrls);
  const results = [];

  for (const url of urls) {
    const result = await testProxyUrl({ proxyUrl: url, timeoutMs });
    results.push({ proxyUrl: url, ...result });
  }

  return results;
}
