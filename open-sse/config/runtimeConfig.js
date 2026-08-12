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
  GATEWAY_TIMEOUT: 504,
  INSUFFICIENT_STORAGE: 507
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

// Client opt-out for reasoning_content on non-streaming responses.
export const REASONING_HEADER = "x-9router-reasoning";

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

// Per-model timeout for combo fallback. When > 0, each model in a combo
// gets at most this many ms before the combo falls to the next model.
// 0 = disabled (use fetch connect timeout + retries). Env: COMBO_MODEL_TIMEOUT_MS.
export const COMBO_MODEL_TIMEOUT_MS = envMs("COMBO_MODEL_TIMEOUT_MS", 0);

// Fetch connect timeout: abort if upstream doesn't return response headers within this duration
export const FETCH_CONNECT_TIMEOUT_MS = envMs("FETCH_CONNECT_TIMEOUT_MS", 60 * 1000);

// Complete-body bounds for successful non-streaming responses and forced
// stream-to-JSON conversion. These prevent a provider-controlled body from
// holding a concurrency slot forever or growing memory without limit.
export const PROVIDER_BODY_TIMEOUT_MS = envMs("PROVIDER_BODY_TIMEOUT_MS", 120 * 1000);
export const RESPONSE_BODY_TIMEOUT_MS = envMs("RESPONSE_BODY_TIMEOUT_MS", 120 * 1000);
export const MAX_PROVIDER_BODY_BYTES = envMs("MAX_PROVIDER_BODY_BYTES", 8 * 1024 * 1024);
export const MAX_RESPONSES_OUTPUT_ITEMS = envMs("MAX_RESPONSES_OUTPUT_ITEMS", 1024);

// Codex inspects a short SSE prefix before handing the body to chatCore. Bound
// the entire peek (not each chunk) so keepalive/preamble bytes cannot outlive a
// quota lease. The five-minute ceiling remains below the default lease.
export const CODEX_SSE_PEEK_TIMEOUT_MS = Math.min(
  envMs("CODEX_SSE_PEEK_TIMEOUT_MS", 30 * 1000),
  5 * 60 * 1000,
);

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

// ─── Provider skip-error rules + transport retry policy (9router #2588) ─────
// A skip-rule is { provider, match: { kind?, status?, contains? }, action } with
// action "skip" | "retry". match conditions are ANDed; an empty match never
// matches (avoids skip-all). Rules are evaluated in ARRAY ORDER, first match
// wins. The policy arrives via the upstream execute() argument `requestPolicy`;
// with NO policy (requestPolicy == null) the executor resolves
// { maxTransportAttempts: null, skipRules: null } and behavior is byte-identical
// to the pre-port code (DEFAULT_RETRY_CONFIG attempts, no body reads).
// DEFAULT_MAX_TRANSPORT_ATTEMPTS / DEFAULT_PROVIDER_SKIP_RULES are the values a
// caller (settings layer) injects to reproduce upstream production behavior;
// the executor never auto-applies them.
//
// Attempts table (in-place retries on the same base URL, per failure):
//   rule skip       → 0  (HTTP: return the response; exception: rethrow it)
//   rule retry      → maxTransportAttempts - 1 (overrides DEFAULT_RETRY_CONFIG)
//   no rule         → min(DEFAULT_RETRY_CONFIG[status].attempts, maxTransportAttempts - 1)
//   connect_timeout → 0 unless an explicit retry rule matches it
// maxTransportAttempts counts the FIRST try, so retries = cap - 1.

// Upstream settings defaults (caller-injected, e.g. upstream chat.js). Exported
// for the settings/caller layer; NOT auto-applied by the executor.
export const DEFAULT_MAX_TRANSPORT_ATTEMPTS = 2;
export const DEFAULT_PROVIDER_SKIP_RULES = [
  // The legacy Antigravity capacity skip ships as an ordinary seeded rule the
  // user can edit/delete. `sweep` asks the account loop to re-try the whole
  // pool after exhausting it (momentary saturation recovery).
  { provider: "antigravity", match: { status: 503, contains: "capacity" }, action: "skip", sweep: true },
];

/**
 * Find the FIRST rule (array order) matching this failure for `provider`, and
 * return the rule object itself (not a derived shape) — or null. Every present
 * match condition must hold (AND); at least one usable condition is required
 * (an empty match never matches — avoids skip-all); the action must be a known
 * value ("skip" | "retry") — a malformed rule never matches, so it cannot
 * shadow a later valid rule.
 * @param {string} provider
 * @param {{status?: number|string, errorKind?: string, text?: string}} failure
 * @param {Array} skipRules
 * @returns {object|null} the matching rule object, or null
 */
export function findMatchingSkipRule(provider, failure = {}, skipRules = []) {
  if (!Array.isArray(skipRules)) return null;
  const status = failure.status != null ? Number(failure.status) : null;
  const errorKind = failure.errorKind || null;
  const text = typeof failure.text === "string" ? failure.text.toLowerCase() : "";

  for (const r of skipRules) {
    if (!r || r.provider !== provider || !r.match) continue;
    if (r.action !== "skip" && r.action !== "retry") continue;
    const m = r.match;
    let has = false;
    if (m.kind != null) {
      has = true;
      if (errorKind == null || m.kind !== errorKind) continue;
    }
    if (m.status != null) {
      has = true;
      if (status == null || Number(m.status) !== status) continue;
    }
    if (m.contains != null && m.contains !== "") {
      has = true;
      if (!text.includes(String(m.contains).toLowerCase())) continue;
    }
    if (has) return r;
  }
  return null;
}

/**
 * Match a skip-rule against a failure, preserving the full rule shape. Unlike
 * findMatchingSkipRule (raw rule), this returns the derived decision the
 * transport + account layers act on: { action, headerTimeoutMs?, sweep? }.
 * `sweep` is only meaningful for skip rules — it asks the account loop to
 * re-try the whole pool after exhausting it (momentary saturation recovery).
 * @param {string} provider
 * @param {{status?: number|string, errorKind?: string, text?: string}} failure
 * @param {Array} rules
 * @returns {{action: "skip"|"retry", headerTimeoutMs?: number, sweep?: boolean}|null}
 */
export function matchSkipRule(provider, failure = {}, rules = []) {
  const r = findMatchingSkipRule(provider, failure, rules);
  if (!r) return null;
  const out = { action: r.action };
  if (r.headerTimeoutMs != null) out.headerTimeoutMs = r.headerTimeoutMs;
  if (r.action === "skip" && r.sweep === true) out.sweep = true;
  return out;
}

/**
 * Resolve the connect/header timeout for one request BEFORE any attempt runs.
 * Upstream scans this provider's rules for a connect_timeout rule that sets an
 * explicit headerTimeoutMs — first match in array order wins. This is read from
 * rule CONFIG (not a live failure), so the timer is armed before the fetch.
 * Returns null when no such rule exists (caller falls back to its own timeout).
 */
export function resolveProviderHeaderTimeout(provider, skipRules = []) {
  if (!Array.isArray(skipRules)) return null;
  for (const r of skipRules) {
    if (!r || r.provider !== provider) continue;
    if (r.match?.kind === "connect_timeout" && r.headerTimeoutMs != null) {
      return r.headerTimeoutMs;
    }
  }
  return null;
}

/**
 * Resolve the effective retry policy for one execute() call from the upstream
 * `requestPolicy` argument. No policy → { maxTransportAttempts: null,
 * skipRules: null, headerTimeoutMs: null, hasContainsRule: false }, i.e. the
 * pre-port retry behavior with zero body reads and no cap.
 */
export function resolveRequestRetryPolicy(provider, requestPolicy = null) {
  if (requestPolicy == null) {
    return { maxTransportAttempts: null, skipRules: null, headerTimeoutMs: null, hasContainsRule: false };
  }
  const rawCap = requestPolicy.maxTransportAttempts;
  const maxTransportAttempts = Number.isInteger(rawCap) && rawCap >= 1 ? rawCap : null;
  const skipRules = Array.isArray(requestPolicy.skipRules) ? requestPolicy.skipRules : null;
  // Header timeout precedence: an explicit policy-level value wins; otherwise a
  // connect_timeout rule's headerTimeoutMs (rule config, resolved pre-attempt).
  const headerTimeoutMs = requestPolicy.headerTimeoutMs || resolveProviderHeaderTimeout(provider, skipRules) || null;
  // Whether any rule for THIS provider matches on error body text. Only then
  // does the transport tier pay to clone+read an error response body.
  const hasContainsRule = Array.isArray(skipRules) && skipRules.some(
    r => r && r.provider === provider && r.match?.contains != null && r.match?.contains !== ""
  );
  return { maxTransportAttempts, skipRules, headerTimeoutMs, hasContainsRule };
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
