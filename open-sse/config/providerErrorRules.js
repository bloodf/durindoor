/**
 * Provider-specific error markers that do not fit the shared status rules.
 * Each rule's `scope` is forwarded into fallback locking:
 *   - "connection" forces an account-wide lock (`modelLock___all`)
 *   - "model"     locks the requested model only
 * `cooldownMs` (when set) overrides the generic backoff ladder.
 * `terminal` (when set) marks a state retrying cannot fix, so callers must not
 * advertise a client-facing Retry-After for it.
 *
 * Rule body matching inspects the structured upstream error envelope only:
 * the `error` object (`message`, `type`, `code`, `metadata` keys) plus
 * provider-shaped top-level hints. The whole response body, the request
 * body, and any user prompt are NEVER concatenated here — that would
 * let a provider echo a malicious prompt bypass the markers.
 *
 * `errorText` is the sanitized upstream message (the same string the shared
 * ERROR_RULES text rules match on), handed to a rule that cannot read the
 * envelope: executors that do not override `parseError` leave the parsed
 * body undefined, so an envelope-only rule would never see the marker.
 */
import { isFunction, isObject, isString } from "../../src/shared/utils/typeChecks.js";
const MAX_ERROR_ENVELOPE_BYTES = 8_192;

function readErrorEnvelope(body) {
  if (body == null) return null;
  if (isString(body)) {
    const trimmed = body.slice(0, MAX_ERROR_ENVELOPE_BYTES);
    try {return readErrorEnvelope(JSON.parse(trimmed));} catch {return null;}
  }
  if (!isObject(body)) return null;
  if (body.error && isObject(body.error)) return body.error;
  if (body.data?.error && isObject(body.data.error)) return body.data.error;
  return null;
}

function envelopeString(envelope, key) {
  if (!envelope) return "";
  const value = envelope[key];
  return isString(value) ? value : "";
}

function envelopeCodeString(envelope) {
  if (!envelope) return "";
  if (isString(envelope.code)) return envelope.code;
  if (envelope.code && isObject(envelope.code) && isString(envelope.code.value)) {
    return envelope.code.value;
  }
  return "";
}

export function inspectProviderErrorEnvelope(body) {
  const envelope = readErrorEnvelope(body);
  if (!envelope) {
    return { envelope: null, message: "", type: "", code: "" };
  }
  return {
    envelope,
    message: envelopeString(envelope, "message"),
    type: envelopeString(envelope, "type"),
    code: envelopeCodeString(envelope)
  };
}

function buildAgentrouterRules() {
  const QUOTA_TEXT = "额度不足";
  const MODEL_DENIAL_TEXT = "无权访问模型";
  return [
  {
    id: "agentrouter-user-quota-exhausted",
    match: ({ status, body }) => {
      if (status !== 400 && status !== 403 && status !== 429) return null;
      const { message, type, code } = inspectProviderErrorEnvelope(body);
      if (message.includes(MODEL_DENIAL_TEXT)) return null;
      if (!message.includes(QUOTA_TEXT)) return null;
      if (type && type !== "quota_exhausted" && type !== "insufficient_user_quota") return null;
      if (code && code !== "quota_exhausted" && code !== "insufficient_user_quota") return null;
      return { reason: "quota_exhausted", scope: "connection" };
    }
  },
  {
    id: "agentrouter-model-access-denied",
    match: ({ status, body }) => {
      if (status !== 403) return null;
      const { message, type, code } = inspectProviderErrorEnvelope(body);
      if (!message.includes(MODEL_DENIAL_TEXT)) return null;
      if (type && type !== "auth_error" && type !== "permission_denied") return null;
      if (code && code !== "auth_error" && code !== "permission_denied") return null;
      return { reason: "auth_error", scope: "model", cooldownMs: 6 * 60 * 60 * 1000 };
    }
  }];

}

/**
 * Y-API (bestvirtualgoods.com) error contract.
 *
 * The provider's own error reference (https://y-api.bestvirtualgoods.com/docs/errors,
 * inspected 2026-11-20) states that the status code is the part that lies and
 * `error.code` carries the real reason. Three cases need their own handling:
 *
 *  - 403 `insufficient_user_quota`  — the account balance reached zero. The terms
 *    (https://y-api.bestvirtualgoods.com/terms §3) promise that a top-up restores
 *    access immediately and the key stays valid, so the connection is benched for
 *    quota, not invalidated. Distinct from 429 throttling, which is transient and
 *    recovers on its own.
 *  - 403 `pre_consume_token_quota_failed` — the account still has credit but this
 *    one key hit its per-key cap. Same recovery story at key scope: the cap is
 *    raised in the console, so the connection is benched for quota.
 *  - 503 `model_not_found` — the model id is not in the catalog. It is reported as
 *    a server error, but nothing is down and no amount of retrying fixes it, so the
 *    lock is scoped to the requested model instead of the connection.
 *
 * A 401 (`Invalid token`, empty `error.code`) is deliberately NOT listed here: it
 * means the key does not exist or was revoked, and the shared status rules already
 * treat it as an authentication failure.
 */
function buildYApiRules() {
  const QUOTA_CODES = new Set(["insufficient_user_quota", "pre_consume_token_quota_failed"]);
  return [
  {
    id: "y-api-user-quota-exhausted",
    match: ({ status, body }) => {
      if (status !== 403) return null;
      const { type, code } = inspectProviderErrorEnvelope(body);
      if (!QUOTA_CODES.has(code) && !QUOTA_CODES.has(type)) return null;
      return { reason: "quota_exhausted", scope: "connection" };
    }
  },
  {
    id: "y-api-model-not-found",
    match: ({ status, body }) => {
      if (status !== 503) return null;
      const { type, code } = inspectProviderErrorEnvelope(body);
      if (code !== "model_not_found" && type !== "model_not_found") return null;
      return { scope: "model", cooldownMs: 15 * 60 * 1000 };
    }
  }];

}

/**
 * Gisoo (https://gisoo.pro) — prepaid relay, OpenAI-compatible `/api/v1`.
 *
 * The upstream documents three distinct failure classes, and they need
 * different handling:
 *
 *   - 401 — the key is missing, malformed, revoked or expired. The credential
 *     itself is at fault: bench the whole connection briefly and let the
 *     fallback engine try another key. Not terminal — a replacement key fixes
 *     it.
 *   - 402 — the account's credit is empty, or the key/project/day spend cap is
 *     reached. Retrying cannot help: bench the connection for a day (the cap
 *     is a daily one) and mark it terminal so no Retry-After is advertised.
 *   - 403 — the key may not use this model or this IP, OR identity
 *     verification is required. Only the second one is a KYC state: the
 *     account spent past the $2 pre-verification allowance and the identity
 *     must be verified in the Gisoo app. It is terminal and daily-scoped, like
 *     the credit state but with a different remedy. A 403 without a KYC marker
 *     stays a plain model/IP denial and falls through to the shared rules.
 *
 * Upstream contract: https://gisoo.pro/api/v1/openapi.json — 401 "the key is
 * missing, invalid, revoked or expired", 402 "insufficient credit or the
 * key/project/day spend cap is reached", 403 "this key is not allowed for this
 * model or this IP, or identity verification is required".
 */
const GISOO_DAILY_PROBE_MS = 24 * 60 * 60 * 1000;

function buildGisooRules() {
  const KYC_CODES = new Set(["kyc_required", "identity_verification_required", "verification_required"]);
  const CREDIT_CODES = new Set(["insufficient_credit", "insufficient_quota", "billing_hard_limit_reached", "credit_balance_too_low"]);
  const AUTH_CODES = new Set(["invalid_api_key", "missing_api_key", "api_key_revoked", "api_key_expired"]);
  // The relay is Persian-first, so the identity-verification marker can arrive
  // in either language. Matched on the sanitized upstream message only.
  const KYC_TEXT = /kyc|identity verification|verify your identity|احراز هویت/i;
  return [
  {
    id: "gisoo-kyc-required",
    match: ({ status, body, errorText }) => {
      if (status !== 403) return null;
      const { message, code } = inspectProviderErrorEnvelope(body);
      if (!KYC_CODES.has(code) && !KYC_TEXT.test(message) && !KYC_TEXT.test(errorText || "")) return null;
      return { reason: "kyc_required", scope: "connection", cooldownMs: GISOO_DAILY_PROBE_MS, terminal: true };
    }
  },
  {
    id: "gisoo-insufficient-credit",
    match: ({ status, body }) => {
      if (status !== 402) return null;
      const { code } = inspectProviderErrorEnvelope(body);
      if (code && !CREDIT_CODES.has(code)) return null;
      return { reason: "insufficient_credit", scope: "connection", cooldownMs: GISOO_DAILY_PROBE_MS, terminal: true };
    }
  },
  {
    id: "gisoo-invalid-api-key",
    match: ({ status, body }) => {
      if (status !== 401) return null;
      const { code } = inspectProviderErrorEnvelope(body);
      if (code && !AUTH_CODES.has(code)) return null;
      return { reason: "auth_error", scope: "connection", cooldownMs: 2 * 60 * 1000 };
    }
  }];
}

/**
 * Kilo (OmniRoute #21082). A caller without an entitled account that asks for a
 * paid model gets `PAID_MODEL_AUTH_REQUIRED`, usually on a 401 or 403. The free
 * models on the same connection still work, so the denial describes the requested
 * model, not the credential: lock that model only. Only the exact code decides
 * (top-level `error_type`/`code`/`type` or `error.code`/`error.type`, case-
 * insensitive); the free-text message never does, and a message that names a bad
 * credential keeps the shared authentication path. `modelOnly` tells the caller
 * not to widen the lock when the requested id has no bounded model scope.
 */
const KILO_PAID_MODEL_AUTH_REQUIRED = "paid_model_auth_required";
const KILO_INVALID_CREDENTIAL_MESSAGE =
/\b(?:invalid|expired|revoked|missing)\s+(?:api[ -]?key|access[ -]?token|bearer[ -]?token)\b|\bauthentication expired\b/i;
const KILO_PROVIDER_IDS = ["kilo-gateway", "kg", "kilocode", "kc"];

function parseKiloBody(value) {
  if (isObject(value)) return value;
  if (!isString(value)) return null;
  const trimmed = value.slice(0, MAX_ERROR_ENVELOPE_BYTES).trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function collectKiloFields(...sources) {
  const codes = [];
  const messages = [];
  for (const source of sources) {
    const root = parseKiloBody(source);
    if (isString(source) && !root) messages.push(source.slice(0, MAX_ERROR_ENVELOPE_BYTES));
    if (!root) continue;
    const inner = isObject(root.error) ? root.error : null;
    codes.push(root.error_type, root.code, root.type, inner?.code, inner?.type);
    messages.push(root.message, inner?.message, isString(root.error) ? root.error : null);
  }
  return {
    codes: codes.filter((value) => isString(value)).map((value) => value.trim().toLowerCase()),
    messages: messages.filter((value) => isString(value))
  };
}

function buildKiloRules() {
  return [{
    id: "kilo-paid-model-auth-required",
    match: ({ status, body, errorText }) => {
      if (status !== 401 && status !== 402 && status !== 403) return null;
      const { codes, messages } = collectKiloFields(body, errorText);
      if (!codes.includes(KILO_PAID_MODEL_AUTH_REQUIRED)) return null;
      if (KILO_INVALID_CREDENTIAL_MESSAGE.test(messages.join(" "))) return null;
      return { reason: "model_access_denied", scope: "model", cooldownMs: 2 * 60 * 1000, modelOnly: true };
    }
  }];
}

/**
 * Cloudflare Workers AI (OmniRoute #20343). HTTP 403 code 5035, "Model X is not
 * available on the Workers Free plan", gates one model: the same token keeps
 * serving every free model. Executors hand this body over as raw text, so the
 * upstream sentence decides. `modelOnly` keeps an id outside the catalog from
 * widening into an account-wide lock.
 */
const CLOUDFLARE_PAID_PLAN_TEXT = /not available on the workers free plan/i;

function buildCloudflareAiRules() {
  return [{
    id: "cloudflare-ai-model-requires-paid-plan",
    match: ({ status, body, errorText }) => {
      if (status !== 403) return null;
      const text = isString(errorText) && errorText ? errorText : JSON.stringify(body ?? "");
      if (!CLOUDFLARE_PAID_PLAN_TEXT.test(text)) return null;
      return { reason: "model_access_denied", scope: "model", cooldownMs: 2 * 60 * 1000, modelOnly: true };
    }
  }];
}

export const providerRuleRegistry = new Map([
...KILO_PROVIDER_IDS.map((provider) => [provider, buildKiloRules()]),
["cloudflare-ai", buildCloudflareAiRules()],
["agentrouter", buildAgentrouterRules()],
["y-api", buildYApiRules()],
...["opencode", "opencode-go", "opencode-zen"].map((provider) => [provider, [{
  id: "opencode-endpoint-unavailable",
  match: ({ status, body }) => {
    if (status !== 400 && status !== 429) return null;
    const { message } = inspectProviderErrorEnvelope(body);
    if (!message.toLowerCase().includes("endpoint is unavailable")) return null;
    return { reason: "model_capacity", scope: "model", cooldownMs: 300_000, endpointUnavailable: true };
  }
}]]),
["gisoo", buildGisooRules()],
["nvidia", [{
  id: "nvidia-degraded-model",
  match: ({ status, body }) => {
    if (status !== 400) return null;
    const { message } = inspectProviderErrorEnvelope(body);
    if (!/^DEGRADED function cannot be invoked\b/i.test(message.trim())) return null;
    return { scope: "model", cooldownMs: 15 * 60 * 1000 };
  }
}]]]
);

/**
 * Operator-declared per-provider error rules from `settings.providerErrorRules`
 * (OmniRoute #11104). Data-only: `{ status, match, scope, reason?, cooldownMs? }`
 * per provider (lowercased key). `match` is always a plain case-insensitive
 * SUBSTRING of the error body, never a RegExp -- the settings boundary accepts
 * operator-supplied strings, so a regex engine here would open a ReDoS hole on
 * the error-classification hot path. Populated by `setOperatorProviderErrorRules`,
 * called once at boot (initializeApp.js) and again on every settings PATCH that
 * touches the key (src/app/api/settings/route.js). Consulted BEFORE the
 * built-in `providerRuleRegistry` so an operator can override catalog behavior
 * for any provider without editing this file.
 */
const MAX_OPERATOR_RULES_TOTAL = 50;
let operatorProviderErrorRules = {};

/**
 * Replace the in-memory operator rule cache. Pass `undefined`/`null`/`{}` to
 * clear. Silently drops malformed entries and rules past
 * {@link MAX_OPERATOR_RULES_TOTAL} -- callers validate shape/bounds at the
 * settings boundary, this is a defensive second gate so a corrupted stored
 * value can never crash or blow up the matcher.
 */
export function setOperatorProviderErrorRules(rules) {
  operatorProviderErrorRules = {};
  if (!rules || !isObject(rules)) return;
  let total = 0;
  for (const [provider, list] of Object.entries(rules)) {
    if (!isString(provider) || !provider.trim() || !Array.isArray(list) || list.length === 0) continue;
    const validRules = [];
    for (const rule of list) {
      if (total >= MAX_OPERATOR_RULES_TOTAL) break;
      if (!isObject(rule)) continue;
      if (!Number.isInteger(rule.status) || rule.status < 100 || rule.status > 599) continue;
      if (!isString(rule.match) || !rule.match.trim()) continue;
      if (rule.scope !== "model" && rule.scope !== "provider" && rule.scope !== "connection") continue;
      validRules.push({
        status: rule.status,
        match: rule.match,
        scope: rule.scope,
        reason: isString(rule.reason) && rule.reason ? rule.reason : "quota_exhausted",
        cooldownMs: Number.isFinite(rule.cooldownMs) && rule.cooldownMs >= 0 ? rule.cooldownMs : undefined
      });
      total += 1;
    }
    if (validRules.length > 0) operatorProviderErrorRules[provider.toLowerCase()] = validRules;
  }
}

/** True when an operator declared at least one rule for this provider. */
export function hasOperatorRuleForProvider(provider) {
  if (!provider) return false;
  const rules = operatorProviderErrorRules[provider.toLowerCase()];
  return !!rules && rules.length > 0;
}

function matchOperatorRule(provider, status, body) {
  if (!provider) return null;
  const rules = operatorProviderErrorRules[provider.toLowerCase()];
  if (!rules || rules.length === 0) return null;
  const text = isString(body) ? body : JSON.stringify(body ?? "");
  const lowered = text.toLowerCase();
  for (const rule of rules) {
    if (rule.status !== status) continue;
    if (!lowered.includes(rule.match.toLowerCase())) continue;
    return { reason: rule.reason, scope: rule.scope, cooldownMs: rule.cooldownMs };
  }
  return null;
}

/**
 * Provider rules inspect parsed error envelopes by default; a provider with
 * an operator-declared rule gets the full raw error text instead, since the
 * operator's `match` is a literal body substring by construction and could
 * never match a structured envelope.
 */
export function resolveRuleMatchBody(provider, structuredError, errorText) {
  if (provider && hasOperatorRuleForProvider(provider) && isString(errorText) && errorText) {
    return errorText;
  }
  return structuredError ?? null;
}

/**
 * Match a provider rule against one upstream failure.
 *
 * @param {string|null} provider - provider id (lowercased for the lookup)
 * @param {number} status - upstream HTTP status
 * @param {Headers|object|null} headers - upstream response headers
 * @param {unknown} body - the parsed upstream error envelope, when available
 * @param {string|null} [errorText] - the sanitized upstream message
 * @returns {{ reason: string, scope: string, cooldownMs?: number, terminal?: boolean }|null}
 */
export function getProviderErrorRuleMatch(provider, status, headers, body, errorText = null) {
  if (!provider) return null;
  const operatorMatch = matchOperatorRule(provider, status, body);
  if (operatorMatch) return operatorMatch;
  const rules = providerRuleRegistry.get(provider.toLowerCase());
  if (!rules) return null;
  const normalizedHeaders = !headers ?
  {} :
  isFunction(headers.get) ?
  Object.fromEntries(headers.entries()) :
  Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  for (const rule of rules) {
    const match = rule.match({ status, headers: normalizedHeaders, body, errorText });
    if (match) return match;
  }
  return null;
}
