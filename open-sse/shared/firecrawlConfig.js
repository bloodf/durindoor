import { URL } from "node:url";

// Self-hosted Firecrawl probe / runtime base URL allowlist.
// Distinct from public SSRF guard: this explicitly permits loopback and private
// LAN targets because the user is intentionally configuring a local instance.
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";export const ALLOWED_FIRECRAWL_HOSTS = Object.freeze([
"localhost",
"127.0.0.1",
"::1",
"10.0.0.0/8",
"172.16.0.0/12",
"192.168.0.0/16",
"fc00::/7 (IPv6 ULA)"]
);

const BLOCKED_SUFFIXES = [".internal", ".local"];
const BLOCKED_HOSTNAMES = ["metadata.google.internal", "0.0.0.0"];

function isRfc1918Ipv4(host) {
  if (!host || !isString(host)) return false;
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  if (!parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p))) return false;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isLoopbackIpv6(host) {
  return host === "::1";
}

function isUlaIpv6(host) {
  if (!host || !isString(host) || !host.includes(":")) return false;
  const first = host.split(":")[0];
  if (!first) return false;
  return /^[fF][cCdD]/.test(first);
}

function isBlockedHost(host) {
  if (!host) return true;
  const lower = host.toLowerCase();
  if (BLOCKED_HOSTNAMES.includes(lower)) return true;
  if (BLOCKED_SUFFIXES.some((s) => lower.endsWith(s))) return true;
  const parts = lower.split(".");
  if (parts.length === 4) {
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    if (a === 169 && b === 254) return true;
  }
  const first = lower.split(":")[0];
  if (/^[fF][eE][8-9aAbB]/.test(first)) return true;
  return false;
}

const BLOCKED_REQUEST_HEADERS = new Set([
"host",
"content-length",
"connection",
"transfer-encoding",
"expect",
"proxy-authorization",
"proxy-authenticate",
"proxy-connection"]
);

function isValidHeaderName(name) {
  if (!isString(name) || name.length === 0 || name.length > 256) return false;
  return /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/.test(name);
}

function isValidHeaderValue(value) {
  if (!isString(value) || value.length === 0 || value.length > 8192) return false;
  return !/[\r\n]/.test(value);
}

export function validateFirecrawlHeaders(input) {
  if (input === undefined || input === null) return { ok: true, headers: undefined };
  if (!isObject(input) || Array.isArray(input)) {
    return { ok: false, error: "Headers must be a plain object" };
  }
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) {
    return { ok: false, error: "Headers must be a plain object" };
  }
  const out = {};
  const entries = Object.entries(input);
  if (entries.length > 16) {
    return { ok: false, error: "Too many headers (max 16)" };
  }
  for (const [rawName, rawValue] of entries) {
    const name = rawName.toLowerCase();
    if (!isValidHeaderName(rawName)) {
      return { ok: false, error: `Invalid header name: ${rawName}` };
    }
    if (BLOCKED_REQUEST_HEADERS.has(name)) {
      return { ok: false, error: `Reserved header not allowed: ${rawName}` };
    }
    if (!isValidHeaderValue(rawValue)) {
      return { ok: false, error: `Invalid header value for ${rawName}` };
    }
    out[name] = rawValue.trim();
  }
  return { ok: true, headers: Object.keys(out).length > 0 ? out : undefined };
}

function isValidApiKey(value) {
  if (!isString(value) || value.length === 0 || value.length > 4096) return false;
  return /^[\x20-\x7E]+$/.test(value);
}

export function validateFirecrawlApiKey(input) {
  if (input === undefined || input === null || input === "") return { ok: true, apiKey: undefined };
  if (!isString(input)) return { ok: false, error: "Invalid API key" };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: true, apiKey: undefined };
  if (!isValidApiKey(trimmed)) return { ok: false, error: "Invalid API key" };
  return { ok: true, apiKey: trimmed };
}

function getRawHost(raw) {
  // Strip scheme, fragment, query, userinfo, port, and path to get the authority
  // hostname exactly as written, before WHATWG URL normalization removes leading
  // zeros from IPv4 octets.
  let rest = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  rest = rest.split(/[?#]/)[0];
  const at = rest.indexOf("@");
  if (at !== -1) rest = rest.slice(at + 1);
  const slash = rest.indexOf("/");
  if (slash !== -1) rest = rest.slice(0, slash);
  return rest.split(":")[0].replace(/^\[|\]$/g, "");
}

export function validateFirecrawlBaseUrl(raw) {
  if (!raw || !isString(raw)) {
    return { ok: false, error: "Firecrawl base URL is required" };
  }
  raw = raw.trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid Firecrawl base URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only HTTP and HTTPS URLs are allowed" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "URL credentials are not allowed" };
  }
  const rawHost = getRawHost(raw);
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(rawHost)) {
    if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(rawHost)) {
      return { ok: false, error: "Invalid IPv4 address" };
    }
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHost(host)) {
    return { ok: false, error: "Host is not allowed for self-hosted Firecrawl" };
  }
  if (
  host.toLowerCase() === "localhost" ||
  host === "127.0.0.1" ||
  isRfc1918Ipv4(host) ||
  isLoopbackIpv6(host) ||
  isUlaIpv6(host))
  {
    return { ok: true, url };
  }
  return { ok: false, error: "Host is not allowed for self-hosted Firecrawl" };
}

export function parseFirecrawlHeaders(raw) {
  if (!raw || !isString(raw)) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}