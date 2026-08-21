/**
 * Outbound URL guard (SSRF hardening) for provider VALIDATION probes.
 *
 * Port of OmniRoute `src/shared/network/outboundUrlGuard.ts` (#6542,
 * build on #5066). Env var names, defaults, and mode selection are copied
 * verbatim — only module syntax (TS→JS) and the DB-backed feature-flag
 * source differ (DurinDoor has no `resolveFeatureFlag`; env-only here).
 *
 * Modes:
 *   - "none"           → no checks (explicit power-user full opt-in).
 *   - "public-only"    → reject every private/LAN host.
 *   - "block-metadata" → allow private/LAN (local-first default) but reject
 *                        cloud-metadata / IPv4 link-local endpoints (the
 *                        SSRF→IAM-credential pivot).
 *
 * Block matrix by mode (applied to URL hostnames and connection-time DNS results):
 *   - "none"           → NOTHING blocked except protocol / embedded-credential
 *                        checks in parseOutboundUrl (operator explicitly trusts
 *                        the target; metadata is intentionally NOT blocked).
 *   - "block-metadata" → cloud-metadata hostnames + IPv4 link-local
 *                        (169.254.0.0/16) blocked; LAN/loopback allowed.
 *   - "public-only"    → every private/LAN host blocked (RFC1918, loopback,
 *                        100.64/10, ULA, IPv6 link-local fe80::/10); metadata
 *                        is a subset of private so also blocked.
 *
 * Upstream #3313 closes the DNS-rebinding ceiling: active guard modes install
 * an Undici dispatcher whose lookup validates every answer used by the socket.
 * Its connector also validates IP literals because Node skips lookup for them.
 *
 * Precedence for {@link getProviderValidationGuard}:
 *   1. `OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS` truthy → "none".
 *   2. `OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS` not false (default ON) → "block-metadata".
 *   3. else → "public-only".
 *
 * Cloud-metadata / link-local is never a legitimate provider endpoint, so it is
 * blocked whenever a guard mode is active ("block-metadata" / "public-only").
 * Under the explicit full opt-in (mode "none") the operator has chosen to
 * trust the target and ALL checks — including the metadata block — are skipped;
 * do not read "default" behavior as a guarantee once "none" is selected.
 */
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, buildConnector } from "undici";
import {
  PRIVATE_PROVIDER_URLS_ENV,
  LOCAL_PROVIDER_URLS_ENV,
  MEMORY_CONFIG,
  getProviderValidationGuard,
} from "../config/runtimeConfig.js";

export const PROVIDER_URL_BLOCKED_MESSAGE = "Blocked private or local provider URL";
export const CLOUD_METADATA_BLOCKED_MESSAGE = "Blocked cloud-metadata endpoint";
export { PRIVATE_PROVIDER_URLS_ENV, LOCAL_PROVIDER_URLS_ENV, getProviderValidationGuard };

function normalizeHost(hostname) {
  let normalized = String(hostname || "").trim().toLowerCase();
  // Trailing DNS dot makes an absolute FQDN (e.g. "metadata.google.internal.")
  // and is preserved by the WHATWG URL parser; without stripping it the exact
  // Set match in isCloudMetadataHost() misses and metadata probes slip through.
  while (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function ipv6ToWords(host) {
  const raw = normalizeHost(host);
  if (!raw || raw.includes("%")) return null;

  let canonical;
  try {
    canonical = new URL(`http://[${raw}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const halves = canonical.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const parts = halves.length === 2
    ? [...left, ...Array(missing).fill("0"), ...right]
    : left;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

function wordsToIpv4(words) {
  const value = ((words[6] << 16) | words[7]) >>> 0;
  return `${value >>> 24}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

function embeddedIpv4Address(host, includeCompatible = false) {
  const words = ipv6ToWords(host);
  if (!words || !words.slice(0, 5).every((word) => word === 0)) return null;
  if (words[5] === 0xffff || (includeCompatible && words[5] === 0)) return wordsToIpv4(words);
  return null;
}

export function isPrivateHost(hostname) {
  const normalized = normalizeHost(hostname);
  if (!normalized) return true;

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  ) {
    return true;
  }

  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map((s) => parseInt(s, 10));
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (isIP(normalized) === 6) {
    const words = ipv6ToWords(normalized);
    if (!words) return true;
    if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
      return isPrivateHost(wordsToIpv4(words));
    }
    // Unspecified, loopback, and deprecated IPv4-compatible IPv6 (::/96).
    if (words.slice(0, 6).every((word) => word === 0)) return true;
    const first = words[0];
    return (
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xffc0) === 0xfec0 ||
      (first & 0xff00) === 0xff00 ||
      (first === 0x2001 && words[1] === 0x0db8)
    );
  }

  return false;
}

const CLOUD_METADATA_HOSTNAMES = new Set([
  "169.254.169.254", // AWS / GCP / Azure / Oracle IMDS
  "metadata.google.internal", // GCP
  "metadata.goog", // GCP
  "100.100.100.200", // Alibaba Cloud
  "fd00:ec2::254", // AWS IPv6 IMDS
]);


/**
 * Cloud-metadata and IPv4 link-local (169.254.0.0/16) endpoints — the classic
 * SSRF→IAM-credential pivot. Blocked unconditionally by the validation guard.
 */
export function isCloudMetadataHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host) return false;
  if (CLOUD_METADATA_HOSTNAMES.has(host)) return true;
  const embeddedIpv4 = embeddedIpv4Address(host, true);
  if (embeddedIpv4 && isCloudMetadataHost(embeddedIpv4)) return true;
  if (host.startsWith("169.254.")) return true; // IPv4 link-local /16
  return false;
}

function resolvedAddressError(address, message) {
  return new OutboundUrlGuardError(message, {
    code: "OUTBOUND_URL_GUARD_BLOCKED",
    url: String(address),
    hostname: String(address),
  });
}

/**
 * Validate one DNS/socket address using the selected provider URL policy.
 * Ordinary LAN results stay valid in `block-metadata`; upstream #3313 only
 * closes metadata rebinding there, while `public-only` rejects all private IPs.
 */
export function assertResolvedAddressAllowed(address, guard) {
  if (guard === "none") return;
  if (!isIP(address)) {
    throw resolvedAddressError(address, "Blocked invalid DNS address");
  }
  if (guard === "block-metadata" ? isCloudMetadataHost(address) : isPrivateHost(address)) {
    throw resolvedAddressError(
      address,
      guard === "block-metadata" ? CLOUD_METADATA_BLOCKED_MESSAGE : PROVIDER_URL_BLOCKED_MESSAGE,
    );
  }
}

/**
 * Build a Node-compatible lookup that validates every DNS answer before Undici
 * can connect. Requesting all records once also pins the validated result set
 * to this connection attempt, preventing a second DNS lookup from rebinding.
 */
export function createOutboundUrlLookup(guard, lookup = dnsLookup) {
  return (hostname, options, callback) => {
    const requestedAll = options?.all === true;
    lookup(hostname, { ...options, all: true, verbatim: true }, (error, records, family) => {
      if (error) return callback(error);
      const addresses = Array.isArray(records) ? records : [{ address: records, family }];
      try {
        if (!addresses.length) throw resolvedAddressError(hostname, "Blocked empty DNS result");
        for (const record of addresses) assertResolvedAddressAllowed(record.address, guard);
      } catch (validationError) {
        return callback(validationError);
      }
      if (requestedAll) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/**
 * Build the upstream #3313 transport boundary. Connector validation covers IP
 * literals (including redirect destinations), for which Node bypasses lookup.
 */
export function createOutboundUrlConnector(guard, lookup = dnsLookup) {
  const connect = buildConnector({ lookup: createOutboundUrlLookup(guard, lookup) });
  return (options, callback) => {
    try {
      if (isIP(normalizeHost(options.hostname))) {
        assertResolvedAddressAllowed(normalizeHost(options.hostname), guard);
      }
    } catch (error) {
      queueMicrotask(() => callback(error));
      return;
    }
    return connect(options, callback);
  };
}

const guardedDispatchers = new Map();
const guardedProbeDispatchers = new WeakMap();
export const GUARDED_PROBE_MAX_ORIGINS = MEMORY_CONFIG.proxyDispatchersMaxSize;

/** Module-private dispatcher identity plus its immutable guard mode. */
export function isGuardedProbeDispatcher(dispatcher) {
  return guardedProbeDispatchers.has(dispatcher);
}

/** Validate MITM-bypass DNS answers under the dispatcher that authorized them. */
export function assertGuardedProbeDispatcherAddressAllowed(dispatcher, address) {
  const guard = guardedProbeDispatchers.get(dispatcher);
  if (!guard) throw new TypeError("Dispatcher is not an outbound URL guard");
  assertResolvedAddressAllowed(address, guard);
}

export function createGuardedProbeDispatcher(guard, lookup = dnsLookup, options = {}) {
  const dispatcher = new Agent({
    ...options,
    maxOrigins: GUARDED_PROBE_MAX_ORIGINS,
    connect: createOutboundUrlConnector(guard, lookup),
  });
  guardedProbeDispatchers.set(dispatcher, guard);
  return dispatcher;
}

function getGuardedDispatcher(guard) {
  if (guard === "none") return null;
  if (!guardedDispatchers.has(guard)) {
    guardedDispatchers.set(guard, createGuardedProbeDispatcher(guard));
  }
  return guardedDispatchers.get(guard);
}

export class OutboundUrlGuardError extends Error {
  constructor(message, init) {
    super(message);
    this.name = "OutboundUrlGuardError";
    this.code = init.code; // "OUTBOUND_URL_GUARD_BLOCKED" | "OUTBOUND_URL_INVALID"
    this.url = init.url;
    this.hostname = init.hostname ?? null;
  }
}

export function parseOutboundUrl(input) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(String(input));
  } catch {
    throw new OutboundUrlGuardError(`Invalid outbound URL: ${String(input)}`, {
      code: "OUTBOUND_URL_INVALID",
      url: String(input),
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OutboundUrlGuardError(`Invalid outbound URL protocol for ${url.toString()}`, {
      code: "OUTBOUND_URL_INVALID",
      url: url.toString(),
      hostname: url.hostname || null,
    });
  }

  if (url.username || url.password) {
    throw new OutboundUrlGuardError("Blocked outbound URL with embedded credentials", {
      code: "OUTBOUND_URL_GUARD_BLOCKED",
      url: url.toString(),
      hostname: url.hostname || null,
    });
  }

  return url;
}

/**
 * Validate an outbound validation URL against a guard mode. Throws
 * {@link OutboundUrlGuardError} on rejection; returns the parsed URL otherwise.
 * Used to validate BOTH the initial probe URL and any fallback URL BEFORE a
 * socket is opened, and to reject 3xx redirects (caller must set redirect:"manual").
 *
 * Mode semantics mirror OmniRoute `applyUrlGuard` exactly:
 *   - "none"           → no check (explicit full opt-in trusts the operator).
 *   - "block-metadata" → only cloud-metadata / IPv4 link-local rejected (default).
 *   - "public-only"    → every private/LAN host rejected.
 *
 * The guard mode itself is resolved in `open-sse/config/runtimeConfig.js`
 * ({@link getProviderValidationGuard}) — single owner of env parsing + policy.
 *
 * @param {string|URL} input
 * @param {"none"|"public-only"|"block-metadata"} [guard]
 * @returns {URL}
 */
export function assertOutboundUrlAllowed(input, guard = getProviderValidationGuard()) {
  const url = parseOutboundUrl(input);
  if (guard === "none") return url;

  if (guard === "block-metadata") {
    if (isCloudMetadataHost(url.hostname)) {
      throw new OutboundUrlGuardError(CLOUD_METADATA_BLOCKED_MESSAGE, {
        code: "OUTBOUND_URL_GUARD_BLOCKED",
        url: url.toString(),
        hostname: url.hostname || null,
      });
    }
    return url;
  }

  // "public-only"
  if (isPrivateHost(url.hostname)) {
    throw new OutboundUrlGuardError(PROVIDER_URL_BLOCKED_MESSAGE, {
      code: "OUTBOUND_URL_GUARD_BLOCKED",
      url: url.toString(),
      hostname: url.hostname || null,
    });
  }
  return url;
}

/**
 * Guarded fetch wrapper for provider-validation probes. Validates the URL
 * before opening a socket, then pins connection-time DNS answers through an
 * Undici dispatcher (upstream #3313). `redirect: "manual"` prevents automatic
 * redirect dispatch; connector validation also rejects blocked IP literals.
 * Undici wraps connector failures in `TypeError.cause`; this wrapper restores
 * {@link OutboundUrlGuardError} so existing probe callers keep mapping blocks.
 *
 * `fetcher` is injectable for tests; defaults to global `fetch`.
 *
 * @param {string|URL} url
 * @param {RequestInit} [init]
 * @param {"none"|"public-only"|"block-metadata"} [guard]
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<Response>}
 */
export function guardedProbeFetch(url, init = {}, guard = getProviderValidationGuard(), fetcher = fetch) {
  assertOutboundUrlAllowed(url, guard);
  const dispatcher = getGuardedDispatcher(guard);
  return fetcher(url, { ...init, ...(dispatcher ? { dispatcher } : {}), redirect: "manual" })
    .catch((error) => {
      if (error?.cause instanceof OutboundUrlGuardError) throw error.cause;
      throw error;
    });
}
