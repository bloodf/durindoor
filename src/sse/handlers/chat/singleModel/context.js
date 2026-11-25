import { getSettings } from "@/lib/localDb";
import { getModelQuotaFamily, getDispatchUpstreamModelId, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { buildQuotaResourceKeys } from "@/shared/services/providerQuotaPreflight";

/**
 * Shared request context and stage-result helpers for the single-model chat
 * pipeline. Every stage receives the one context object built here instead of
 * the eight positional parameters of handleSingleModelChat.
 */

export const MAX_ACCOUNT_ATTEMPTS_PER_REQUEST = 1024;

/** A stage finished the request: hand this Response back to the caller. */
export function terminal(response) {
  return { kind: "terminal", response };
}

/** A stage wants the account loop to start the next iteration. */
export const RETRY = Object.freeze({ kind: "retry" });

/** A stage succeeded; `value` carries what the next stage needs. */
export function proceed(value = {}) {
  return { kind: "ok", ...value };
}

export function createSingleModelContext({ body, modelStr, clientRawRequest, request, apiKey, attemptSignal, tokenSaverCollector, options }) {
  const {
    settings = null,
    allowVisionBridge = false,
    preResolvedCapabilities = undefined,
    apiKeyName = apiKey ? "Unknown API Key" : "Local (No API Key)",
    apiKeyId = null,
    billingEpoch,
    comboRouting = null,
    comboPrompts = [],
    comboVisited = new Set(),
    planRequest,
    reportComboPolicyRejections = false,
    dispatchNestedCombo
  } = options;
  return {
    body,
    modelStr,
    clientRawRequest,
    request,
    apiKey,
    attemptSignal,
    tokenSaverCollector,
    requestSignal: attemptSignal || request?.signal || null,
    settings,
    allowVisionBridge,
    preResolvedCapabilities,
    apiKeyName,
    apiKeyId,
    billingEpoch,
    comboRouting,
    comboPrompts,
    comboVisited,
    planRequest,
    reportComboPolicyRejections,
    dispatchNestedCombo,
    // Filled in by the resolve-model and admission stages.
    modelInfo: null,
    provider: null,
    model: null,
    privatePlan: false,
    modelCapabilities: preResolvedCapabilities,
    resolvedModelCapabilities: undefined,
    rawConnectionPin: null,
    preferredConnectionId: null,
    userAgent: "",
    routingSessionId: null
  };
}

/**
 * Per-request account-loop state: which accounts were tried, why they failed,
 * and the one-shot recovery flags. Mutated by the credential and post-process
 * stages across loop iterations.
 */
export async function createLoopState(ctx) {
  const { provider, model, body, settings } = ctx;
  const providerAlias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  // Quota/cooldown keys follow the tier row chatCore will dispatch (client
  // effort/budget and the provider-level thinking override pick `-<tier>` rows).
  const quotaSettings = settings || await getSettings();
  const upstreamModel = getDispatchUpstreamModelId(providerAlias, model, body, quotaSettings?.providerThinking?.[provider]);
  const quotaFamily = getModelQuotaFamily(providerAlias, model);
  const modelCandidates = [...new Set([model, upstreamModel].filter(Boolean))];
  return {
    excludeConnectionIds: new Set(),
    attemptCounts: new Map(),
    attemptedBlockers: new Map(),
    refreshedQuotaConnectionIds: new Set(),
    lastError: null,
    lastStatus: null,
    antigravityTimeoutResponse: null,
    antigravityCapacitySweeps: 0,
    totalAttempts: 0,
    requestReplayConnectionId: null,
    requestReplayAttempted: false,
    // Early-EOF sibling failover (OmniRoute #13153/#13630): at most ONE hop per
    // request. Holds the first attempt's replayable response so an exhausted
    // sibling pool still returns exactly what the client would have received.
    earlyEofOriginal: null,
    // Token Saver telemetry (port of 9router #2562): the LATEST routing
    // attempt's normalized event; fallback retries overwrite it.
    lastTokenSaverEvent: null,
    accountAttempts: 0,
    upstreamModel,
    quotaFamily,
    modelCandidates,
    quotaResourceKeys: buildQuotaResourceKeys({ provider, modelCandidates, quotaFamily })
  };
}

export function proxyOptionsFromCredentials(credentials) {
  const config = credentials?.providerSpecificData || {};
  return {
    connectionProxyEnabled: config.connectionProxyEnabled === true,
    connectionProxyUrl: config.connectionProxyUrl || "",
    connectionNoProxy: config.connectionNoProxy || "",
    vercelRelayUrl: config.vercelRelayUrl || "",
    strictProxy: config.strictProxy === true,
    disableEnvProxy: config.disableEnvProxy === true
  };
}

export function aggregateRateLimitBlockers(blockers, extra = null) {
  const entries = [...blockers.values()];
  if (extra) entries.push(extra);
  if (entries.length === 0 || entries.some((entry) => Number(entry.status) !== 429)) return null;
  const complete = entries.every((entry) => entry.retryAtKnown !== false && Boolean(entry.retryAt));
  const retryAt = complete ?
  entries.map((entry) => entry.retryAt).sort((left, right) => Date.parse(left) - Date.parse(right))[0] :
  null;
  return { status: 429, retryAt };
}
