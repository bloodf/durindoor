import { getProviderConnections, getSettings, updateProviderConnection } from "@/lib/localDb";
import {
  buildModelLockUpdate, checkFallbackError, countEligibleAccounts, detectQuotaExhaustion,
  durableCredentialReauthFields, isAntigravityCapacityError, isDurableCredentialProvider,
  isModelLockActive, isPassthroughConnectionWideError, isQuotaLockoutActive,
  isRecoverableCloudCodeProject403, isRelayGatewayFailure
} from "open-sse/services/accountFallback.js";
import { LOCAL_ENDPOINT_MAX_COOLDOWN_MS, MAX_RATE_LIMIT_COOLDOWN_MS, RESET_COOLDOWN_CAP_MS } from "open-sse/config/errorConfig.js";
import { isPrivateHost } from "open-sse/utils/outboundUrlGuard.js";
import { AI_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";
import { PROVIDER_ID_TO_ALIAS, getModelQuotaFamily } from "open-sse/config/providerModels.js";
import { getProviderQuotaConfig } from "open-sse/config/providerQuota.js";
import { resolveFallbackModelScope } from "open-sse/services/fallbackScope.js";
import { describeProviderError } from "open-sse/utils/error.js";
import { isQoderQuotaExhaustedBody } from "open-sse/executors/qoder.js";
import { connectionHasCredential, credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { modelUpstreamUpdate } from "@/shared/utils/modelLockUpstream.js";
import { isFunction, isObject, isString } from "@/shared/utils/typeChecks.js";
import { notifyWebhookEvent } from "@/lib/webhooks/index.js";
import { clearProviderRateLimitEvidence, recordProviderRateLimitEvidence } from "@/shared/services/providerRateLimitEvidence";
import { SETTINGS_SCHEMA } from "@/lib/settings/settingsSchema.js";
import * as log from "../../utils/logger.js";

const GITHUB_MONTHLY_USAGE_LIMIT = "you've reached your additional usage limit for your plan";
const FREE_TIER_STATIC_COOLDOWN_CAP_MS = 60 * 1000;
function antigravity429Fallback(errorText, errorBody, evidence = null) {
  // A redacted 429 has no credit wording left; the evidence still names it (#3394).
  if (evidence?.source === "antigravity_credits" || evidence?.creditsExhausted === true) {
    return { delay: 24 * 60 * 60 * 1000, exhausted: true, credits: true };
  }
  const text = `${isString(errorText) ? errorText : ""} ${JSON.stringify(errorBody || {})}`.toLowerCase();
  const credits = /google_one_ai|insufficient[_ ](?:g1_)?credits?|not enough credits?|credits? exhausted|credit balance|minimumcreditamountforusage|minimum credit|g1_credits/.test(text);
  const exhausted = /quota[_ ]exhausted|quota reached|individual quota|enable overages|free tier|daily limit|google_one_ai|insufficient[_ ](?:g1_)?credits?|not enough credits?|credits? exhausted|credit balance|minimumcreditamountforusage|minimum credit|g1_credits/.test(text);
  if (exhausted && !/reset\s+(?:after|in)\s+0s/.test(text)) return { delay: 24 * 60 * 60 * 1000, exhausted: true, credits };
  if (/per minute|\brpm\b|rate[_ ]limit|too many requests/.test(text)) return { delay: 60_000, exhausted: false };
  if (/try again|temporarily/.test(text)) return { delay: 2_000, exhausted: false };
  return { delay: 5_000, exhausted: false };
}
const CODEX_PERMANENT_OAUTH_ERRORS = [
"invalidated oauth token",
"authentication token has been invalidated",
"refresh_token_invalidated",
"refresh_token_reused",
"refresh token already used"];


function isCodexPermanentOAuthError(provider, status, errorText) {
  if (provider !== "codex" || Number(status) !== 401) return false;
  const text = String(errorText || "").toLowerCase();
  return CODEX_PERMANENT_OAUTH_ERRORS.some((sig) => text.includes(sig));
}

// One request above the whole rate limit (Groq: "Limit 8000, Requested 36955")
// cannot succeed on a sibling account either (OmniRoute #21051). Requested at or
// below the limit is a used-up window, which another account can still serve.
function isRequestLargerThanRateLimit(status, errorText) {
  if (Number(status) !== 413) return false;
  const match = /\blimit:?\s*(\d+),\s*requested:?\s*(\d+)/i.exec(String(errorText || ""));
  return Boolean(match) && Number(match[2]) > Number(match[1]);
}

function githubMonthlyResetMs(status, errorText, provider) {
  if (resolveProviderId(provider) !== "github" || Number(status) !== 402) return null;
  if (!String(errorText || "").toLowerCase().includes(GITHUB_MONTHLY_USAGE_LIMIT)) return null;
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

/**
 * Detect Qoder's permanent account quota signal from structured executor data.
 * Rendered messages are untrusted text and must not widen this trigger (#3331).
 */
const QODER_QUOTA_PROVIDER_IDS = new Set(["qoder", "qoder-cn"]);

function isQoderQuotaExhausted(status, errorText, provider, errorBody = null) {
  if (!QODER_QUOTA_PROVIDER_IDS.has(resolveProviderId(provider)) || Number(status) !== 403) return false;
  if (errorBody && isObject(errorBody)) {
    return isQoderQuotaExhaustedBody(errorBody?.error?.message);
  }
  const candidate = String(errorText || "").trim().replace(/^\[\d+\]:\s*/, "");
  return candidate.startsWith("{") && isQoderQuotaExhaustedBody(candidate);
}
/** The connection's own saved base URL names a loopback or private-network host. */
function isPrivateEndpointConnection(connection) {
  const baseUrl = connection?.providerSpecificData?.baseUrl;
  if (!isString(baseUrl) || !URL.canParse(baseUrl.trim())) return false;
  const { hostname } = new URL(baseUrl.trim());
  return Boolean(hostname) && isPrivateHost(hostname);
}

function isRateLimitOrTransientStatus(status) {
  const code = Number(status);
  return code === 408 || code === 429 || code >= 500;
}

const FREEBUFF_TRANSIENT_STATUSES = new Set([408, 409, 425, 429]);

const SHORT_COOLDOWN_PROVIDERS = new Set([
...Object.keys(FREE_PROVIDERS),
...Object.keys(FREE_TIER_PROVIDERS)]
);
/**
 * Resolves decolua/9router#2895 static fallback policy after provider-reset
 * normalization. Configured delays win; free and free-tier providers cap only
 * the Auto/default fallback. Authoritative reset deadlines bypass this helper.
 * @param {string|null} provider
 * @param {number} defaultCooldownMs
 * @returns {Promise<{cooldownMs: number, configured: boolean}>}
 */
async function resolveStaticRetryCooldown(provider, defaultCooldownMs) {
  const providerKey = resolveProviderId(provider);
  let cooldownMs = defaultCooldownMs;
  let configured = false;
  try {
    const selectedSeconds = (await getSettings())?.retryDelayByProvider?.[providerKey];
    const seconds = Number(selectedSeconds);
    if (selectedSeconds != null && selectedSeconds !== "" && selectedSeconds !== "auto" && Number.isFinite(seconds) && seconds > 0) {
      cooldownMs = Math.min(seconds * 1000, MAX_RATE_LIMIT_COOLDOWN_MS);
      configured = true;
    }
  } catch {

    // Settings failure keeps the validated BACKOFF_CONFIG schedule.
  }
  if (!configured && SHORT_COOLDOWN_PROVIDERS.has(providerKey)) {
    cooldownMs = Math.min(cooldownMs, FREE_TIER_STATIC_COOLDOWN_CAP_MS);
  }
  return { cooldownMs, configured };
}

/**
 * OmniRoute #20457: ceiling for a reset read from a relative prose countdown
 * ("Resets in 76h25m43s"). Providers often reset such windows early, so the
 * account is re-probed instead of benched for the whole stated wait. Header and
 * structured-body resets never pass through here.
 */
async function quotaProseDeadlineMs(now) {
  const rule = SETTINGS_SCHEMA.quotaProseMaxCooldownMs;
  let configured = rule.default;
  try {
    const stored = Number((await getSettings())?.quotaProseMaxCooldownMs);
    if (Number.isSafeInteger(stored) && stored >= rule.minimum && stored <= rule.maximum) configured = stored;
  } catch {
    // A settings read failure keeps the default ceiling.
  }
  return now + configured;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 * All errors (429, 401, 5xx, etc.) lock per model, not per account.
 * @param {string} connectionId
 * @param {number} status - HTTP status code from upstream
 * @param {string} errorText
 * @param {string|null} provider
 * @param {string|null} model - The specific model that triggered the error
 * @param {number|null} resetsAtMs - Provider-supplied reset timestamp, when known
 * @param {object} context - Extra attempt state. `context.usedCredential` carries the
 *   credential the rejected request actually presented, so a durable-credential
 *   provider can mark exactly the generation that was rejected and skip one a newer
 *   login has already replaced.
 * @returns {{ shouldFallback: boolean, cooldownMs: number }}
 */
/**
 * OmniRoute #10920, adapted: cools down every sibling connection that shares
 * the failing connection's proxy pool, for providers whose upstream quota is
 * bucketed by egress IP rather than by account (operator opt-in via
 * `settings.egressBucketedProviders`). DurinDoor has no historical egress-IP
 * log (unlike OmniRoute's proxy_logs), so the bucket key is the connection's
 * configured `providerSpecificData.proxyPoolId` (src/lib/db/repos/proxyPoolsRepo.js)
 * -- connections routed through the same pool share the same egress IP.
 * Connections with no pool configured ("direct") are never bucketed together:
 * grouping every direct connection would assume they all share one host IP,
 * which does not hold for most deployments.
 *
 * Best-effort and side-effect-safe: `connections` is the same provider-scoped
 * list `markAccountUnavailable` already fetched, so this makes no extra DB
 * read for the sibling set. A sibling is skipped when it has no matching pool,
 * is already reauth-quarantined or disabled, or already has an active lock
 * (never shortens an existing cooldown). Any per-sibling write failure is
 * logged and does not affect the failing connection's own state.
 */
async function applyEgressBucketCooldown(connections, connectionId, provider, cooldownMs) {
  const self = connections.find((c) => c.id === connectionId);
  const bucket = self?.providerSpecificData?.proxyPoolId;
  if (!isString(bucket) || !bucket.trim()) return;
  let cooledCount = 0;
  for (const sibling of connections) {
    if (sibling.id === connectionId) continue;
    if (sibling.providerSpecificData?.proxyPoolId !== bucket) continue;
    if (sibling.testStatus === "reauth_required" || sibling.isActive === false) continue;
    if (isModelLockActive(sibling, null)) continue;
    try {
      await updateProviderConnection(sibling.id, {
        ...buildModelLockUpdate(null, cooldownMs),
        testStatus: "unavailable",
        lastError: `Shared egress IP rate limited (${provider})`,
        errorCode: 429
      });
      cooledCount += 1;
    } catch (error) {
      log.warn("AUTH", `Egress-bucket cooldown skipped for ${sibling.id.slice(0, 8)}: ${error.message}`);
    }
  }
  if (cooledCount > 0) {
    log.warn("AUTH", `Egress-bucketed cooldown: ${provider} pool=${bucket} cooled ${cooledCount} sibling(s) for ${Math.round(cooldownMs / 1000)}s`);
  }
}

/** Attempt-start watermark: explicit attempt stamp, then dispatch snapshot. */
function dispatchStamp(context) {
  if (Number.isSafeInteger(context?.attemptStartedAt)) return context.attemptStartedAt;
  if (Number.isSafeInteger(context?.dispatchedAt) && context.dispatchedAt > 0) return context.dispatchedAt;
  return Date.now();
}

export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null, resetsAtMs = null, context = {}) {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };
  // A reset hint must not turn this into account rotation or a lock.
  if (isRequestLargerThanRateLimit(status, errorText)) return { shouldFallback: false, cooldownMs: 0 };
  const signal = context?.signal || null;
  throwIfAborted(signal);
  const observedAt = dispatchStamp(context);
  const connections = await getProviderConnections({ provider });

  throwIfAborted(signal);
  const conn = connections.find((c) => c.id === connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  if ((provider === "antigravity" || provider === "agy") && isAntigravityCapacityError(status, errorText)) {
    log.warn("AUTH", `${connectionId.slice(0, 8)} hit Antigravity capacity; fallback without cooldown [${status}]`);
    return { shouldFallback: true, cooldownMs: 0 };
  }

  if (isRecoverableCloudCodeProject403(provider, status, errorText)) {
    log.warn("AUTH", `${connectionId.slice(0, 8)} hit recoverable Cloud Code project 403; fallback without cooldown`);
    return { shouldFallback: true, cooldownMs: 0 };
  }

  // Every Freebuff admission bills a session hour on the account that takes it
  // (OmniRoute #20655), so a transient failure neither rotates nor cools down.
  // Spent Freebucks and rejected credentials still take the ordinary path.
  const freebuff = resolveProviderId(provider) === "freebuff";
  const freebucksSpent = freebuff && context?.rateLimitEvidence?.state === "exhausted";
  if (freebuff && !freebucksSpent && (FREEBUFF_TRANSIENT_STATUSES.has(Number(status)) || Number(status) >= 500)) {
    log.warn("AUTH", `${connectionId.slice(0, 8)} Freebuff transient failure; keeping this account [${status}]`);
    return { shouldFallback: false, cooldownMs: 0 };
  }

  if (isCodexPermanentOAuthError(provider, status, errorText)) {
    const clearLocks = Object.fromEntries(
      Object.keys(conn || {}).
      filter((field) => field.startsWith("modelLock_")).
      map((field) => [field, null])
    );
    log.warn("AUTH", `${connectionId.slice(0, 8)} hit permanent Codex OAuth invalidation; quarantining for reauth [${status}]`);
    notifyWebhookEvent("account.reauth_required", { provider, connection: connectionId.slice(0, 8), status: Number(status) || null }, { throttleKey: connectionId });
    await updateProviderConnection(connectionId, {
      ...clearLocks,
      testStatus: "reauth_required",
      isActive: false,
      errorCode: status,
      lastError: "Codex OAuth token invalidated; reauthorization required",
      lastErrorAt: new Date(observedAt).toISOString(),
      backoffLevel: 0
    });
    return { shouldFallback: true, cooldownMs: 0 };
  }
  // A durable credential (OrcaRouter key) has no refresh grant, so a rejection
  // is terminal. Quarantine the exact account the way Codex does: out of
  // rotation, reauth_required (which clearAccountError never clears), until a
  // new login or key replaces it. `expectedUpdatedAt` skips the write when the
  // row changed after it was loaded, so a key saved by a concurrent re-login is
  // never stamped as rejected.
  if (isDurableCredentialProvider(resolveProviderId(provider))) {
    // A late failure from a key the user has since replaced says nothing about
    // the stored key: no status, lock, or backoff lands on the replacement.
    const usedCredential = context?.usedCredential ?? null;
    if (conn && usedCredential && conn.accessToken !== usedCredential && conn.apiKey !== usedCredential) {
      return { shouldFallback: true, cooldownMs: 0 };
    }
    const reauthFields = durableCredentialReauthFields(conn, context?.usedCredential ?? null, status, errorText);
    if (reauthFields) {
      const clearLocks = Object.fromEntries(
        Object.keys(conn).
        filter((field) => field.startsWith("modelLock_")).
        map((field) => [field, null])
      );
      try {
        await updateProviderConnection(connectionId, {
          ...clearLocks,
          ...reauthFields,
          testStatus: "reauth_required",
          isActive: false,
          errorCode: status,
          lastError: "OrcaRouter credential rejected, sign in again",
          lastErrorAt: new Date(observedAt).toISOString(),
          backoffLevel: 0
        }, { expectedUpdatedAt: conn.updatedAt || null });
        log.warn("AUTH", `${connectionId.slice(0, 8)} durable credential rejected with ${status}; quarantining for reauth`);
        notifyWebhookEvent("account.reauth_required", { provider, connection: connectionId.slice(0, 8), status: Number(status) || null }, { throttleKey: connectionId });
      } catch (error) {
        if (error?.code !== "PROVIDER_CONNECTION_REVISION_CONFLICT") throw error;
        log.warn("AUTH", `${connectionId.slice(0, 8)} changed before the reauth write; leaving the newer credential alone`);
      }
      return { shouldFallback: true, cooldownMs: 0 };
    }
  }
  // Qoder code 112 cannot recover through a timed model cooldown. Persist a
  // dedicated discriminator so renderers never mistake stale generic errors
  // for this automatic account-wide disable (#3331).
  if (isQoderQuotaExhausted(status, errorText, provider, context?.errorBody)) {
    const reason = isString(errorText) ?
    errorText.slice(0, 200) :
    "Qoder quota exhausted (code 112)";
    const disabledAt = new Date(observedAt).toISOString();
    await updateProviderConnection(connectionId, {
      isActive: false,
      testStatus: "unavailable",
      lastError: reason,
      errorCode: 403,
      lastErrorAt: disabledAt,
      autoDisabledReason: reason,
      autoDisabledAt: disabledAt,
      backoffLevel: 0
    });
    log.warn("AUTH", `${connectionId.slice(0, 8)} disabled: Qoder quota exhausted [403/code 112]`);
    notifyWebhookEvent("quota.exhausted", { provider, connection: connectionId.slice(0, 8), model, resetAt: null }, { throttleKey: connectionId });
    return { shouldFallback: true, cooldownMs: 0 };
  }

  // A proven relay/hop failure is not evidence about this credential, and a
  // cooldown buys nothing when at most one account in the request scope could
  // serve it: there is nothing to rotate to, so the lock only turns one
  // transient gateway blip into a 30s "all accounts locked" outage. The
  // upstream error is returned to the client unchanged so it can retry.
  //
  // Multi-account deployments keep the cooldown — rotation depends on it — and
  // a bare 502/503/504 without transport provenance is a provider failure, not
  // a relay failure, so it keeps its cooldown too.
  if (!context?.hasComboFallback && !context?.rateLimitEvidence &&
      isRelayGatewayFailure(status, { transportFailure: context?.transportFailure ?? null })) {
    const eligibleAccounts = countEligibleAccounts(connections, {
      model,
      excludedConnectionIds: context?.excludedConnectionIds ?? null,
    });
    if (eligibleAccounts === 1 && connections.some((connection) => connection.id === connectionId &&
        countEligibleAccounts([connection], { model, excludedConnectionIds: context?.excludedConnectionIds ?? null }) === 1)) {
      log.warn("AUTH", `${connectionId.slice(0, 8)} hit a relay/hop failure with ${eligibleAccounts} eligible account(s); skipping the credential cooldown [${status}]`);
      return { shouldFallback: false, cooldownMs: 0 };
    }
  }

  // GitHub premium-request exhaustion is account-wide until the next UTC month.
  const githubResetAtMs = githubMonthlyResetMs(status, errorText, provider);

  // Provider-specific precise cooldown (e.g. codex usage_limit_reached resets_at) overrides backoff
  // The transactional predicate protects a manual schedule or newer credential
  // from a late response. Model locks and quota evidence are left intact.
  // A caller may supply structured quota evidence instead of message text: an
  // adapter that read a provider's documented quota signal (adobe-firefly-api
  // 403 `x-access-error: quota_exhausted`) reports a resetless exhaustion of
  // the selected connection, with no reset unless one was proven.
  const quota = context?.quotaExhausted === true ?
  { exhausted: true, resetAtMs: null } :
  detectQuotaExhaustion(context?.errorBody ?? errorText);
  if (quota.exhausted && (Number(status) === 200 || Number(status) >= 400 && Number(status) <= 599)) {
    let hinted = Number(resetsAtMs) > Date.now() ? Number(resetsAtMs) : null;
    if (hinted && context?.rateLimitEvidence?.source === "quota_text" && context.rateLimitEvidence.relativeCountdown) {
      hinted = Math.min(hinted, await quotaProseDeadlineMs(Date.now()));
    }
    const reset = quota.resetAtMs || hinted;
    const fingerprint = context?.credentialFingerprint || null;
    await updateProviderConnection(connectionId, {
      quotaLockout: { status: "quota_exhausted", source: "auto", message: "Provider quota exhausted", detectedAt: new Date(observedAt).toISOString(), reactivateAt: reset ? new Date(reset).toISOString() : null }
    }, { signal, shouldCommitConnection: (current) => (current.quotaLockout?.source !== "manual" || !isQuotaLockoutActive(current)) && (!current.updatedAt || Date.parse(current.updatedAt) <= observedAt) && connectionHasCredential(current, fingerprint) });
    return { shouldFallback: true, cooldownMs: reset ? Math.max(0, reset - Date.now()) : 0 };
  }
  let shouldFallback, cooldownMs, newBackoffLevel;
  const now = Date.now();
  // OmniRoute #6731: classify first so an explicit quota-exhausted body on an
  // apikey-category 429 is honored even when the caller supplied no evidence.
  // effectiveEvidence = caller-supplied evidence, else whatever checkFallbackError
  // parsed from the body; its state/reset then drive the deadline uniformly.
  const callerEvidence =
  context?.rateLimitEvidence && isObject(context.rateLimitEvidence) ?
  context.rateLimitEvidence :
  null;
  const fallbackResult = checkFallbackError({
    status,
    errorText,
    backoffLevel,
    provider,
    headers: context?.headers,
    structuredError: context?.errorBody,
    model,
  });
  // A request-scoped OpenRouter error must stay off the account even
  // when the upstream response supplies a reset hint.
  // A capability gap or request-size 5xx stays off the account the same way.
  if (fallbackResult.noAccountPenalty ||
      fallbackResult.requestScoped && (Number(status) === 404 || provider === "openrouter" && Number(status) === 400)) {
    return { shouldFallback: false, cooldownMs: 0 };
  }
  const effectiveEvidence = callerEvidence || fallbackResult.rateLimitEvidence || null;
  const ag429 = (provider === "antigravity" || provider === "agy") && Number(status) === 429 ?
  antigravity429Fallback(errorText, context?.errorBody, callerEvidence) : null;
  const evidenceState = effectiveEvidence?.state === "exhausted" || ag429?.exhausted ? "exhausted" : "cooldown";
  // Precedence: (1) caller-supplied normalized evidence is authoritative — its
  // null reset is a deliberate rejection of any legacy reset; (2) a reset parsed
  // from the body by checkFallbackError wins; (3) otherwise the caller's legacy
  // resetsAtMs applies, so an explicit quota-exhausted 429 keeps its real reset
  // window instead of collapsing to the short transient bench.
  const parsedEvidenceReset = Number(fallbackResult.rateLimitEvidence?.resetAtMs);
  const rawProviderReset = callerEvidence ?
  callerEvidence.resetAtMs :
  Number.isFinite(parsedEvidenceReset) && parsedEvidenceReset > now ?
  parsedEvidenceReset :
  resetsAtMs;
  const providerReset = Number(rawProviderReset);
  // Provider-specific precise cooldown (codex resets_at, kiro confirmed credit
  // exhaustion) is capped at a provider-appropriate max so a far-future reset
  // doesn't lock the account past its next low-frequency recheck (#2664).
  const cooldownCapMs = RESET_COOLDOWN_CAP_MS[provider] ?? MAX_RATE_LIMIT_COOLDOWN_MS;
  let normalizedReset = githubResetAtMs || (Number.isFinite(providerReset) && providerReset > now ?
  Math.min(providerReset, now + cooldownCapMs) :
  ag429 ? now + ag429.delay : null);
  if (normalizedReset !== null && effectiveEvidence?.source === "quota_text" && effectiveEvidence.relativeCountdown && !githubResetAtMs) {
    normalizedReset = Math.min(normalizedReset, await quotaProseDeadlineMs(now));
  }
  // A private endpoint ignores long reset hints and the backoff ladder.
  const localCapMs = isRateLimitOrTransientStatus(status) && isPrivateEndpointConnection(conn) ?
  LOCAL_ENDPOINT_MAX_COOLDOWN_MS : null;
  if (localCapMs !== null && normalizedReset !== null) {
    normalizedReset = Math.min(normalizedReset, now + localCapMs);
  }
  if (normalizedReset !== null) {
    shouldFallback = true;
    cooldownMs = Math.ceil(normalizedReset - now);
    newBackoffLevel = 0;
  } else {
    ({ shouldFallback, cooldownMs, newBackoffLevel } = fallbackResult);
    if (shouldFallback) {
      const staticRetry = await resolveStaticRetryCooldown(provider, cooldownMs);
      cooldownMs = staticRetry.cooldownMs;
      if (staticRetry.configured) newBackoffLevel = 0;
      // An operator-configured retry delay still wins over the local cap.
      else if (localCapMs !== null) {
        cooldownMs = Math.min(cooldownMs, localCapMs);
        newBackoffLevel = 0;
      }
    }
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };
  // Durable reauth outranks ordinary cooldowns on every model. Classify first
  // so request-terminal 413/499 still return without account fallback. Only
  // explicit credential replacement may revive this quarantined account.
  if (conn?.testStatus === "reauth_required" || conn?.errorCode === "REAUTH") {
    return { shouldFallback: true, cooldownMs: 0 };
  }

  cooldownMs = Math.max(0, Math.ceil(cooldownMs));
  const deadline = normalizedReset !== null ?
  normalizedReset :
  now + cooldownMs;
  const legacyCooldownMs = Math.max(
    0,
    githubResetAtMs ? Math.ceil(deadline - observedAt) : Math.min(Math.ceil(deadline - observedAt), cooldownCapMs)
  );
  const reasonCode = Number(status) === 429 ?
  "rate_limited" :
  Number(status) === 401 || Number(status) === 403 ?
  "authentication_error" :
  Number(status) === 502 ?
  "network_error" :
  "provider_error";
  // Rate-limit text stays stable for users; other failures retain a bounded,
  // sanitized operator diagnostic such as `fetch failed (ECONNREFUSED)`.
  const reason = reasonCode === "rate_limited" ? "Rate limited" : describeProviderError(errorText);
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const quotaFamily = getModelQuotaFamily(alias, model);
  const hasFamilyScope = Boolean(quotaFamily && getProviderQuotaConfig(provider)?.preflightScopes?.quotaFamilies?.[quotaFamily]);
  // A caller that proved the exhaustion belongs to one capability (image
  // generation) keeps it on the failed model; ordinary chat paths do not set
  // this and retain the provider's account-wide exhaustion scope.
  const modelScopedExhaustion = context?.exhaustionScope === "model";
  const accountWideRuntime = Number(status) === 429 &&
  evidenceState === "exhausted" &&
  !hasFamilyScope &&
  !modelScopedExhaustion &&
  getProviderQuotaConfig(provider)?.runtimeScopes?.exhausted === "account";
  // #6888: only providers flagged `passthroughConnectionWideErrors` treat
  // connection-class failures (5xx, network) as account-wide. NVIDIA NIM is
  // currently the only opt-in provider; generic passthrough routers such as
  // OpenRouter keep 5xx responses model-scoped.
  const passthroughConnectionError = isPassthroughConnectionWideError(
    AI_PROVIDERS[resolveProviderId(provider)]?.passthroughConnectionWideErrors,
    status
  );
  const providerRuleConnectionWide = fallbackResult.scope === "connection" || (provider === "claude" && callerEvidence?.scope === "connection");
  // Freebucks are one pool per account, so every model on it is spent.
  const accountWide = Boolean(freebucksSpent || githubResetAtMs || accountWideRuntime || passthroughConnectionError || providerRuleConnectionWide || ag429?.credits);
  const isolatedSearch = context?.webSearch === true && !accountWide;
  const fallbackModel = resolveFallbackModelScope(provider, model, {
    accountWide,
    webFetch: context?.webFetch === true,
    webSearch: context?.webSearch === true,
    videoPoll: context?.videoPoll === true
  });
  // A model-only denial (Kilo PAID_MODEL_AUTH_REQUIRED) with no bounded model
  // scope would collapse to the account-wide lock and bench the free models on
  // the same connection. Rotate to the next candidate without writing any lock.
  if (fallbackResult.modelOnly && !fallbackModel) {
    log.warn("AUTH", `${connectionId.slice(0, 8)} model-only denial for an unbounded model id; skipping the lock [${status}]`);
    return { shouldFallback: true, cooldownMs: 0 };
  }
  let atomicApplied = false;
  try {
    const db = await import("@/lib/localDb");
    if (isFunction(db.recordProviderConnectionFallbackState)) {
      const recorded = await db.recordProviderConnectionFallbackState(connectionId, {
        model: fallbackModel,
        status,
        reasonCode,
        reason,
        cooldownMs: legacyCooldownMs,
        backoffLevel: newBackoffLevel ?? backoffLevel,
        observedAt,
        credentialFingerprint: context?.credentialFingerprint || null,
        webFetch: context?.webFetch === true,
        webSearch: isolatedSearch,
        videoPoll: context?.videoPoll === true,
        // Only a deadline the upstream stated may extend a newer, shorter lock.
        upstreamReset: Boolean(githubResetAtMs || providerReset > now || fallbackResult.retryHintSource)
      }, { signal });
      // The atomic path ran; never fall through to the compatibility writer,
      // even when applied is false (stale watermark or reauth guard).
      atomicApplied = true;
      const fingerprint = context?.credentialFingerprint || null;
      if (recorded?.applied === false && fingerprint && !connectionHasCredential(recorded.connection, fingerprint)) {
        return { shouldFallback: true, cooldownMs: 0 };
      }
      // A transactional reauth conflict refused the ordinary cooldown write.
      // Match the pre-write reauth early-return: fallback without a cooldown.
      if (recorded?.applied === false &&
        (recorded.connection?.testStatus === "reauth_required" || recorded.connection?.errorCode === "REAUTH")) {
        return { shouldFallback: true, cooldownMs: 0 };
      }
    }
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    log.warn("AUTH", "Atomic fallback-state update failed; using compatibility update");
  }
  if (!atomicApplied) {
    const lockUpdate = buildModelLockUpdate(fallbackModel, legacyCooldownMs);
    if (isolatedSearch) lockUpdate[`modelError_${fallbackModel}`] = Number(status) || 503;
    if (!isolatedSearch && context?.webFetch !== true && fallbackModel) {
      Object.assign(lockUpdate, modelUpstreamUpdate(fallbackModel, {
        status, message: reason, lockUntil: lockUpdate[`modelLock_${fallbackModel}`]
      }));
    }
    // Same reauth guard as recordProviderConnectionFallbackState: re-read inside
    // the write transaction so a concurrent durable reauth is never demoted when
    // the atomic path threw and this compatibility writer runs (#1324/#1311).
    const recorded = await updateProviderConnection(
      connectionId,
      context?.webFetch === true || isolatedSearch ? lockUpdate : {
        ...lockUpdate,
        testStatus: "unavailable",
        lastError: reason,
        errorCode: status,
        lastErrorAt: new Date(observedAt).toISOString(),
        backoffLevel: newBackoffLevel ?? backoffLevel
      },
      { refuseIfReauth: true, returnCommitResult: true }
    );
    if (recorded?.applied === false &&
      (recorded.connection?.testStatus === "reauth_required" || recorded.connection?.errorCode === "REAUTH")) {
      return { shouldFallback: true, cooldownMs: 0 };
    }
  }

  if (Number(status) === 429) {
    try {
      const evidenceWrite = {
        connectionId,
        provider,
        model,
        attemptStartedAt: observedAt,
        state: evidenceState,
        // A no-reset plan exhaustion is persisted without inventing the short
        // compatibility breaker as a provider reset. Generic cooldown evidence
        // may use that bounded local deadline.
        resetAtMs: evidenceState === "exhausted" ? normalizedReset : normalizedReset || deadline,
        signal
      };
      if (modelScopedExhaustion) evidenceWrite.exhaustionScope = "model";
      await recordProviderRateLimitEvidence(evidenceWrite);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      log.warn("QUOTA", "Runtime rate-limit evidence could not be persisted");
    }

    // OmniRoute #10920, adapted: cool down sibling connections sharing the
    // same proxy pool for operator-opted-in egress-bucketed providers. Skips
    // a request-shaped/terminal failure (fallbackResult.terminal) since those
    // say nothing about the shared IP's quota.
    if (provider && !ag429 && !fallbackResult.terminal) {
      try {
        const currentSettings = await getSettings();
        const egressBucketed = Array.isArray(currentSettings?.egressBucketedProviders) &&
        currentSettings.egressBucketedProviders.includes(String(provider).toLowerCase());
        if (egressBucketed) {
          await applyEgressBucketCooldown(connections, connectionId, provider, cooldownMs);
        }
      } catch (error) {
        log.warn("AUTH", `Egress-bucket cooldown lookup failed: ${error.message}`);
      }
    }
  }

  log.warn("AUTH", `${connectionId.slice(0, 8)} locked requested scope for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  const retryAtKnown = !(Number(status) === 429 && evidenceState === "exhausted" && normalizedReset === null);
  // Operator webhooks (#1118): one event per locked scope, throttled per scope.
  const quotaExhausted = Number(status) === 429 && evidenceState === "exhausted";
  notifyWebhookEvent(quotaExhausted ? "quota.exhausted" : "account.cooldown", {
    provider,
    connection: connectionId.slice(0, 8),
    model: fallbackModel || null,
    status: Number(status) || null,
    reason: reasonCode,
    cooldownMs,
    resetAt: retryAtKnown ? new Date(deadline).toISOString() : null
  }, { throttleKey: `${connectionId}:${fallbackModel || "*"}` });
  return {
    shouldFallback: true,
    cooldownMs,
    retryAt: retryAtKnown ? new Date(deadline).toISOString() : null,
    retryAtKnown,
    status: Number(status) || 503
  };
}

/**
 * Clear account error status on successful request.
 * - Clears modelLock_${model} (the model that just succeeded)
 * - Lazy-cleans any other expired modelLock_* keys
 * - Resets error state only if no active locks remain
 * @param {string} connectionId
 * @param {object} currentConnection - credentials object (has _connection) or raw connection
 * @param {string|null} model - model that succeeded
 */
export async function clearAccountError(connectionId, currentConnection, model = null, context = {}) {
  if (!connectionId || connectionId === "noauth") return;
  const conn = currentConnection._connection || currentConnection;
  const signal = context?.signal || null;
  throwIfAborted(signal);
  const now = dispatchStamp(context);
  const provider = context?.provider || conn?.provider;
  // An explicit dispatch snapshot wins, even a null one (derived/refreshed token).
  const fingerprint = context && Object.hasOwn(context, "credentialFingerprint") ?
  context.credentialFingerprint || null :
  credentialDispatchSnapshot(currentConnection).credentialFingerprint;
  const fallbackModel = resolveFallbackModelScope(provider, model, { webFetch: context?.webFetch === true, webSearch: context?.webSearch === true, videoPoll: context?.videoPoll === true });
  let atomicApplied = false;
  try {
    const db = await import("@/lib/localDb");
    if (isFunction(db.clearProviderConnectionFallbackState)) {
      const cleared = await db.clearProviderConnectionFallbackState(connectionId, {
        model: fallbackModel,
        observedAt: now,
        credentialFingerprint: fingerprint,
        webFetch: context?.webFetch === true,
        webSearch: context?.webSearch === true
      }, { signal });
      atomicApplied = true;
      if (cleared?.applied === false && !connectionHasCredential(cleared.connection, fingerprint)) return;
    }
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    log.warn("AUTH", "Atomic fallback-state clear failed; using compatibility update");
  }

  const allLockKeys = Object.keys(conn).filter((k) => k.startsWith("modelLock_"));
  if (!atomicApplied && (conn.testStatus || conn.lastError || conn.quotaLockout?.status || allLockKeys.length > 0)) {
    const isolated = context?.webFetch === true || context?.webSearch === true;
    const relevantLockKeys = isolated ?
    allLockKeys.filter((k) => k === `modelLock_${fallbackModel}`) :
    allLockKeys.filter((k) => !k.startsWith("modelLock_webfetch:") && !k.startsWith("modelLock_websearch:"));
    const keysToClear = relevantLockKeys.filter((k) => {
      if (fallbackModel && k === `modelLock_${fallbackModel}`) return true;
      if (model && k === `modelLock_${model}`) return true;
      if (model && k === "modelLock___all") return true;
      const expiry = conn[k];
      return expiry && new Date(expiry).getTime() <= now;
    });
    const remainingActiveLocks = relevantLockKeys.filter((k) => {
      if (keysToClear.includes(k)) return false;
      const expiry = conn[k];
      return expiry && new Date(expiry).getTime() > now;
    });
    const clearObj = Object.fromEntries(keysToClear.map((k) => [k, null]));
    if (context?.webSearch === true && fallbackModel) clearObj[`modelError_${fallbackModel}`] = null;
    const activeQuotaLockout = isQuotaLockoutActive(conn, now);
    if (!isolated && conn.quotaLockout?.status && !activeQuotaLockout) {
      clearObj.quotaLockout = null;
    }
    // Never let ordinary request success clear a durable reauth_required state;
    // only a successful OAuth reconnect (which writes testStatus:"active"
    // directly) may revive the account. See connectionsRepo fallback-clear guard.
    const reauthPinned = conn.testStatus === "reauth_required" || conn.errorCode === "REAUTH";
    if (!isolated && !reauthPinned && !activeQuotaLockout && remainingActiveLocks.length === 0) {
      Object.assign(clearObj, { testStatus: "active", lastError: null, lastErrorAt: null, backoffLevel: 0 });
    }
    if (Object.keys(clearObj).length > 0) await updateProviderConnection(connectionId, clearObj);
  }

  try {
    await clearProviderRateLimitEvidence({
      connectionId,
      provider,
      model,
      attemptStartedAt: now,
      signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    log.warn("QUOTA", "Runtime rate-limit evidence could not be cleared");
  }
}

