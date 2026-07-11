// HTTP status codes
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// Re-export error config (backward compat)
export { ERROR_TYPES, DEFAULT_ERROR_MESSAGES, BACKOFF_CONFIG, COOLDOWN_MS } from "./errorConfig.js";

// Realtime WebSocket resource limits. Source-of-truth constants live here on the
// documented config surface; the VALUES are backed by the CJS module
// `src/shared/utils/realtimeConfig.js` so bare-Node CJS consumers
// (`custom-server.js`, `realtimeCore.js`) read the identical numbers without
// importing ESM. Edit the CJS module to change a limit — this re-export tracks it.
import realtimeLimits from "../../src/shared/utils/realtimeConfig.js";
export const MAX_SESSION_ITEMS = realtimeLimits.MAX_SESSION_ITEMS;
export const MAX_REALTIME_FRAME_BYTES = realtimeLimits.MAX_REALTIME_FRAME_BYTES;

// Cache TTLs (seconds)
export const CACHE_TTL = {
  userInfo: 300,    // 5 minutes
  modelAlias: 3600  // 1 hour
};

// Memory management config
export const MEMORY_CONFIG = {
  sessionTtlMs: 2 * 60 * 60 * 1000,
  sessionCleanupIntervalMs: 30 * 60 * 1000,
  dnsCacheTtlMs: 5 * 60 * 1000,
  proxyDispatchersMaxSize: 20,
  refreshDedupMaxSize: 256,
  refreshDedupInFlightTtlMs: 2 * 60 * 1000,
  refreshDedupResultTtlMs: 10 * 1000,
};

// Parse a positive integer env override, falling back to a default.
function envMs(name, def) {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

/**
 * Read a trimmed string env override, falling back to a default when the
 * variable is unset, empty, or whitespace-only.
 *
 * @param {string} name - Environment variable name.
 * @param {string} def - Default value used when the env var is blank.
 * @returns {string} Trimmed env value or `def`.
 */
function envUrl(name, def) {
  const raw = process.env[name]?.trim();
  return raw || def;
}

/**
 * Endpoint used by the built-in unauthenticated SearXNG web-search provider.
 *
 * Resolved once at module load from the `SEARXNG_URL` env var (trimmed); falls
 * back to the loopback default when unset/blank. Set this to point at a
 * separate Docker service or remote SearXNG instance.
 *
 * @type {string}
 */
export const SEARXNG_URL = envUrl("SEARXNG_URL", "http://localhost:8888/search");

// Inter-chunk stall timeout (once tokens are flowing). Generous headroom so
// slow reasoning models aren't aborted mid-stream. Env: STREAM_STALL_TIMEOUT_MS.
export const STREAM_STALL_TIMEOUT_MS = envMs("STREAM_STALL_TIMEOUT_MS", 360 * 1000);

// Time-to-first-token timeout (prompt prefill). Env: STREAM_FIRST_CHUNK_TIMEOUT_MS.
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = envMs("STREAM_FIRST_CHUNK_TIMEOUT_MS", 200 * 1000);

// Fetch connect timeout: abort if upstream doesn't return response headers within this duration
export const FETCH_CONNECT_TIMEOUT_MS = envMs("FETCH_CONNECT_TIMEOUT_MS", 60 * 1000);

// Complete-body bounds for successful non-streaming responses and forced
// stream-to-JSON conversion. These prevent a provider-controlled body from
// holding a concurrency slot forever or growing memory without limit.
export const PROVIDER_BODY_TIMEOUT_MS = envMs("PROVIDER_BODY_TIMEOUT_MS", 120 * 1000);
export const MAX_PROVIDER_BODY_BYTES = envMs("MAX_PROVIDER_BODY_BYTES", 8 * 1024 * 1024);
export const MAX_RESPONSES_OUTPUT_ITEMS = envMs("MAX_RESPONSES_OUTPUT_ITEMS", 1024);

// Gemini native TTS fetch timeout: abort if Google does not return response headers in time.
export const GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS = envMs("GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS", 45 * 1000);

// Default token limits
export const DEFAULT_MAX_TOKENS = 64000;
export const DEFAULT_MIN_TOKENS = 32000;

// Retry config for 429 responses (legacy - kept for backward compatibility)
export const RETRY_CONFIG = {
  maxAttempts: 2,
  delayMs: 2000
};

// Default retry config by status code: { attempts, delayMs }
// Backward compat: if value is a number, treated as attempts with RETRY_CONFIG.delayMs
export const DEFAULT_RETRY_CONFIG = {
  429: { attempts: 0, delayMs: 0 },
  502: { attempts: 3, delayMs: 3000 },
  503: { attempts: 3, delayMs: 2000 },
  504: { attempts: 2, delayMs: 3000 }
};

// Normalize a retry entry to { attempts, delayMs }
export function resolveRetryEntry(entry) {
  if (entry == null) return { attempts: 0, delayMs: RETRY_CONFIG.delayMs };
  if (typeof entry === "number") return { attempts: entry, delayMs: RETRY_CONFIG.delayMs };
  return {
    attempts: entry.attempts || 0,
    delayMs: entry.delayMs != null ? entry.delayMs : RETRY_CONFIG.delayMs
  };
}

// Outbound payload validation gate. Set VALIDATE_OUTBOUND=false to disable
// the gate in an emergency (keys are still stripped).
export const VALIDATE_OUTBOUND = process.env.VALIDATE_OUTBOUND !== "false";

// ─── SSRF guard for provider VALIDATION probes (OmniRoute #6542) ────────────
// Env var names, defaults, and mode selection copied verbatim from OmniRoute
// `src/shared/network/outboundUrlGuard.ts` — only the DB-backed feature-flag
// source is dropped (DurinDoor has no `resolveFeatureFlag`; env-only here).
// Local-first default: validation allows LAN/localhost providers but ALWAYS
// blocks cloud-metadata / link-local endpoints (SSRF→IAM-credential pivot).
export const PRIVATE_PROVIDER_URLS_ENV = "OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS";
export const LOCAL_PROVIDER_URLS_ENV = "OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS";

const _TRUE_ENV = new Set(["1", "true", "yes", "on"]);
function _isTrueEnv(raw) {
  return typeof raw === "string" && _TRUE_ENV.has(raw.trim().toLowerCase());
}

// Full opt-out: allow every private URL (and legacy OUTBOUND_SSRF_GUARD_ENABLED=false
// implies disabling the guard). Power users only. Exported (matches source).
export function arePrivateProviderUrlsAllowed() {
  if (_isTrueEnv(process.env[PRIVATE_PROVIDER_URLS_ENV])) return true;
  const legacy = process.env.OUTBOUND_SSRF_GUARD_ENABLED;
  if (typeof legacy === "string" && ["false", "0", "no", "off"].includes(legacy.trim().toLowerCase())) {
    return true;
  }
  return false;
}

// Local-first default ON: allow LAN/localhost providers. Note: under mode
// "none" (full opt-in) the guard skips ALL checks including metadata — that is
// the operator's explicit trust decision. Metadata is only unconditionally
// blocked while a guard mode is active. Exported (matches source).
export function areLocalProviderUrlsAllowed() {
  const v = process.env[LOCAL_PROVIDER_URLS_ENV];
  if (typeof v === "string" && v !== "") return _isTrueEnv(v);
  return true;
}

/**
 * Guard mode for the provider VALIDATION path.
 *   1. explicit full opt-in → "none" (no checks).
 *   2. local-first default  → "block-metadata" (allow LAN, block IMDS).
 *   3. otherwise            → "public-only" (strict).
 * @returns {"none"|"public-only"|"block-metadata"}
 */
export function getProviderValidationGuard() {
  if (arePrivateProviderUrlsAllowed()) return "none";
  if (areLocalProviderUrlsAllowed()) return "block-metadata";
  return "public-only";
}

// Requests containing these texts will bypass provider
export const SKIP_PATTERNS = [
  "Please write a 5-10 word title for the following conversation:"
];
