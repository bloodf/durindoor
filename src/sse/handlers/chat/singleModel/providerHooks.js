import { markAccountUnavailable } from "../../../services/auth.js";
import { hasAlternateAccount } from "../../../services/auth/alternateAccount.js";
import { withRouteResponseHeaders } from "open-sse/utils/routeResponseHeaders.js";
import { KIMI_CODING_MODELS_URL } from "open-sse/providers/shared.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { warmLiveModelLimits } from "open-sse/services/liveModelLimits.js";
import { enforceCursorCapabilities, getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { parseSuffix } from "open-sse/translator/concerns/thinkingSuffix.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { errorResponse } from "open-sse/utils/error.js";
import { comboPolicyRejection } from "open-sse/services/combo.js";
import { isAntigravityCapacityError } from "open-sse/services/accountFallback.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { updateProviderCredentials } from "../../../services/tokenRefresh.js";
import { resolveChatgptPlanDispatch } from "../../../services/chatgptPlanDispatch.js";
import { evaluateProviderQuotaPreflight } from "@/shared/services/providerQuotaPreflight";
import { refreshProviderQuota } from "@/shared/services/providerQuotaTracker";
import * as log from "../../../utils/logger.js";
import { requestAborted } from "../shared.js";
import { terminal, RETRY, proceed, proxyOptionsFromCredentials, accountSelectionOptions, MAX_ACCOUNT_ATTEMPTS_PER_REQUEST } from "./context.js";

/**
 * Provider-specific branches of the single-model pipeline: Antigravity/agy
 * 429 strikes and capacity sweeps, Kimi live-model URL, ChatGPT plan dispatch
 * and Cursor capability enforcement. The stage modules call these hooks so
 * they stay free of provider name checks.
 */

export const ANTIGRAVITY_CAPACITY_SWEEP_RETRIES = 2;
const ANTIGRAVITY_STRIKE_WINDOW_MS = 60_000;
const ANTIGRAVITY_STRIKE_BLOCK_MS = 15 * 60_000;
// Google's quota API can report remaining quota while generation endpoints
// keep returning 429 for other reasons (content-triggered rejections). Only
// count a 429 toward the strike breaker when parseUpstreamError found an
// actual quota marker in the raw body (result.antigravityQuotaSignal); the
// client-facing result.error is always the redacted "Rate limit exceeded"
// message for every 429, so matching markers against it never fires. A
// generic 429 still gets the normal cooldown but never trips the breaker.
const antigravity429Strikes = new Map();

export function isAntigravityProvider(provider) {
  return provider === "antigravity" || provider === "agy";
}

function antigravityStrikeKey(connectionId, model) {
  return `${connectionId}|${model}`;
}

export function clearAntigravity429Strikes(connectionId, model) {
  antigravity429Strikes.delete(antigravityStrikeKey(connectionId, model));
}

function recordAntigravity429Strike(connectionId, model, now = Date.now()) {
  const key = antigravityStrikeKey(connectionId, model);
  const previous = antigravity429Strikes.get(key);
  // First strike anchors the window; success resets it, and threshold expiry is persisted through the existing model-lock path.
  const strike = !previous || now - previous.windowStartedAt > ANTIGRAVITY_STRIKE_WINDOW_MS ?
  { count: 1, windowStartedAt: now } :
  { count: previous.count + 1, windowStartedAt: previous.windowStartedAt };
  if (strike.count < 3) {
    antigravity429Strikes.set(key, strike);
    return null;
  }
  antigravity429Strikes.delete(key);
  return now + ANTIGRAVITY_STRIKE_BLOCK_MS;
}

export function __resetAntigravity429StrikesForTests() {
  antigravity429Strikes.clear();
}

/** Attempts one connection may serve per request (Antigravity retries capacity errors). */
export function allowedAttemptsPerConnection(provider) {
  return isAntigravityProvider(provider) ? ANTIGRAVITY_CAPACITY_SWEEP_RETRIES + 1 : 1;
}

/** True when an exhausted Antigravity pool should restart its account sweep. */
export function shouldRestartCapacitySweep(provider, state) {
  return isAntigravityProvider(provider) &&
    isAntigravityCapacityError(state.lastStatus, state.lastError) &&
    state.antigravityCapacitySweeps < ANTIGRAVITY_CAPACITY_SWEEP_RETRIES;
}

/**
 * True when another Antigravity/agy account could take this request now. The
 * executor then hands a 503 back at once, so the account loop moves on instead of
 * waiting on this account (OmniRoute #20093). A pinned request or the last usable
 * account gets false and keeps the same-account wait-and-retry.
 */
export async function antigravityAccountFailover(ctx, state, credentials) {
  const { provider, model } = ctx;
  if (!isAntigravityProvider(provider) || ctx.preferredConnectionId) return false;
  if (state.totalAttempts >= MAX_ACCOUNT_ATTEMPTS_PER_REQUEST) return false;
  const attemptLimit = allowedAttemptsPerConnection(provider);
  const spent = [...state.attemptCounts].filter(([, count]) => count >= attemptLimit).map(([id]) => id);
  try {
    return await hasAlternateAccount(
      provider,
      new Set([...state.excludeConnectionIds, ...spent, credentials.connectionId]),
      model,
      accountSelectionOptions(ctx, state)
    );
  } catch {
    log.warn("CHAT", `[${provider}/${model}] alternate account check failed; keeping same-account retries`);
    return false;
  }
}

export function antigravityPreResponseTimeout(provider, result) {
  return result.antigravityPreResponseTimeout === true ||
    (provider === "antigravity" && result.status === HTTP_STATUS.GATEWAY_TIMEOUT);
}

export function onProviderRequestSuccess(provider, connectionId, model) {
  if (isAntigravityProvider(provider)) clearAntigravity429Strikes(connectionId, model);
}

const LIVE_MODEL_FETCHER_TYPES = new Set(["openai", "openai-compatible"]);
const KIMI_LIVE_MODEL_PROVIDERS = new Set(["kimi", "kimi-coding", "kimi-coding-apikey"]);

/**
 * Warm live model limits after account selection without awaiting catalog I/O.
 * The cached resolver owns TTL, negative caching, coalescing, and failures.
 */
export function warmRequestModelLimits(provider, credentials) {
  try {
    const registry = REGISTRY.find((entry) => entry.id === provider || entry.alias === provider || entry.uiAlias === provider);
    const fetcher = registry?.modelsFetcher;
    const genericFetcher = fetcher && LIVE_MODEL_FETCHER_TYPES.has(fetcher.type) ? fetcher : null;
    const anthropic = provider?.startsWith("anthropic-compatible-");
    const compatible = anthropic || provider?.startsWith("openai-compatible-");
    const kimi = KIMI_LIVE_MODEL_PROVIDERS.has(provider);
    if (!genericFetcher && !compatible && !kimi) return;
    warmLiveModelLimits(provider, credentials, {
      guard: getProviderValidationGuard(),
      proxyOptions: proxyOptionsFromCredentials(credentials),
      endpoint: genericFetcher?.url || (kimi ? KIMI_CODING_MODELS_URL : undefined),
      anthropic
    });
  } catch {

    // Catalog metadata is optional; request dispatch must remain fail-soft.
  }}


/** Capabilities a Fusion leaf must satisfy, after Cursor capability enforcement. */
export function effectiveLeafCapabilities(provider, model, resolvedModelCapabilities) {
  return enforceCursorCapabilities(provider, {
    ...getCapabilitiesForModel(provider, parseSuffix(model).cleanModel),
    ...(resolvedModelCapabilities || {}),
  });
}

/**
 * ChatGPT plan requests skip the account loop: they use the common
 * translation/usage pipeline with their own bound executor.
 */
export async function dispatchChatgptPlan(ctx) {
  const { provider, model, request, body, modelInfo, comboRouting, requestSignal, planRequest, rawConnectionPin, reportComboPolicyRejections } = ctx;
  const pathname = request?.url ? new URL(request.url).pathname : "";
  if (!/\/v1\/(chat\/completions|messages)\/?$/.test(pathname)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "ChatGPT plan is only available on Chat Completions and Messages");
  }
  const dispatch = await resolveChatgptPlanDispatch({
    planRequest,
    providerRegistered: REGISTRY.some((entry) => entry.id === provider),
    preferredConnectionId: rawConnectionPin ? String(rawConnectionPin) : null,
    comboRouting,
    signal: requestSignal,
  });
  if (!dispatch) {
    return reportComboPolicyRejections ? comboPolicyRejection() :
      errorResponse(HTTP_STATUS.FORBIDDEN, "ChatGPT plan connection is not available for this API key");
  }

  // The normal account recovery loop may rotate credentials. This dispatch
  // uses the common translation/usage pipeline with its own bound executor.
  const result = await handleChatCore({
    ...dispatch,
    body: { ...structuredClone(body), model: `${provider}/${model}` },
    modelInfo,
    modelCapabilities: ctx.resolvedModelCapabilities,
    clientRawRequest: ctx.clientRawRequest,
    userAgent: ctx.userAgent,
    apiKey: ctx.apiKey,
    apiKeyId: ctx.apiKeyId,
    apiKeyName: ctx.apiKeyName,
    billingEpoch: ctx.billingEpoch,
    comboId: comboRouting?.id,
    comboName: comboRouting?.name,
    comboNoLog: comboRouting?.noLog === true,
    comboPrompts: ctx.comboPrompts,
    log,
    routingPolicy: ctx.settings?.openrouterRouting,
    providerConcurrencyLimit: ctx.settings?.providerConcurrencyLimits,
    globalConcurrentRequests: ctx.settings?.globalConcurrentRequests,
    sourceFormatOverride: detectFormatByEndpoint(pathname, body),
    abortSignal: requestSignal,
  });
  if (result.localAdmissionRejected === true) result.response.localAdmissionRejected = true;
  return result.success ? withRouteResponseHeaders(result.response, { provider, model }) : result.response;
}

/**
 * Ensure a real project ID is available for providers that need it (P0 fix:
 * cold miss). Returns a terminal/retry result, or proceed() to dispatch.
 */
export async function ensureProviderProjectId(ctx, state, credentials, refreshedCredentials) {
  const { provider, model, request, requestSignal } = ctx;
  if (!(isAntigravityProvider(provider) || provider === "gemini-cli") || refreshedCredentials.projectId) return proceed();
  try {
    const pid = await getProjectIdForConnection(
      credentials.connectionId,
      refreshedCredentials.accessToken,
      refreshedCredentials.providerSpecificData,
      requestSignal,
      provider
    );
    if (requestAborted(request, requestSignal)) return terminal(errorResponse(499, "Request aborted"));
    if (pid) {
      refreshedCredentials.projectId = pid;
      // Persist only after the subscriber is still live; a disconnected
      // request must not schedule a late credential write.
      updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => {});
    }
  } catch (error) {
    if (error?.name === "AbortError" || requestAborted(request, requestSignal)) {
      return terminal(errorResponse(499, "Request aborted"));
    }
    if (isAntigravityProvider(provider) && error?.credentialScoped) {
      const lastStatus = error.status || HTTP_STATUS.SERVICE_UNAVAILABLE;
      const lastError = "Antigravity credential project validation failed";
      state.lastStatus = lastStatus;
      state.lastError = lastError;
      state.lastErrorCode = null;
      await markAccountUnavailable(credentials.connectionId, lastStatus, lastError, provider, model, null, { signal: requestSignal });
      state.excludeConnectionIds.add(credentials.connectionId);
      return RETRY;
    }
  }
  return proceed();
}

/**
 * Antigravity failure policy for one failed attempt: refresh exact-model quota
 * on 409/429, run the 3-strike breaker, and detect exhausted credits. Returns
 * terminal/retry, or proceed({ fallbackResetAt, fallbackEvidence }) for the
 * shared markAccountUnavailable fallback.
 */
export async function evaluateProviderFailure(ctx, state, attempt, result, resultErrorBody) {
  const { provider, model, request, requestSignal } = ctx;
  const { credentials, activeConnection } = attempt;
  const antigravityProvider = isAntigravityProvider(provider);
  const authoritativeResetAt = Number(result.rateLimitEvidence?.resetAtMs);
  // chatCore fills result.resetsAtMs with a generic local cooldown (e.g. 2s)
  // for ANY 429 that arrives without a reset hint, including content-triggered
  // ones. That value is a client-side guess, not upstream evidence, so it must
  // never count as authoritative here — only a real upstream reset timestamp
  // (rateLimitEvidence.resetAtMs) does. Using the local fallback would make
  // every antigravity 429 look "authoritative" and defeat the strike breaker.
  const authoritativeReset = Number.isFinite(authoritativeResetAt) && authoritativeResetAt > Date.now();
  if (antigravityProvider && result.status === 429 && authoritativeReset) {
    clearAntigravity429Strikes(credentials.connectionId, model);
  }
  /**
   * Antigravity 409s and 429s without executor reset metadata may describe
   * exact model quota. Refresh the shared repository before creating any
   * legacy lock; only a fresh exact-source blocker owns the reselect.
   */
  // A parsed detail-free response is request-scoped; keep the account selectable.
  const requestScopedAntigravity = antigravityProvider && result.noQuotaMetadata === true && !authoritativeReset && !result.antigravityQuotaSignal;
  const shouldRefreshAntigravityQuota =
    antigravityProvider && !requestScopedAntigravity &&
    (result.status === 409 || (result.status === 429 && !authoritativeReset)) &&
    activeConnection &&
    !state.refreshedQuotaConnectionIds.has(credentials.connectionId);
  if (shouldRefreshAntigravityQuota) {
    state.refreshedQuotaConnectionIds.add(credentials.connectionId);
    try {
      const refreshResult = await refreshProviderQuota(activeConnection, {
        signal: requestSignal,
        force: true
      });
      const decision = refreshResult?.outcome === "success" && Array.isArray(refreshResult.snapshots) ?
      evaluateProviderQuotaPreflight(refreshResult.snapshots, {
        connectionId: credentials.connectionId,
        provider,
        resourceKeys: state.quotaResourceKeys,
        now: Date.now(),
        refreshSupported: true
      }) :
      null;
      if (decision?.skip) {
        clearAntigravity429Strikes(credentials.connectionId, model);
        log.info("AUTH", `${provider} | refreshed quota blocked ${credentials.connectionId.slice(0, 8)} (reason=${decision.reason || "unknown"}); reselecting`);
        state.lastError = result.error;
        state.lastStatus = result.status;
        state.lastErrorCode = null;
        return RETRY;
      }
    } catch (error) {
      if (error?.name === "AbortError" || requestAborted(request, requestSignal)) {
        return terminal(errorResponse(499, "Request aborted"));
      }
      log.warn("QUOTA", `${provider} | reactive quota refresh failed for ${credentials.connectionId.slice(0, 8)}; using standard fallback`);
    }
  }

  const strikeBreakerResetAt = antigravityProvider && result.status === 429 && !authoritativeReset && result.antigravityQuotaSignal === true ?
  recordAntigravity429Strike(credentials.connectionId, model) :
  null;
  // A locally synthesized short 429 delay is not a quota reset. Let the
  // Antigravity account policy choose its exhaustion default instead.
  const creditsExhausted = antigravityProvider && result.status === 429 && !authoritativeReset && (
    result.rateLimitEvidence?.creditsExhausted === true ||
    /google_one_ai|insufficient[_ ](?:g1_)?credits?|not enough credits?|credits? exhausted|credit balance|minimumcreditamountforusage|g1_credits/i.test(`${result.error || ""} ${JSON.stringify(resultErrorBody || {})}`));
  const fallbackResetAt = creditsExhausted ? null : strikeBreakerResetAt ?? result.resetsAtMs;
  const fallbackEvidence = creditsExhausted ? { state: "exhausted", resetAtMs: null, source: "antigravity_credits" } : strikeBreakerResetAt === null ?
  result.rateLimitEvidence || null :
  { state: result.rateLimitEvidence?.state === "exhausted" ? "exhausted" : "cooldown", resetAtMs: strikeBreakerResetAt, source: "antigravity_strike_breaker" };

  if (requestScopedAntigravity) return terminal(result.response);
  return proceed({ fallbackResetAt, fallbackEvidence });
}
