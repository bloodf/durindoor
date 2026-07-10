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
 * Block matrix by mode (hostname-string classification only — see DNS ceiling):
 *   - "none"           → NOTHING blocked except protocol / embedded-credential
 *                        checks in parseOutboundUrl (operator explicitly trusts
 *                        the target; metadata is intentionally NOT blocked).
 *   - "block-metadata" → cloud-metadata hostnames + IPv4 link-local
 *                        (169.254.0.0/16) blocked; LAN/loopback allowed.
 *   - "public-only"    → every private/LAN host blocked (RFC1918, loopback,
 *                        100.64/10, ULA, IPv6 link-local fe80::/10); metadata
 *                        is a subset of private so also blocked.
 *
 * Documented ceiling (parity with OmniRoute source — do NOT "fix" here): the
 * guard classifies the URL hostname STRING. It does not resolve DNS, so a
 * public name that resolves to 127.0.0.1 / RFC1918 / a metadata IP at connect
 * time (DNS rebinding) bypasses this layer. IPv6 link-local (fe80::/10) is
 * covered only in public-only mode (via isPrivateHost), not in block-metadata
 * mode, matching upstream isCloudMetadataHost which lists IPv4 link-local only.
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
import { isIP } from "node:net";
import {
  PRIVATE_PROVIDER_URLS_ENV,
  LOCAL_PROVIDER_URLS_ENV,
  getProviderValidationGuard,
} from "../config/runtimeConfig.js";

export const PROVIDER_URL_BLOCKED_MESSAGE = "Blocked private or local provider URL";
export const CLOUD_METADATA_BLOCKED_MESSAGE = "Blocked cloud-metadata endpoint";
export { PRIVATE_PROVIDER_URLS_ENV, LOCAL_PROVIDER_URLS_ENV, getProviderValidationGuard };

function normalizeHost(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

export function isPrivateHost(hostname) {
  const normalized = normalizeHost(hostname);
  if (!normalized) return true;

  if (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.startsWith("::ffff:")
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
    const firstHextet = Number.parseInt(normalized.split(":", 1)[0], 16);
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      // IPv6 link-local is fe80::/10, i.e. first hextet in [fe80..febf].
      // `startsWith("fe80:")` would only cover fe80::/16 and let fe81..febf
      // slip through; mask the top 10 bits instead.
      (Number.isFinite(firstHextet) && (firstHextet & 0xffc0) === 0xfe80)
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
  if (host.startsWith("169.254.")) return true; // IPv4 link-local /16
  return false;
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
 * against the current guard mode BEFORE the socket opens, and forces
 * `redirect: "manual"` so a 3xx cannot bounce the probe to cloud-metadata
 * past the initial-URL check. Throws {@link OutboundUrlGuardError} on block.
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
  return fetcher(url, { ...init, redirect: "manual" });
}
