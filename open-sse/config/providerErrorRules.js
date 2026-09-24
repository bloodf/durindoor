/**
 * Provider-specific error markers that do not fit the shared status rules.
 * Each rule's `scope` is forwarded into fallback locking:
 *   - "connection" forces an account-wide lock (`modelLock___all`)
 *   - "model"     locks the requested model only
 * `cooldownMs` (when set) overrides the generic backoff ladder.
 *
 * Rule body matching inspects the structured upstream error envelope only:
 * the `error` object (`message`, `type`, `code`, `metadata` keys) plus
 * provider-shaped top-level hints. The whole response body, the request
 * body, and any user prompt are NEVER concatenated here — that would
 * let a provider echo a malicious prompt bypass the markers.
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

export const providerRuleRegistry = new Map([
["agentrouter", buildAgentrouterRules()]]
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

export function getProviderErrorRuleMatch(provider, status, headers, body) {
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
    const match = rule.match({ status, headers: normalizedHeaders, body });
    if (match) return match;
  }
  return null;
}