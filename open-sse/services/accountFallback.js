import { ERROR_RULES, COOLDOWN_MS, BACKOFF_CONFIG, TRANSIENT_COOLDOWN_MS, MAX_RATE_LIMIT_COOLDOWN_MS, REQUEST_REPLAY_BUFFER_ERROR, RELAY_GATEWAY_STATUSES, RELAY_TRANSPORT_FAILURES, ACCOUNT_SCOPED_4XX_STATUSES } from "../config/errorConfig.js";
import { parseRateLimitEvidence } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getProviderErrorRuleMatch, resolveRuleMatchBody } from "../config/providerErrorRules.js";
import { resolveFallbackModelScope } from "./fallbackScope.js";
import { parseClineTryAgainInMs } from "./accountFallback/clineTryAgainIn.js";

/**
 * Identify Envoy retry-buffer overflow responses that are safe to replay on
 * the same account because they carry no credential or quota evidence.
 * @param {number} status - HTTP status code
 * @param {unknown} errorText - Upstream error body
 * @returns {boolean} Whether the request should be replayed in place
 */
import { isNumber, isString, isObject, isRecord } from "../../src/shared/utils/typeChecks.js";
export function isRequestReplayBufferError(status, errorText) {
  if (Number(status) !== HTTP_STATUS.INSUFFICIENT_STORAGE) return false;
  const message = isString(errorText) ? errorText : JSON.stringify(errorText || "");
  return message.toLowerCase().includes(REQUEST_REPLAY_BUFFER_ERROR);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Collect request values that providers echo into error text (#2315).
 * Includes the requested model string, its provider-stripped form, and ids
 * recovered from common "<id> is not a valid model ID" templates.
 * @param {string|null|undefined} model
 * @param {string|null|undefined} provider
 * @param {string} messageText
 * @returns {string[]}
 */
function collectEchoedRequestValues(model, provider, messageText) {
  const values = [];
  const pushModelForms = (raw) => {
    if (!isString(raw)) return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    values.push(trimmed);
    const slash = trimmed.indexOf("/");
    if (slash > 0 && slash < trimmed.length - 1) {
      values.push(trimmed.slice(slash + 1));
    }
    if (isString(provider) && provider && trimmed.toLowerCase().startsWith(`${provider.toLowerCase()}/`)) {
      values.push(trimmed.slice(provider.length + 1));
    }
  };
  pushModelForms(model);
  if (isString(messageText) && messageText) {
    const echoed = messageText.match(
      /^\s*[`'"]?([^\s`'"]+)[`'"]?\s+is not a valid model(?:\s+id)?\b/i
    );
    if (echoed?.[1]) pushModelForms(echoed[1]);
  }
  return values;
}

/**
 * Remove echoed request values before ERROR_RULES text matching so a
 * client-chosen model id containing billing/capacity phrases cannot lock
 * shared accounts (#2315).
 * @param {string} text
 * @param {string[]} echoedValues
 * @returns {string}
 */
function stripEchoedRequestValues(text, echoedValues) {
  if (!isString(text) || !text || !Array.isArray(echoedValues) || echoedValues.length === 0) {
    return isString(text) ? text : "";
  }
  let result = text;
  const unique = [...new Set(echoedValues.map((value) => value.toLowerCase()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  for (const value of unique) {
    result = result.replace(new RegExp(escapeRegExp(value), "gi"), " ");
  }
  return result;
}

/**
 * Provider-authored error signal for text rules: message + code only.
 * Full request dumps can echo user-controlled fields (#2315 / #1391).
 * @param {unknown} structuredError
 * @param {string|object|null|undefined} errorText
 * @returns {{ message: string, code: string, text: string }}
 */
function extractProviderRuleText(structuredError, errorText) {
  const message = extractErrorMessage(structuredError, errorText);
  let body = structuredError;
  if (!body && isString(errorText)) {
    try { body = JSON.parse(errorText); } catch { body = null; }
  }
  const rawCode = body?.error?.code ?? body?.code;
  const code = isString(rawCode) ? rawCode : isNumber(rawCode) ? String(rawCode) : "";
  const text = [code, message].filter(Boolean).join(" ");
  return { message, code, text: text || (isString(errorText) ? errorText : "") };
}

const DASHSCOPE_PROVIDERS = new Set([
  "alibaba",
  "alibaba-cn",
  "alicode",
  "alicode-intl",
  "bailian-coding-plan",
  "qwen-cloud",
  "qwen-cloud-token-plan",
]);
const DASHSCOPE_UNPAID_CODES = new Set(["arrearage", "accessdenied.unpurchased"]);

// OmniRoute #19684: DashScope reports unpaid accounts on 400/403 with a vendor
// code in error.code or at the top level. Messages and parameters can echo user input.
function isDashScopeDeadAccount(provider, status, errorText, structuredError) {
  if (!DASHSCOPE_PROVIDERS.has(provider) || (Number(status) !== 400 && Number(status) !== 403)) return false;

  let body = structuredError ?? errorText;
  if (isString(body)) {
    try {
      body = JSON.parse(body);
    } catch {
      return false;
    }
  }
  const code = body?.error?.code ?? body?.code;
  return isString(code) && DASHSCOPE_UNPAID_CODES.has(code.toLowerCase());
}

/**
 * Calculate exponential backoff cooldown for rate limits (429)
 * Level 1: 1s, Level 2: 2s, Level 3: 4s... → max 4 min
 * @param {number} backoffLevel - Current backoff level
 * @returns {number} Cooldown in milliseconds
 */
export function getQuotaCooldown(backoffLevel = 0) {
  const level = Math.max(0, backoffLevel - 1);
  const cooldown = BACKOFF_CONFIG.base * Math.pow(2, level);
  return Math.min(cooldown, BACKOFF_CONFIG.max);
}

/**
 * Check if error should trigger account fallback (switch to next account)
 * Config-driven: terminal status rules win before text rules, then remaining
 * ERROR_RULES match top-to-bottom. Known account/quota text rules take
 * precedence otherwise; deterministic request-scoped 4xx client failures do not rotate.
 * Pass the attempted model in the options object so text rules can ignore
 * echoed model IDs (#2471). The positional form remains supported.
 * Set `checkAccountLockScope: false` when the caller only decides whether to
 * try another model and does not persist account locks.
 * @param {number|{status: number, errorText: unknown, backoffLevel?: number, provider?: string|null, headers?: Headers|object|null, structuredError?: unknown, model?: string|null, checkAccountLockScope?: boolean}} status - HTTP status code or classifier options
 * @param {string} errorText - Error message text
 * @param {number} backoffLevel - Current backoff level for exponential backoff
 * @param {string} provider - Optional provider ID for provider-specific rules
 * @param {Headers|object|null} headers - Optional upstream response headers
 * @param {unknown} structuredError - Optional parsed upstream error body
 * @param {string|null} model - Optional requested model id (stripped from text rules; #2315)
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number, rateLimitEvidence?: object, terminal?: boolean, requestScoped?: boolean }}
 *   `shouldFallback` answers "is the credential at fault?" (account rotation);
 *   `requestScoped` answers "did this member reject the request itself?"
 *   (combo rotation, which tries the next member without a cooldown).
 *   `rateLimitEvidence` is present only on an explicit quota-exhausted 429,
 *   so markAccountUnavailable can persist state:"exhausted" instead of an
 *   ordinary cooldown. `terminal` marks a state retrying cannot fix
 *   (billing/credit exhausted) — the account still cools down, but callers
 *   must not advertise a client-facing Retry-After for it.
 */
export function checkFallbackError(status, errorText, backoffLevel = 0, provider = null, headers = null, structuredError = null, model = null) {
  const options = isRecord(status) ? status : {
    status, errorText, backoffLevel, provider, headers, structuredError, model,
  };
  return classifyFallbackError(options);
}

function classifyFallbackError({
  status, errorText, backoffLevel = 0, provider = null, headers = null, structuredError = null, model = null,
  checkAccountLockScope = true,
}) {
  const normalizedText = errorText ?
  isString(errorText) ? errorText : JSON.stringify(errorText) :
  "";
  const lowerError = normalizedText.toLowerCase();
  // Text rules match the provider's own message/code with echoed request
  // values (the model id) removed, so a client-chosen id containing
  // billing/capacity phrases cannot bench shared accounts (#2315).
  const providerSignal = extractProviderRuleText(structuredError, errorText);
  const echoedValues = collectEchoedRequestValues(model, provider, providerSignal.message);
  const ruleMatchText = stripEchoedRequestValues(
    providerSignal.text || normalizedText,
    echoedValues
  ).toLowerCase();

  if (isRequestReplayBufferError(status, errorText)) {
    return { shouldFallback: false, cooldownMs: 0, scope: null };
  }

  // External/client HTTP 499 is terminal; combo-owned timeout fallback is handled in combo.js.
  if (Number(status) === 499) {
    return { shouldFallback: false, cooldownMs: 0, scope: null };
  }

  // OpenRouter capability and routing preferences describe this request, not
  // model health. A model OpenRouter removed answers the same 404 on every key,
  // and its passthrough id collapses to the account-wide lock scope, so cooling
  // the key down would refuse every other OpenRouter model for the whole window.
  // Keep other missing-model 404s on their existing path.
  if (Number(status) === 404 && provider === "openrouter" && (
    /\bno endpoints found that support\b/i.test(normalizedText) ||
    /\bno allowed providers\b/i.test(normalizedText) ||
    /\bno endpoints found\b[^\n]{0,160}\bmatching your data policy\b/i.test(normalizedText) ||
    /\bno longer available on openrouter\b/i.test(normalizedText)
  )) {
    return { shouldFallback: false, cooldownMs: 0, scope: null, requestScoped: true };
  }

  /** #3386: terminal client errors win before message-based transient rules. */
  const terminalRule = ERROR_RULES.find((rule) => rule.status === status && rule.fallback === false);
  if (terminalRule) {
    return { shouldFallback: false, cooldownMs: 0, newBackoffLevel: backoffLevel, scope: null };
  }

  // Unpaid DashScope account: park the key on the terminal billing cooldown instead of
  // treating a 400 as request-scoped or retrying a dead 403 key on the short cooldown.
  if (isDashScopeDeadAccount(provider, status, errorText, structuredError)) {
    return { shouldFallback: true, cooldownMs: COOLDOWN_MS.paymentRequired, newBackoffLevel: 0, terminal: true, scope: null };
  }

  // Port-pending guards are explicit feature-not-implemented errors; they should not
  // lock the user's connection or trigger the account fallback cooldown chain.
  // chatCore flattens the guard body to "[501]: <provider> ... runtime execution is not ported yet",
  // which drops the provider_port_pending type, so the guard's own wording is matched for 501 too (#2034).
  if (lowerError.includes("provider_port_pending") ||
    Number(status) === 501 && /runtime execution is not (?:ported yet|available)/.test(lowerError)) {
    return { shouldFallback: false, cooldownMs: 0, scope: null };
  }

  // Anthropic 400 invalid_request_error is a client-side request schema failure;
  // switching accounts will not fix it, so do not fall back — unless the body is
  // prepaid credit exhaustion still typed as invalid_request_error on the wire
  // (#1364 / anthropics/anthropic-sdk-typescript#618). Honor terminal billing
  // text rules before this short-circuit; ordinary invalid_request_error stays
  // request-scoped.
  if (Number(status) === 400 && lowerError.includes("invalid_request_error")) {
    // Match only the provider's error message so a quoted billing phrase elsewhere
    // in the body (e.g. echoed user prompt text) cannot lock a healthy account.
    const billingText = stripEchoedRequestValues(
      extractErrorMessage(structuredError, errorText),
      echoedValues
    ).toLowerCase();
    const billing = checkFallbackErrorByRules(status, billingText, backoffLevel);
    if (billing.terminal) return { ...billing, scope: null };
    return { shouldFallback: false, cooldownMs: 0, scope: null, requestScoped: true };
  }

  // Codex invalid_encrypted_content is a stale-reasoning request issue recovered
  // in-place by the Codex executor; switching accounts will not fix it (#2667).
  const invalidEncryptedContent = lowerError.includes("invalid_encrypted_content") ||
  lowerError.includes("encrypted content") && (
  lowerError.includes("could not be verified") || lowerError.includes("could not be decrypted or parsed"));
  if (Number(status) === 400 && invalidEncryptedContent) {
    return { shouldFallback: false, cooldownMs: 0, scope: null };
  }

  // A per-request content rejection (e.g. provider content filter blocking a
  // single prompt) is not an account/auth/quota failure; it must never lock the
  // connection or trigger the account-fallback cooldown chain.
  if (lowerError.includes("provider_request_rejected")) {
    return { shouldFallback: false, cooldownMs: 0, scope: null };
  }

  const providerRule = getProviderErrorRuleMatch(
    provider,
    status,
    headers,
    resolveRuleMatchBody(provider, structuredError, errorText),
    errorText
  );
  // The endpoint marker is model capacity, unless the error message also
  // supplies terminal billing or explicit exhausted-quota evidence.
  if (providerRule?.endpointUnavailable) {
    const message = stripEchoedRequestValues(
      extractErrorMessage(structuredError, errorText),
      echoedValues
    );
    const billing = checkFallbackErrorByRules(status, message.toLowerCase(), backoffLevel, provider);
    if (billing.terminal) return { ...billing, scope: null };
    if (status === 429) {
      const evidence = parseRateLimitEvidence({ status, bodyText: message, now: Date.now() });
      if (evidence?.state === "exhausted") {
        const cooldownMs = Number.isFinite(evidence.resetAtMs) ?
          Math.max(0, Math.min(evidence.resetAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS)) : billing.cooldownMs;
        return { ...billing, shouldFallback: true, cooldownMs, rateLimitEvidence: evidence, scope: null };
      }
    }
  }
  if (providerRule?.reason === "quota_exhausted") {
    const ruleResult = checkFallbackErrorByRules(HTTP_STATUS.RATE_LIMITED, ruleMatchText, backoffLevel);
    return { ...ruleResult, scope: providerRule.scope ?? null };
  }
  if (providerRule?.cooldownMs) {
    return {
      shouldFallback: true,
      cooldownMs: providerRule.cooldownMs,
      newBackoffLevel: 0,
      scope: providerRule.scope ?? null,
      // A provider rule may mark its own state terminal (billing/credit
      // exhausted, identity verification pending): the account still cools
      // down, but no client-facing Retry-After may be advertised for it.
      ...(providerRule.terminal ? { terminal: true } : null),
      // The denial names the requested model only (Kilo paid-model auth). The
      // caller must not widen it to an account lock when the id is unbounded.
      ...(providerRule.modelOnly ? { modelOnly: true } : null)
    };
  }

  // OmniRoute #21080: Cline's free-tier daily cap names the exact wait ("Try again
  // in 19h 39m") for the model that ran out. Honor it instead of the 2 s backoff,
  // scoped to that model so the other free models on the connection keep routing.
  // Malformed or absent durations fall through to the generic 429 handling below.
  if (status === 429) {
    const clineHintMs = parseClineTryAgainInMs(ruleMatchText, provider, MAX_RATE_LIMIT_COOLDOWN_MS);
    if (clineHintMs !== null) {
      return { shouldFallback: true, cooldownMs: clineHintMs, newBackoffLevel: 0, scope: "model", retryHintSource: "body" };
    }
  }

  // OmniRoute #6731: an apikey-category 429 whose body explicitly reports an
  // exhausted daily/weekly/monthly quota must honor the real reset window, not
  // the generic exponential backoff. Reuse the native evidence parser so an
  // explicit "reset in N days/weeks" deadline benches the account precisely.
  // Only state==="exhausted" applies here — a plain transient 429 (no quota
  // signal) keeps the exponential-backoff path below untouched.
  if (status === 429) {
    const now = Date.now();
    const evidence = parseRateLimitEvidence({ status, bodyText: normalizedText, now });
    if (evidence?.state === "exhausted") {
      // Resetless exhaustion: no parseable deadline, so fall through to the
      // rule loop for the (short) bench duration but preserve the classifier
      // verdict. markAccountUnavailable adopts rateLimitEvidence when the
      // caller did not supply one, keeping state:"exhausted" + retryAtKnown
      // instead of persisting this as an ordinary cooldown.
      if (Number.isFinite(evidence.resetAtMs)) {
        // Clamp the parsed reset to the hard cap in this text-quota path so
        // monthly "reset in 14 days" still benches for the cap rather than
        // being discarded as resetless exhaustion.
        const clampedReset = Math.min(evidence.resetAtMs, now + MAX_RATE_LIMIT_COOLDOWN_MS);
        return {
          shouldFallback: true,
          cooldownMs: Math.max(0, clampedReset - now),
          newBackoffLevel: 0,
          rateLimitEvidence: evidence,
          scope: null
        };
      }
      const fallback = checkFallbackErrorByRules(status, ruleMatchText, backoffLevel);
      return { ...fallback, rateLimitEvidence: evidence, scope: null };
    }
  }

  const generic = checkFallbackErrorByRules(status, ruleMatchText, backoffLevel, provider);
  // #2315: after echo-stripping, a 400 with no provider rule that would only
  // lock account-wide because the requested id is unknown/passthrough stays
  // request-scoped. Terminal billing matches (real credit exhaustion) keep
  // their account-wide lock even on passthrough catalogs.
  if (
    checkAccountLockScope &&
    generic.shouldFallback &&
    !generic.terminal &&
    Number(status) === 400 &&
    !providerRule &&
    isString(model) &&
    model &&
    resolveFallbackModelScope(provider, model) === null
  ) {
    return { shouldFallback: false, cooldownMs: 0, scope: null, requestScoped: true };
  }
  return { ...generic, scope: null };
}

function extractErrorMessage(structuredError, errorText) {
  let body = structuredError;
  if (!body && isString(errorText)) {
    try { body = JSON.parse(errorText); } catch { return errorText; } // non-JSON text is the message itself
  }
  const message = body?.error?.message ?? body?.message;
  return isString(message) ? message : "";
}

const RELAY_GATEWAY_STATUS_SET = new Set(RELAY_GATEWAY_STATUSES);
const RELAY_TRANSPORT_FAILURE_SET = new Set(RELAY_TRANSPORT_FAILURES);

/**
 * True when the executor identifies a transport failure without a usable
 * HTTP response. The origin might still have received the request.
 *
 * Proof is deliberately narrow, and never comes from upstream text:
 * - `transportFailure` is the fork's OWN transport classification
 *   ("connect_timeout" | "network", set in open-sse/executors/base.js): no HTTP
 *   response was produced by any hop, without a usable HTTP response.
 *
 * A bare 502/503/504 is NOT proof: a provider application may answer 503
 * (overload, model capacity) or 502 itself, and the fork cannot tell the two
 * apart from the status alone. An upstream error body is never consulted.
 *
 * @param {number|string|null|undefined} status - Upstream status
 * @param {object} [options]
 * @param {string|null} [options.transportFailure] - The fork's transport-level
 *   classification for this attempt ("connect_timeout" | "network")
 * @returns {boolean}
 */
export function isRelayGatewayFailure(status, { transportFailure = null } = {}) {
  const numericStatus = Number(status);
  if (!RELAY_GATEWAY_STATUS_SET.has(numericStatus)) return false;
  return RELAY_TRANSPORT_FAILURE_SET.has(transportFailure);
}

/**
 * Count the accounts that could still serve THIS request.
 *
 * The request scope is narrower than "the provider's connections": an account
 * that is inactive, quarantined for reauth, locked for the requested model, or
 * already excluded by this request's own fallback chain cannot serve this
 * request, so it must not be counted as an alternative.
 *
 * @param {Array} connections - Provider connections
 * @param {object} [options]
 * @param {string|null} [options.model] - Requested model for model-lock scope
 * @param {Set<string>|string[]|string|null} [options.excludedConnectionIds] -
 *   Connections this request already excluded
 * @returns {number} How many accounts could still serve this request
 */
export function countEligibleAccounts(connections, { model = null, excludedConnectionIds = null } = {}) {
  if (!Array.isArray(connections)) return 0;
  const excluded = excludedConnectionIds instanceof Set ?
  excludedConnectionIds :
  new Set(Array.isArray(excludedConnectionIds) ?
  excludedConnectionIds :
  excludedConnectionIds ? [excludedConnectionIds] : []);
  return connections.filter((connection) => {
    if (!connection) return false;
    if (connection.isActive === false) return false;
    if (connection.testStatus === "reauth_required") return false;
    if (excluded.has(connection.id)) return false;
    if (isModelLockActive(connection, model)) return false;
    return true;
  }).length;
}

function checkFallbackErrorByRules(status, lowerError, backoffLevel, provider = null) {
  for (const rule of ERROR_RULES) {
    if (rule.provider && !rule.provider.includes(provider)) continue;
    // Text-based rule: match substring in error message
    if (rule.text && lowerError && lowerError.includes(rule.text)) {
      if (rule.fallback === false) return { shouldFallback: false, cooldownMs: 0 };
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs, terminal: rule.terminal };
    }

    // Pattern-based rule: regex match, for phrases the model name sits inside
    // ("Model does-not-exist-xyz is not supported") that a substring cannot span.
    if (rule.pattern && lowerError && rule.pattern.test(lowerError)) {
      if (rule.fallback === false) return { shouldFallback: false, cooldownMs: 0 };
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs, terminal: rule.terminal };
    }

    // Status-based rule: match HTTP status code
    if (rule.status && rule.status === status) {
      if (rule.fallback === false) return { shouldFallback: false, cooldownMs: 0 };
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs, terminal: rule.terminal };
    }
  }

  // Request-scoped client errors that matched no rule above: a 4xx caused by the
  // request itself (context overflow, malformed body, unsupported parameter) says
  // nothing about the credential, so cooling the account down only removes a
  // healthy connection from rotation. With a single connection it is worse: every
  // later request in the window fails with a copy of this very error, which hides
  // the real cause from the caller and makes unrelated sessions look like they hit
  // the same limit. Hand the upstream error back for this request instead.
  // Account-scoped statuses (401/402/403/404/429) already returned above via
  // their ERROR_RULES status match, so they never reach this fallthrough.
  // `requestScoped` tells combo rotation this member rejected THIS request, so the
  // next member may still serve it (upstream 9router 5cdcddf5, #5057).
  // Upstream HTTP 408 and 425, and the account-scoped 412/423/428 (#4378), use the
  // transient cooldown below so the next connection of the provider is tried.
  if (status >= 400 && status < 500 && Number(status) !== 408 && Number(status) !== 425 && !ACCOUNT_SCOPED_4XX_STATUSES.has(Number(status))) {
    return { shouldFallback: false, cooldownMs: 0, requestScoped: true };
  }

  // Default: transient cooldown for any unmatched error
  return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
}

/**
 * Antigravity capacity is a per-request server saturation signal, not an
 * account quota/rate-limit. It should skip the current connection only for
 * this request and must not write cooldown state to DB.
 */
export function isAntigravityCapacityError(status, errorText = "") {
  const text = isString(errorText) ? errorText : JSON.stringify(errorText || "");
  return Number(status) === 503 && (
  /MODEL_CAPACITY_EXHAUSTED/i.test(text) ||
  /No capacity available for model/i.test(text));

}

const CLOUD_CODE_ACCOUNT_DISABLED_403_PATTERNS = [
/disabled in this account/i,
/account[^.:\n]*(?:disabled|deactivated|suspended|banned|terminated|closed)/i,
/verify your account/i,
/violation of (?:the )?terms/i,
/terms of service/i];


const CLOUD_CODE_PROJECT_403_PATTERNS = [
/has not been used in project/i,
/accessNotConfigured/i,
/cloud ai companion api/i,
/cloudcode-pa\.googleapis\.com/i,
/api has not been (?:used|enabled)/i,
/SERVICE_DISABLED/];


/**
 * Cloud Code / Antigravity 403s are recoverable only when the error identifies
 * a project/API setup issue. Account verification, deactivation, suspension, or
 * ToS-ban messages are real account failures and must keep normal cooldown
 * handling, even when they come from a Cloud Code provider.
 */
export function isRecoverableCloudCodeProject403(provider, status, errorText = "") {
  if (Number(status) !== 403) return false;
  const p = String(provider || "").toLowerCase();
  const isCloudCodeProvider =
  p === "antigravity" ||
  p === "gemini-cli" ||
  p.includes("cloudcode") ||
  p.includes("cloud-code");
  const text = isString(errorText) ? errorText : JSON.stringify(errorText || "");
  if (CLOUD_CODE_ACCOUNT_DISABLED_403_PATTERNS.some((pattern) => pattern.test(text))) return false;

  const hasProjectMarker = CLOUD_CODE_PROJECT_403_PATTERNS.some((pattern) => pattern.test(text)) ||
  /PERMISSION_DENIED/.test(text) && /\b(project|api|cloud ai companion|cloudcode-pa)\b/i.test(text);

  return isCloudCodeProvider && hasProjectMarker;
}

/**
 * Providers whose credential is durable (an API key, not a refreshable token).
 * A rejected credential is terminal: it must be reauthenticated, never refreshed.
 * @param {string|null} providerId
 * @returns {boolean}
 */
export function isDurableCredentialProvider(providerId) {
  return providerId === "orcarouter";
}

// A 403 quarantines only when it names the key itself as rejected ("invalid
// API key", "invalid_api_key", "API key has been revoked"). Words like
// "unauthorized" or "disabled" alone also appear in model-permission 403s,
// which must not take a working key out of rotation.
const DURABLE_CREDENTIAL_AUTH_FAILURE = /\b(invalid|incorrect|revoked|expired|disabled)[\s_-]+(api[\s_-]+)?key\b|\bkey\s+(is\s+|has\s+been\s+|was\s+)?(invalid|revoked|expired|disabled|deactivated)\b/i;

function isDurableCredentialAuthFailure(errorText) {
  return isString(errorText) && DURABLE_CREDENTIAL_AUTH_FAILURE.test(errorText);
}

/**
 * Reauth fields for a rejected durable credential.
 *
 * Returns null when the caller cannot prove which credential was rejected, or
 * when the stored credential is no longer the one that failed — a late failure
 * from an old request must never flag a credential the user has since replaced
 * by signing in again.
 * @param {object|null} conn - The stored connection row
 * @param {string|null} usedCredential - The credential the rejected request presented
 * A 401 always counts as a rejection. A 403 only counts when its body reads as
 * an auth failure: shared error rules also use 403 for quota and permission
 * errors, which must stay on the normal cooldown path.
 * @param {number|string|null} status - Upstream HTTP status
 * @param {string|null} [errorText] - Upstream error body/message
 * @returns {{ needsReauth: boolean, reauthReason: string, reauthAt: string }|null}
 */
export function durableCredentialReauthFields(conn, usedCredential, status, errorText = null) {
  if (!conn) return null;
  const code = Number(status);
  if (code !== 401 && !(code === 403 && isDurableCredentialAuthFailure(errorText))) return null;
  if (!isString(usedCredential) || !usedCredential) return null;
  if (conn.accessToken !== usedCredential && conn.apiKey !== usedCredential) return null;
  return {
    needsReauth: true,
    reauthReason: "credential_rejected",
    reauthAt: new Date().toISOString()
  };
}

/** Account-wide quota lockouts are independent of manual account enablement. */
export function isQuotaLockoutActive(connection, now = Date.now()) {
  const lock = connection?.quotaLockout;
  if (!lock?.status) return false;
  const deadline = Date.parse(lock.reactivateAt);
  return lock.reactivateAt == null || !Number.isFinite(deadline) || deadline > now;
}

/** Inspect only an upstream error message, never arbitrary response/request fields. */
export function detectQuotaExhaustion(error, now = Date.now()) {
  let value = error;
  if (isString(value) && /^[\s]*[\[{]/.test(value)) {
    try { value = JSON.parse(value); } catch { return { exhausted: false, resetAtMs: null }; }
  }
  const envelope = isObject(value) ? (value.error ?? value) : null;
  const message = isString(envelope) ? envelope : isString(envelope?.message) ? envelope.message : isString(value) ? value : "";
  if (!/^(?:your |the |provider )?(?:free usage limit reached|daily free quota exceeded|(?:free )?quota (?:has been |is )?(?:exhausted|exceeded)|quota limit exceeded|usage limit (?:reached|exceeded)|quota resets? at)\b/i.test(message)) return { exhausted: false, resetAtMs: null };
  const candidates = [];
  const collectResets = (node, depth = 0) => {
    if (!node || depth > 6 || (!isObject(node) && !Array.isArray(node))) return;
    for (const [key, child] of Object.entries(node)) {
      if (["resetsAtMs", "resetAt", "reset_at", "resets_at", "resetsAt", "resetTime", "reset_time"].includes(key)) candidates.push(child);
      else if (!["request", "messages", "prompt"].includes(key)) collectResets(child, depth + 1);
    }
  };
  collectResets(envelope);
  if (isObject(value) && value.error) {
    for (const key of ["resetsAtMs", "resetAt", "reset_at", "resets_at", "resetsAt"]) candidates.push(value[key]);
  }
  candidates.push(message.match(/\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)/)?.[0]);
  const resetAtMs = candidates.map((v) => isNumber(v) ? v : Date.parse(v)).find((v) => Number.isFinite(v) && v > now) ?? null;
  return { exhausted: true, resetAtMs };
}

/**
 * Check if account is currently unavailable (cooldown not expired)
 */
export function isAccountUnavailable(unavailableUntil) {
  if (!unavailableUntil) return false;
  return new Date(unavailableUntil).getTime() > Date.now();
}

/**
 * Calculate unavailable until timestamp
 */
export function getUnavailableUntil(cooldownMs) {
  return new Date(Date.now() + cooldownMs).toISOString();
}

const TERMINAL_ACCOUNT_STATES = new Set(["banned", "deactivated", "expired", "credits_exhausted"]);

/**
 * True for an account whose state is terminal (deactivated, banned, expired
 * or out of credits) or that was switched off. Such accounts are never
 * temporary cooldown candidates: no timer on them predicts recovery.
 * @param {object|null} account
 * @returns {boolean}
 */
export function isTerminalAccount(account) {
  if (!account) return false;
  if (account.isActive === false) return true;
  for (const field of [account.testStatus, account.status]) {
    if (isString(field) && TERMINAL_ACCOUNT_STATES.has(field.trim().toLowerCase())) return true;
  }
  return false;
}

/**
 * Get the earliest rateLimitedUntil from a list of accounts
 * @param {Array} accounts - Array of account objects with rateLimitedUntil
 * @returns {string|null} Earliest rateLimitedUntil ISO string, or null
 */
export function getEarliestRateLimitedUntil(accounts) {
  let earliest = null;
  const now = Date.now();
  for (const acc of accounts) {
    // Deactivated accounts do not recover when a timer expires, so their
    // deadline must never become a sibling's retry hint.
    if (isTerminalAccount(acc)) continue;
    if (!acc.rateLimitedUntil) continue;
    const until = new Date(acc.rateLimitedUntil).getTime();
    if (until <= now) continue;
    if (!earliest || until < earliest) earliest = until;
  }
  if (!earliest) return null;
  return new Date(earliest).toISOString();
}

/**
 * Format rateLimitedUntil to human-readable "reset after Xm Ys"
 * @param {string} rateLimitedUntil - ISO timestamp
 * @returns {string} e.g. "reset after 2m 30s"
 */
export function formatRetryAfter(rateLimitedUntil, now = Date.now()) {
  if (!rateLimitedUntil) return "";
  const diffMs = new Date(rateLimitedUntil).getTime() - now;
  if (diffMs <= 0) return "reset after 0s";
  const totalSec = Math.ceil(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor(totalSec % 3600 / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return `reset after ${parts.join(" ")}`;
}

/** Prefix for model lock flat fields on connection record */
export const MODEL_LOCK_PREFIX = "modelLock_";

/** Special key used when no model is known (account-level lock) */
export const MODEL_LOCK_ALL = `${MODEL_LOCK_PREFIX}__all`;

/** Build the flat field key for a model lock */
export function getModelLockKey(model) {
  return model ? `${MODEL_LOCK_PREFIX}${model}` : MODEL_LOCK_ALL;
}

/**
 * Check whether an exact-model or account-wide lock is still active.
 * Each applicable timestamp is validated independently so an expired exact
 * lock cannot mask an active account-wide lock.
 *
 * @param {object} connection - Provider connection containing flat lock fields.
 * @param {string|null} model - Requested model, or null for an account-wide lock.
 * @returns {boolean} Whether either applicable lock expires in the future.
 */
export function isModelLockActive(connection, model) {
  const now = Date.now();
  const exactExpiry = new Date(connection[getModelLockKey(model)] || "").getTime();
  const accountExpiry = new Date(connection[MODEL_LOCK_ALL] || "").getTime();
  const exactActive = Number.isFinite(exactExpiry) && exactExpiry > now;
  const accountActive = Number.isFinite(accountExpiry) && accountExpiry > now;
  return exactActive || accountActive;
}

/** Return the later applicable exact/account lock for one requested model. */
export function getActiveModelLockUntil(connection, model, now = Date.now()) {
  if (!connection) return null;
  const candidates = [connection[getModelLockKey(model)], connection[MODEL_LOCK_ALL]].
  map((value) => ({ value, timestamp: new Date(value || "").getTime() })).
  filter((entry) => Number.isFinite(entry.timestamp) && entry.timestamp > now);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.timestamp - a.timestamp);
  return new Date(candidates[0].timestamp).toISOString();
}

/**
 * Get earliest active model lock expiry across all modelLock_* fields.
 * Used for UI cooldown display.
 */
export function getEarliestModelLockUntil(connection) {
  if (!connection) return null;
  let earliest = null;
  const now = Date.now();
  for (const [key, val] of Object.entries(connection)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
    const t = new Date(val).getTime();
    if (t <= now) continue;
    if (!earliest || t < earliest) earliest = t;
  }
  return earliest ? new Date(earliest).toISOString() : null;
}

/**
 * Build update object to set a model lock on a connection.
 */
export function buildModelLockUpdate(model, cooldownMs) {
  const key = getModelLockKey(model);
  return { [key]: new Date(Date.now() + cooldownMs).toISOString() };
}

/**
 * Decide whether a fallback lock must be account-wide for a provider that has
 * opted into connection-wide error scoping (#6888).
 *
 * Only NVIDIA NIM (and any future provider explicitly flagged with
 * `passthroughConnectionWideErrors`) treats connection-class failures as
 * indicting the shared connection itself. A per-model 404 (stale/renamed
 * catalog id) or 429 (transient rate limit) retains the existing bounded
 * scope — the caller's canonical-model lock when the catalog id resolves,
 * account-wide when it does not (bounded-key invariant). Only failures where
 * the shared connection itself is at fault (5xx, or status 0 for network/
 * no-response) force the account-wide lock (`modelLock___all`).
 *
 * Providers without `passthroughConnectionWideErrors` are unaffected: callers
 * only consult this helper when the registry sets the flag, so OpenRouter and
 * other passthrough routers keep their 5xx responses model-scoped.
 *
 * @param {boolean} connectionWideErrors - registry `passthroughConnectionWideErrors` flag for the resolved provider
 * @param {number} status - HTTP status code from upstream (0 = network/no response)
 * @returns {boolean} true when the lock must be account-wide
 */
export function isPassthroughConnectionWideError(connectionWideErrors, status) {
  if (connectionWideErrors !== true) return false;
  const code = Number(status) || 0;
  return code === 0 || code >= 500;
}

/**
 * Build update object to clear all model locks on a connection.
 */
export function buildClearModelLocksUpdate(connection) {
  const cleared = {};
  for (const key of Object.keys(connection)) {
    if (key.startsWith(MODEL_LOCK_PREFIX)) cleared[key] = null;
  }
  return cleared;
}

/**
 * Filter available accounts (not in cooldown)
 */
export function filterAvailableAccounts(accounts, excludeId = null) {
  const now = Date.now();
  return accounts.filter((acc) => {
    if (excludeId && acc.id === excludeId) return false;
    if (isQuotaLockoutActive(acc, now)) return false;
    if (acc.rateLimitedUntil) {
      const until = new Date(acc.rateLimitedUntil).getTime();
      if (until > now) return false;
    }
    return true;
  });
}

/**
 * Reset account state when request succeeds
 * Clears cooldown and resets backoff level to 0
 * @param {object} account - Account object
 * @returns {object} Updated account with reset state
 */
export function resetAccountState(account) {
  if (!account) return account;
  return {
    ...account,
    rateLimitedUntil: null,
    backoffLevel: 0,
    lastError: null,
    status: "active"
  };
}

/**
 * Apply error state to account
 * @param {object} account - Account object
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message
 * @param {string} provider - Optional provider ID for provider-specific rules
 * @param {Headers|object|null} headers - Optional upstream response headers
 * @param {unknown} structuredError - Optional parsed upstream error body
 * @param {string|null} model - Model attempted by the request
 * @returns {object} Updated account with error state. `providerErrorScope`
 *   is set when a provider rule returned a `scope` (e.g. AgentRouter quota
 *   `connection`) so the lock layer can pick account-wide persistence.
 */
export function applyErrorState(account, status, errorText, provider = null, headers = null, structuredError = null, model = null) {
  if (!account) return account;

  const backoffLevel = account.backoffLevel || 0;
  const { cooldownMs, newBackoffLevel, scope } = checkFallbackError({
    status, errorText, backoffLevel, provider, headers, structuredError, model,
  });

  return {
    ...account,
    rateLimitedUntil: cooldownMs > 0 ? getUnavailableUntil(cooldownMs) : null,
    backoffLevel: newBackoffLevel ?? backoffLevel,
    lastError: { status, message: errorText, timestamp: new Date().toISOString() },
    status: "error",
    ...(scope ? { providerErrorScope: scope } : null)
  };
}
