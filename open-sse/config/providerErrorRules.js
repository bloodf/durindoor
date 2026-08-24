import { isFunction, isObject, isString } from "@/shared/utils/typeChecks.js"; /**
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

/** Provider rules inspect parsed error envelopes only, never raw response text. */
export function resolveRuleMatchBody(_provider, structuredError) {
  return structuredError ?? null;
}


export function getProviderErrorRuleMatch(provider, status, headers, body) {
  if (!provider) return null;
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