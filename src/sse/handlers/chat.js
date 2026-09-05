import { KIMI_CODING_MODELS_URL } from "../../../open-sse/providers/shared.js";
import "open-sse/index.js";

import {
  getProviderCredentialsWithQuotaPreflight,
  projectProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  resolveClientApiKey,
  isProviderConnectionModelLocked,
  providerAllowsPublicNoAuthFallback } from
"../services/auth.js";
import { cacheClaudeHeaders } from "open-sse/utils/claudeHeaderCache.js";
import {
  getSettings, getApiKeyByKey, getApiKeyUsageLimitStatus,
  getProviderConnections, getQuotaReservationPressure, getApiKeyProviderConnectionIds, getComboForModel } from
"@/lib/localDb";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendHeadroomEvent } from "@/lib/headroom/events.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { getModelInfo, getComboModels, getComboCanonicalName, createRoutableModelIdChecker, loadCustomCapabilities, parseModel } from "../services/model.js";
import { recordTokenSaverEvent } from "@/lib/usageDb";
import { isAutoComboId } from "open-sse/services/autoComboResolver.js";
import { applyVisionBridgeReroute } from "open-sse/services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { warmLiveModelLimits } from "open-sse/services/liveModelLimits.js";
import { decodeClaudeCodeModelId } from "../../app/api/v1/models/_claudeCompat.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { authErrorResponse, errorResponse, unavailableResponse, getClientStatusFromError } from "open-sse/utils/error.js";
import { getRequestId, validateProviderRequestId, withRequestCorrelation } from "../utils/requestCorrelation.js";
import { isLocalStreamLifecycleError } from "open-sse/utils/streamLifecycle.js";
import { isRoutableProvider } from "../../shared/constants/providers.js";
import {
  getComboModelQuotaHealth,
  handleComboChat,
  handleFusionChat } from
"open-sse/services/combo.js";
import { getComboRoutingPolicy, mergeComboRouting } from "open-sse/services/comboRoutingPolicy.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { handlePonytailCommands, DEFAULT_PONYTAIL_HELP, resolvePonytailStream } from "open-sse/utils/tokenSaverBridge.js";
import { resolveTokenSaverEnabled } from "open-sse/rtk/index.js";
import { HTTP_STATUS, COMBO_MODEL_TIMEOUT_MS } from "open-sse/config/runtimeConfig.js";
import { EMPTY_CONTENT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { FORMATS, detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { detectFormat } from "open-sse/services/provider.js";
import { isAntigravityCapacityError, isRequestReplayBufferError } from "open-sse/services/accountFallback.js";
import { resolveClientSessionId } from "open-sse/utils/sessionManager.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials } from "../services/tokenRefresh.js";
import { refreshAndUpdateCredentials } from "@/shared/services/providerCredentials";
import { allocateProviderAttemptTimestamp } from "@/shared/services/providerRateLimitEvidence";
import {
  getModelQuotaFamily,
  getModelUpstreamId,
  PROVIDER_ID_TO_ALIAS } from
"open-sse/config/providerModels.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { enforceApiKeyModelPolicy } from "../services/apiKeyPolicy.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { validateChatRequestBody } from "open-sse/translator/validate.js";
import {
  createQuotaReservationLifecycle,
  rankQuotaConnections } from
"@/shared/services/quotaSelection";
import { buildQuotaResourceKeys, evaluateProviderQuotaPreflight, inspectProviderQuota } from "@/shared/services/providerQuotaPreflight";
import { refreshProviderQuota } from "@/shared/services/providerQuotaTracker";
import {
  quotaDecisionDiagnostic,
  rankQuotaCandidates } from
"open-sse/services/quota/scoring.js";
import { isObject } from "../../shared/utils/typeChecks.js";

const ANTIGRAVITY_CAPACITY_SWEEP_RETRIES = 2;
const MAX_ACCOUNT_ATTEMPTS_PER_REQUEST = 1024;
const ANTIGRAVITY_STRIKE_WINDOW_MS = 60_000;
const ANTIGRAVITY_STRIKE_BLOCK_MS = 15 * 60_000;
const antigravity429Strikes = new Map();

function antigravityStrikeKey(connectionId, model) {
  return `${connectionId}|${model}`;
}

function clearAntigravity429Strikes(connectionId, model) {
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

function requestAborted(request, signal = null) {
  return signal?.aborted === true || request?.signal?.aborted === true;
}

function combineAbortSignals(parentSignal, childSignal) {
  if (!childSignal) return parentSignal || null;
  if (!parentSignal) return childSignal;
  return AbortSignal.any([parentSignal, childSignal]);
}

function aggregateRateLimitBlockers(blockers, extra = null) {
  const entries = [...blockers.values()];
  if (extra) entries.push(extra);
  if (entries.length === 0 || entries.some((entry) => Number(entry.status) !== 429)) return null;
  const complete = entries.every((entry) => entry.retryAtKnown !== false && Boolean(entry.retryAt));
  const retryAt = complete ?
  entries.map((entry) => entry.retryAt).sort((left, right) => Date.parse(left) - Date.parse(right))[0] :
  null;
  return { status: 429, retryAt };
}

function proxyOptionsFromCredentials(credentials) {
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


/**
 * #6457 / OmniRoute#6525: resolved registry model kind === "image" means the
 * model is image-only and belongs on /v1/images/generations, not the chat
 * endpoint. Forwarding it to a chat upstream yields a confusing raw provider
 * 400 (e.g. HuggingFace: "not a chat model"). Per-model kind is used (not the
 * provider-level serviceKinds) because mixed providers like Cloudflare serve
 * both chat and image models.
 */
export function isImageOnlyModel(provider, model) {
  const entry = REGISTRY.find(
    (e) => e.id === provider || e.alias === provider || e.aliases?.includes(provider)
  );
  const m = entry?.models?.find((x) => x.id === model);
  return (m?.kind ?? m?.type) === "image";
}

// Keep quota-only combo inspection distinct from the single-model resolution
// call below. This helper is invoked only after the shared API-key guard has
// authenticated the request, and the alias makes that security ordering
// explicit to the handler-contract source check.
const resolveQuotaModelInfo = getModelInfo;

function leastHealthy(...states) {
  const rank = { unhealthy: 0, open: 0, degraded: 1, "half-open": 1, healthy: 2, closed: 2 };
  return states.filter(Boolean).sort((left, right) => (rank[left] ?? 2) - (rank[right] ?? 2))[0] || "healthy";
}

export async function rankComboModelsByQuota(
models,
settings,
now = Date.now(),
comboName = null,
comboStrategy = "fallback",
dependencies = {},
comboRouting = null)
{
  try {
    const resolveModelInfo = dependencies.getModelInfo || resolveQuotaModelInfo;
    const loadConnections = dependencies.getProviderConnections || getProviderConnections;
    const inspectQuota = dependencies.inspectProviderQuota || inspectProviderQuota;
    const loadPressure = dependencies.getQuotaReservationPressure || getQuotaReservationPressure;
    const isLocked = dependencies.isProviderConnectionModelLocked || isProviderConnectionModelLocked;
    const allowsPublicNoAuth = dependencies.providerAllowsPublicNoAuthFallback ||
    providerAllowsPublicNoAuthFallback;
    const comboHealth = dependencies.getComboModelQuotaHealth || getComboModelQuotaHealth;
    const candidates = [];
    for (const [index, modelStr] of models.entries()) {
      const { provider, model } = await resolveModelInfo(modelStr);
      if (!provider) {
        candidates.push({ value: modelStr, id: modelStr, stableIdentity: modelStr, originalIndex: index });
        continue;
      }
      const providerAlias = PROVIDER_ID_TO_ALIAS[provider] || provider;
      const upstreamModel = getModelUpstreamId(providerAlias, model);
      const quotaFamily = getModelQuotaFamily(providerAlias, model);
      const allConnections = await loadConnections({ provider, isActive: true });
      const connections = comboRouting?.restrictionApplied === true ?
      allConnections.filter((connection) => comboRouting.allowedConnectionIds?.includes(connection.id)) :
      allConnections;
      const resourceKeys = buildQuotaResourceKeys({
        provider,
        modelCandidates: [...new Set([model, upstreamModel].filter(Boolean))],
        quotaFamily
      });
      const decisions = await inspectQuota(connections, { provider, resourceKeys, now });
      const pressure = connections.length > 0 ?
      await loadPressure({ provider, connectionIds: connections.map((connection) => connection.id), now }) :
      new Map();
      const lockedConnectionIds = new Set(connections.
      filter((connection) => isLocked(connection, provider, model, now)).
      map((connection) => connection.id));
      const allLocked = connections.length > 0 && lockedConnectionIds.size === connections.length;
      const allLockedWithoutPublicFallback = allLocked && !allowsPublicNoAuth(provider);
      const selectableConnections = connections.filter((connection) =>
      !decisions.get(connection.id)?.skip &&
      !lockedConnectionIds.has(connection.id)
      );
      const publicFallbackWillApply = comboRouting?.restrictionApplied !== true &&
      allowsPublicNoAuth(provider) &&
      connections.length > 0 &&
      selectableConnections.length === 0;
      const rankedConnections = rankQuotaConnections(selectableConnections, decisions, pressure, {
        provider,
        now,
        config: settings.quotaSelection || {}
      });
      // Mirror credential selection's fixed-slot behavior: after filtering
      // blocked/floor candidates, the actual first eligible ranked connection
      // is authoritative. If it is untracked, keep this combo model untracked
      // instead of scoring a different sibling account that will not dispatch.
      let best = rankedConnections.find((candidate) => candidate.quotaDecision?.eligible !== false) || null;
      let comparableProfile = best?.quotaDecision?.comparable ? best.quotaProfile : null;
      let routingFloorBlocked = false;
      if (!best) {
        const floorBlocked = rankedConnections.find((candidate) => candidate.quotaDecision?.comparable) || null;
        const providerBlocked = connections.find((connection) => {
          const decision = decisions.get(connection.id);
          return decision?.skip;
        }) || null;
        if (floorBlocked) {
          best = floorBlocked;
          comparableProfile = floorBlocked.quotaProfile;
          routingFloorBlocked = floorBlocked.quotaDecision?.reasons?.includes("below_routing_floor") === true;
        } else if (providerBlocked && !publicFallbackWillApply) {
          const decision = decisions.get(providerBlocked.id);
          comparableProfile = {
            tracked: false,
            freshness: decision.freshness || "fresh",
            gateMode: null,
            effectiveRatio: null,
            comparisonKey: null,
            reservationAlternatives: [],
            routingWindows: [],
            ...(decision.quotaProfile || {}),
            reason: decision.reason || "exhausted"
          };
        }
      }
      candidates.push({
        value: modelStr,
        id: modelStr,
        stableIdentity: modelStr,
        originalIndex: index,
        quotaProfile: comparableProfile,
        hardBlockedReason: allLockedWithoutPublicFallback ? "legacy_lock" : null,
        activeCount: best?.quotaDecision?.activeCount || 0,
        lastSelectedAt: best?.quotaDecision?.tieKey?.lastSelectedAt || null,
        health: leastHealthy(
          best?.health,
          comboStrategy === "smart-scoring" ?
          comboHealth(comboName, modelStr) :
          "healthy"
        ),
        routingFloorBlocked,
        priority: index,
        priorityRank: index
      });
    }
    const ranked = rankQuotaCandidates(candidates, { now });
    for (const candidate of ranked) {
      log.debug("QUOTA", "combo candidate", quotaDecisionDiagnostic(candidate.quotaDecision));
    }
    return [
    ...ranked.filter((candidate) => candidate.quotaDecision?.eligible !== false),
    ...ranked.filter((candidate) => candidate.quotaDecision?.eligible === false)].
    map((candidate) => candidate.value);
  } catch {
    // Quota lookup/scoring errors preserve the caller's established combo order.
    return models;
  }
}

/**
 * Strip reasoning_content from assistant messages in conversation history.
 * Some providers (e.g. Mistral) reject requests containing reasoning_content
 * in assistant messages with "extra_forbidden" validation errors.
 * This field is only meaningful in streaming responses, not in request bodies.
 */
function stripReasoningFromMessages(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;
  let modified = false;
  for (const msg of body.messages) {
    if (msg && msg.role === "assistant" && msg.reasoning_content !== undefined) {
      delete msg.reasoning_content;
      modified = true;
    }
  }
  return modified ? { ...body, messages: [...body.messages] } : body;
}

/**
 * Fix message ordering for providers that require specific role sequences.
 * Mistral requires the last message to be user/tool (or assistant with prefix=true).
 * If the last message is an assistant without prefix, add prefix: true so the
 * provider can continue generation from that point.
 */
function fixMessageOrdering(messages) {
  if (!messages || !Array.isArray(messages) || messages.length === 0) return;
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && !last.prefix) {
    last.prefix = true;
  }
}


/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
async function handleChatHandler(request, clientRawRequest = null, requestId = getRequestId(request)) {
  if (requestAborted(request)) return errorResponse(499, "Request aborted");
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Inbound schema guard (OmniRoute O-A): reject malformed `messages` / `model`
  // / scalar params with a clear 400 BEFORE auth + model resolution, so a bad
  // body never surfaces as a misleading `model_not_found` 404 or an unsanitized
  // 500. See open-sse/translator/validate.js (ports #6515/#6433/#6437).
  const earlyRejection = validateChatRequestBody(body);
  if (earlyRejection) {
    log.warn("CHAT", "Rejecting schema-invalid request body");
    return earlyRejection;
  }

  const originalClientModel = body.model;
  // Keep model identity outside mutable working bodies: combo attempts replace
  // their routed model, but Claude response metadata must echo this exact value.
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body: { ...body },
      headers: Object.fromEntries(request.headers.entries()),
      originalModel: originalClientModel,
      requestId,
    };
  } else {
    clientRawRequest = { ...clientRawRequest, originalModel: originalClientModel, requestId };
  }
  cacheClaudeHeaders(clientRawRequest.headers);

  const sourceFormat = detectFormatByEndpoint(
    clientRawRequest?.endpoint || new URL(request.url).pathname,
    body,
  ) || detectFormat(body);
  let modelStr = body.model;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  const settings = await getSettings();
  const { apiKey, auth: apiKeyAuth } = await resolveClientApiKey(request, {
    required: settings.requireApiKey === true
  });
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }
  if (!apiKeyAuth.ok) {
    if (apiKeyAuth.reason === "missing") {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return authErrorResponse(clientRawRequest.endpoint, "Missing API key");
    }
    log.warn("AUTH", "Invalid API key");
    return authErrorResponse(clientRawRequest.endpoint, "Invalid API key");
  }

  // Retain the authenticated record so local commands can expose only this
  // key's own lifetime totals. Combo ACL runs after Claude model decoding.
  let authenticatedKeyRecord = null;
  if (apiKey) authenticatedKeyRecord = await getApiKeyByKey(apiKey);

  if (apiKey) {
    let limitStatus;
    try {
      limitStatus = await getApiKeyUsageLimitStatus(apiKey);
    } catch (err) {
      if (err?.message?.includes("no such table: apiKeyUsageTotals")) {
        limitStatus = { enforced: false, exceeded: false };
      } else {
        log.error("AUTH", "Failed to load API key usage limit status", err);
        return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Database temporarily unavailable");
      }
    }
    if (limitStatus.exceeded) {
      const used = Math.round(limitStatus.usedTokens);
      const limit = Math.round(limitStatus.limitTokens);
      log.warn("AUTH", `API key daily token limit exceeded (${used}/${limit})`);
      return errorResponse(HTTP_STATUS.RATE_LIMITED, `API key daily token limit exceeded (${used}/${limit} tokens)`);
    }
  }

  if (sourceFormat === FORMATS.CLAUDE) {
    modelStr = await decodeClaudeCodeModelId(modelStr, createRoutableModelIdChecker());
    if (modelStr !== body.model) body = { ...body, model: modelStr };
  }

  if (authenticatedKeyRecord && Array.isArray(authenticatedKeyRecord.allowedCombos) && authenticatedKeyRecord.allowedCombos.length > 0) {
    const comboName = await getComboCanonicalName(modelStr);
    if (comboName && !authenticatedKeyRecord.allowedCombos.includes(comboName)) {
      log.warn("AUTH", `API key "${authenticatedKeyRecord.name}" not allowed to access combo "${comboName}"`);
      return errorResponse(HTTP_STATUS.FORBIDDEN, `Access denied: combo "${comboName}" is not allowed for this API key`);
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Vision Bridge (#6640): when the request carries image parts on its current
  // user turn and the requested model cannot accept vision natively, swap to
  // the operator-configured vision-capable model before combo/dispatch. Applied
  // after settings + auth are loaded (so parseModel stays sync/pure) and before
  // combo resolution. The rerouted target is policy-rechecked — a vision model
  // the caller's API key is not allowed to use must not be reachable via the
  // bridge; on denial we keep the original model and let normal policy gates run.
  //
  // Custom capabilities resolve BEFORE the bridge so a user-added vision override
  // on a compatible node or bare alias is honored. Both run AFTER the local
  // ponytail/bypass interceptors below — local commands must answer without
  // any model/DB lookup.
  // Per-request token-saver bypass (#2609): `X-DurinDoor-Token-Saver: off`
  // (or legacy `X-9Router-Token-Saver: off`) disables the local Ponytail
  // slash-command interceptor so the request reaches the provider untransformed.
  const tokenSaverEnabled = resolveTokenSaverEnabled(clientRawRequest?.headers);

  // Ponytail slash commands are local-only: respond before any account/credential lookup.
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  if (tokenSaverEnabled) {
    const ponytailResponse = await handlePonytailCommands(body, modelStr, {
      fetchStats: authenticatedKeyRecord ?
      async () => {
        const { getApiKeyUsageTotals } = await import("@/lib/localDb");
        return {
          ...(await getApiKeyUsageTotals(authenticatedKeyRecord.id)),
          scope: "this API key"
        };
      } :
      null,
      helpText: DEFAULT_PONYTAIL_HELP,
      sourceFormatOverride: sourceFormat,
      streamOverride: resolvePonytailStream(body, sourceFormat, acceptHeader)
    });
    if (ponytailResponse?.success && ponytailResponse.response) {
      return ponytailResponse.response;
    }
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  // Vision Bridge capability resolution and reroute have moved to
  // handleSingleModelChat so they run AFTER API-key policy enforcement for
  // single-model requests. Denied requests no longer trigger DB lookups.

  // Check if model is a combo (has multiple models with fallback)
  // #6495 / F-4: filter paid members when the toggle is on. The auth ACL check
  // above intentionally calls getComboModels without the flag so combo
  // existence/ACL still see the real, unfiltered member list.
  const comboModels = await getComboModels(modelStr, settings.hidePaidModels === true);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global. Auto-combo
    // ids (`auto/<family>`) honor the F-2 `comboStrategies[modelStr].strategy`
    // shape; named combos keep the legacy `.fallbackStrategy`. Auto IDs fall
    // through to `.fallbackStrategy` when `.strategy` is absent so partial config
    // still works. A stray `.strategy` on a named-combo config never changes
    // legacy behavior.
    const comboName = (await getComboCanonicalName(modelStr)) || modelStr;
    const comboMembers = (await getComboForModel(comboName))?.members || [];
    // #747: resolve the combo's allow-list once per top-level request. Every
    // attempt / fallback inside the same logical request shares this policy.
    const comboRouting = await getComboRoutingPolicy(comboName);
    const comboStrategies = settings.comboStrategies || {};
    const perCombo = comboStrategies[comboName] || {};
    const comboSpecificStrategy = isAutoComboId(modelStr) ?
    perCombo.strategy ?? perCombo.fallbackStrategy :
    perCombo.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";

    // Combo names are intentionally excluded from the model allowlist; the allowlist
    // is enforced against each concrete underlying model during expansion. Combo-level
    // combo access control above remains the gate for combo names.
    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${comboName}" with ${comboModels.length} models (strategy: fusion)`);
      const capabilitiesMap = await resolveComboCapabilitiesMap(comboModels);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel, panelSignal) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(
            b,
            m,
            cleanRawReq,
            request,
            apiKey,
            combineAbortSignals(request?.signal || null, panelSignal),
            null,
            { settings, allowVisionBridge: false, apiKeyName: authenticatedKeyRecord?.name || (apiKey ? "Unknown API Key" : "Local (No API Key)"), apiKeyId: apiKeyAuth.apiKeyId, comboRouting }
          );
        },
        log,
        comboName,
        judgeModel: perCombo.judgeModel,
        tuning: perCombo.fusionTuning,
        contextRequirements: perCombo.contextRequirements,
        capabilitiesMap
      });
    }

    const capabilitiesMap = await resolveComboCapabilitiesMap(comboModels);
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    const comboTimeoutMs = perCombo?.timeoutMs || COMBO_MODEL_TIMEOUT_MS || 0;
    log.info("CHAT", `Combo "${comboName}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit}, timeout: ${comboTimeoutMs || "off"})`);
    // #2562: combo fallback must persist ONE token-saver row for the whole
    // logical request, not one per fallback attempt. Collect the latest event
    // across attempts and persist after handleComboChat returns.
    const tokenSaverCollector = { latest: null };
    const comboResult = await handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m, attemptSignal) => {
        // Reset per attempt so an eventless attempt does not carry forward the
        // previous attempt's event; the collector then holds only the latest
        // emitted event from the attempts that actually fired telemetry.
        tokenSaverCollector.latest = null;
        return handleSingleModelChat(
          b,
          m,
          clientRawRequest,
          request,
          apiKey,
          combineAbortSignals(request?.signal || null, attemptSignal),
          tokenSaverCollector,
          { settings, allowVisionBridge: false, apiKeyName: authenticatedKeyRecord?.name || (apiKey ? "Unknown API Key" : "Local (No API Key)"), apiKeyId: apiKeyAuth.apiKeyId, comboRouting }
        );
      },
      log,
      comboName,
      comboStrategy,
      comboStickyLimit,
      comboMembers,
      contextRequirements: perCombo.contextRequirements,
      comboTimeoutMs,
      capabilitiesMap,
      quotaRanker: (ordered) => rankComboModelsByQuota(
        ordered,
        settings,
        Date.now(),
        comboName,
        comboStrategy,
        {},
        comboRouting
      ),
      signal: request?.signal || null
    });
    // One row per logical combo request (collector holds only the latest
    // attempt's event) — never one per fallback attempt (Codex P2 on #306).
    if (tokenSaverCollector.latest) {
      try {await recordTokenSaverEvent(tokenSaverCollector.latest);} catch {/* telemetry must not break requests */}
    }
    return comboResult;
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, null, null, {
    settings,
    allowVisionBridge: true,
    apiKeyName: authenticatedKeyRecord?.name || (apiKey ? "Unknown API Key" : "Local (No API Key)"),
    apiKeyId: apiKeyAuth.apiKeyId,
  });
}

// Resolve custom capabilities for all combo members into a single map keyed
// by the original member string. Falls back to static caps when no custom row.
export async function resolveComboCapabilitiesMap(members, _depth = 0) {
  const map = new Map();
  if (!Array.isArray(members) || _depth > 6) return map;
  await Promise.all(
    members.map(async (member) => {
      const resolved = await getModelInfo(member);
      if (!resolved?.provider || !resolved?.model) {
        // Nested combo member: derive a representative caps entry so outer
        // routing (vision promotion etc.) sees the nested pool's custom
        // overrides. Any-member-true semantics match aggregateComboCapabilities.
        const nestedMembers = await getComboModels(member);
        if (!Array.isArray(nestedMembers) || nestedMembers.length === 0) return;
        const nestedMap = await resolveComboCapabilitiesMap(nestedMembers, _depth + 1);
        if (nestedMap.size === 0) return;
        const agg = {};
        for (const caps of nestedMap.values()) {
          for (const [k, v] of Object.entries(caps)) {
            if (v === true) agg[k] = true;
          }
        }
        if (Object.keys(agg).length > 0) map.set(member, agg);
        return;
      }
      const requestPrefix = parseModel(member).providerAlias || null;
      const caps = await loadCustomCapabilities(resolved.provider, resolved.model, requestPrefix);
      if (caps) map.set(member, caps);
    })
  );
  return map;
}

async function buildSingleModelCapabilitiesMap(modelStr) {
  const resolved = await getModelInfo(modelStr);
  if (!resolved?.provider || !resolved?.model) return null;
  const requestPrefix = parseModel(modelStr).providerAlias || null;
  const caps = await loadCustomCapabilities(resolved.provider, resolved.model, requestPrefix);
  return caps;
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, attemptSignal = null, tokenSaverCollector = null, options = {}) {
  const { settings = null, allowVisionBridge = false, preResolvedCapabilities = undefined, apiKeyName = apiKey ? "Unknown API Key" : "Local (No API Key)", apiKeyId = null, comboRouting = null } = options;
  const requestSignal = attemptSignal || request?.signal || null;
  if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const chatSettings = await getSettings();
    // #6495 / F-4: filter paid members when the toggle is on.
    const comboModels = await getComboModels(modelStr, chatSettings.hidePaidModels === true);
    if (comboModels) {
      // Resolve the canonical persisted name once so ACL, per-combo strategy
      // lookups, and rotation/scoring keys are stable regardless of the
      // casing the client sent (#10177). Auto-combo ids pass through as-is.
      const comboName = (await getComboCanonicalName(modelStr)) || modelStr;
      const comboMembers = (await getComboForModel(comboName))?.members || [];
      // #747: nested combo resolves its OWN allow-list, then intersects with the
      // parent so the inner combo can only narrow eligibility, never replace it.
      // Attribution (combo id / name) stays with the OUTER combo (the one the
      // client asked for) so usage reporting is honest.
      const innerRouting = await getComboRoutingPolicy(comboName);
      const mergedRouting = mergeComboRouting(comboRouting, innerRouting);
      // Check for combo-specific strategy first, fallback to global. Auto-combo
      // ids honor the F-2 `.strategy` shape; named combos keep `.fallbackStrategy`.
      const comboStrategies = chatSettings.comboStrategies || {};
      const perCombo = comboStrategies[comboName] || {};
      const comboSpecificStrategy = isAutoComboId(modelStr) ?
      perCombo.strategy ?? perCombo.fallbackStrategy :
      perCombo.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${comboName}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel, panelSignal) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(
              b,
              m,
              cleanRawReq,
              request,
              apiKey,
              combineAbortSignals(requestSignal, panelSignal),
              null,
              { settings: chatSettings, allowVisionBridge: false, apiKeyName, apiKeyId, comboRouting: mergedRouting }
            );
          },
          log,
          comboName,
          judgeModel: perCombo.judgeModel,
          tuning: perCombo.fusionTuning,
          contextRequirements: perCombo.contextRequirements,
          capabilitiesMap: await resolveComboCapabilitiesMap(comboModels)
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      const comboTimeoutMs = perCombo?.timeoutMs || COMBO_MODEL_TIMEOUT_MS || 0;
      log.info("CHAT", `Combo "${comboName}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit}, timeout: ${comboTimeoutMs || "off"})`);
      // Nested combos inherit the parent's collector if present; otherwise own
      // it so nested fallback attempts do not double-count rows.
      const ownsCollector = !tokenSaverCollector;
      const nestedCollector = tokenSaverCollector || { latest: null };
      const nestedCapabilitiesMap = await resolveComboCapabilitiesMap(comboModels);
      const nestedResult = await handleComboChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, attemptSignal) => {
          // Reset per nested attempt so a silent attempt does not replay the
          // previous nested attempt's event.
          nestedCollector.latest = null;
          return handleSingleModelChat(
            b,
            m,
            clientRawRequest,
            request,
            apiKey,
            combineAbortSignals(requestSignal, attemptSignal),
            nestedCollector,
            { settings: chatSettings, allowVisionBridge: false, apiKeyName, apiKeyId, comboRouting: mergedRouting }
          );
        },
        log,
        comboName,
        comboStrategy,
        comboStickyLimit,
        comboMembers,
        contextRequirements: perCombo.contextRequirements,
        comboTimeoutMs,
        capabilitiesMap: nestedCapabilitiesMap,
        quotaRanker: (ordered) => rankComboModelsByQuota(
          ordered,
          chatSettings,
          Date.now(),
          comboName,
          comboStrategy,
          {},
          mergedRouting
        ),
        signal: requestSignal
      });
      if (ownsCollector && nestedCollector.latest) {
        try {await recordTokenSaverEvent(nestedCollector.latest);} catch {/* telemetry must not break requests */}
      }
      return nestedResult;
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Reject image-only models routed to /v1/chat/completions (#6457 / #6525).
  // getModelInfo already resolved the registry {provider, model}; a kind:"image"
  // entry belongs on /v1/images/generations. Guard fires before credentials /
  // dispatch so the upstream is never called.
  if (isImageOnlyModel(provider, model)) {
    log.warn("CHAT", `Rejecting image-generation model on chat endpoint: ${provider}/${model}`);
    return errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      `Model '${provider}/${model}' is an image-generation model and cannot be used on /v1/chat/completions. Use POST /v1/images/generations instead.`
    );
  }

  // Enforce per-API-key model policy against the resolved underlying model when
  // the request started as a combo; the top-level combo name is not a model id.
  const policyError2 = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (policyError2) return policyError2;

  // Vision Bridge (#6640): after policy passes, resolve custom capabilities and
  // reroute vision requests to the configured vision-capable model. Denied
  // requests never reach this DB lookup. Combo members resolve their own caps
  // upstream; this branch is only for single-model requests.
  let modelCapabilities = preResolvedCapabilities;
  if (allowVisionBridge && settings?.visionBridgeEnabled === true && modelCapabilities === undefined) {
    const singleModelCaps = await buildSingleModelCapabilitiesMap(modelStr);
    const visionTargetCaps = settings?.visionBridgeModel ?
    await buildSingleModelCapabilitiesMap(String(settings.visionBridgeModel)) :
    null;
    const vb = applyVisionBridgeReroute({ body, modelStr, settings, capabilities: singleModelCaps, targetCapabilities: visionTargetCaps });
    if (vb.rerouted) {
      const policyError = await enforceApiKeyModelPolicy(request, vb.modelStr, apiKey);
      if (policyError) {
        log.warn("CHAT", `Vision Bridge target "${vb.toModel}" denied by API key policy; keeping "${modelStr}"`);
      } else {
        log.info("CHAT", `Vision Bridge reroute: ${vb.fromModel} -> ${vb.toModel}`);
        // Re-resolve provider/model for the rerouted target and recurse into the
        // retry loop with vision bridge disabled to prevent loops. The body/model
        // update is scoped to the recursive call so the original stays intact.
        const reroutedInfo = await getModelInfo(vb.modelStr);
        if (reroutedInfo?.provider) {
          return handleSingleModelChat(
            vb.body,
            vb.modelStr,
            clientRawRequest,
            request,
            apiKey,
            attemptSignal,
            tokenSaverCollector,
            { settings, allowVisionBridge: false, preResolvedCapabilities: visionTargetCaps, apiKeyName, apiKeyId }
          );
        }
        // Invalid reroute target: fall through to original model.
      }
    }
    modelCapabilities = singleModelCaps;
  }

  // Pin the request to a specific connection when the client asks for one.
  // The header is preferred; body fields are accepted for backwards-compatible
  // clients but stripped before the core sees them.
  const rawConnectionPin = request.headers.get("x-connection-id") ||
  body.connectionId ||
  body.connection_id ||
  null;
  let preferredConnectionId = null;
  if (rawConnectionPin) {
    const requestedId = String(rawConnectionPin);
    const canonicalProvider = resolveProviderId(provider);
    const scopedConnectionIds = apiKeyId ? await getApiKeyProviderConnectionIds(apiKeyId) : [];
    if (scopedConnectionIds.length > 0 && !scopedConnectionIds.includes(requestedId)) {
      log.warn("CHAT", `[${provider}/${model}] pinned connection ${requestedId.slice(0, 8)} not in scope for API key`);
      return errorResponse(HTTP_STATUS.BAD_REQUEST, "Requested connection is not available for this API key");
    }
    const activeConnections = await getProviderConnections({ provider: canonicalProvider, isActive: true });
    const pinnedConnection = activeConnections.find((c) => c.id === requestedId);
    if (!pinnedConnection) {
      log.warn("CHAT", `x-connection-id not found for provider ${canonicalProvider}: ${requestedId.slice(0, 8)}`);
      return errorResponse(
        HTTP_STATUS.BAD_REQUEST,
        `Connection ${requestedId.slice(0, 8)}... is not active for provider '${canonicalProvider}'.`
      );
    }
    preferredConnectionId = pinnedConnection.id;
    log.info("CHAT", `[${provider}/${model}] pinned to connection ${preferredConnectionId.slice(0, 8)}`);
  }
  // Strip router-only connection pin from upstream request body.
  if (body.connectionId !== undefined || body.connection_id !== undefined) {
    body = { ...body };
    delete body.connectionId;
    delete body.connection_id;
  }

  // Strip reasoning_content for providers that reject it (Mistral, etc.)
  // Preserve for providers that require it (DeepSeek thinking mode)
  if (!provider.startsWith("deepseek")) {
    body = stripReasoningFromMessages(body);
  }
  // Fix message ordering for all providers (prefix: true for last assistant)
  fixMessageOrdering(body.messages);

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  const routingSessionId = resolveClientSessionId({
    headers: clientRawRequest?.headers,
    body,
    scope: provider
  });

  // Resolve request-scoped custom capabilities once, just before the retry loop.
  // Custom model aliases are stored by provider prefix; requestPrefix carries
  // the prefix the caller actually used (e.g. node alias or bare model alias).
  const parsed = parseModel(modelStr);
  const requestPrefix = parsed?.providerAlias || null;
  // The direct single-model path already resolved caps for the vision bridge;
  // reuse that result (undefined = not resolved yet). Combo attempts pass
  // undefined so each member resolves its own caps.
  const resolvedModelCapabilities = modelCapabilities !== undefined ?
  modelCapabilities :
  await loadCustomCapabilities(provider, model, requestPrefix);

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  const attemptCounts = new Map();
  const attemptedBlockers = new Map();
  const refreshedQuotaConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let antigravityCapacitySweeps = 0;
  let totalAttempts = 0;
  let requestReplayConnectionId = null;
  let requestReplayAttempted = false;
  const providerAlias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const upstreamModel = getModelUpstreamId(providerAlias, model);
  const quotaFamily = getModelQuotaFamily(providerAlias, model);
  const modelCandidates = [...new Set([model, upstreamModel].filter(Boolean))];
  const quotaResourceKeys = buildQuotaResourceKeys({ provider, modelCandidates, quotaFamily });

  // Token Saver telemetry (port of 9router #2562): capture the LATEST routing
  // attempt's normalized event; fallback retries overwrite it. When a parent
  // combo passes a collector, feed events into it and skip the local finally
  // persistence so the whole combo writes one row. Otherwise persist once in
  // finally (success, terminal error, abort, or throw) so one logical request
  // = one row and retries never double-count.
  let lastTokenSaverEvent = null;
  try {
    while (true) {
      if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
      let credentials;
      try {
        credentials = await getProviderCredentialsWithQuotaPreflight(provider, excludeConnectionIds, model, {
          signal: requestSignal,
          modelCandidates,
          quotaFamily,
          resourceKeys: quotaResourceKeys,
          sessionId: routingSessionId,
          preferredConnectionId: preferredConnectionId || requestReplayConnectionId,
          apiKeyId,
          allowedConnectionIds: comboRouting?.allowedConnectionIds || null,
          restrictionApplied: comboRouting?.restrictionApplied === true
        });
      } catch (error) {
        if (error?.name === "AbortError" || requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
        throw error;
      }

      // If the caller pinned a connection, the selected credential must match it
      // exactly. Otherwise the account has been excluded/quota-blocked/rotated and
      // the pin is no longer honored.
      if (preferredConnectionId && credentials?.connectionId && credentials.connectionId !== preferredConnectionId) {
        log.warn("CHAT", `[${provider}/${model}] pinned connection ${preferredConnectionId.slice(0, 8)} not selected; refusing rotation`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `Connection ${preferredConnectionId.slice(0, 8)}... is not available for provider '${provider}'.`);
      }

      // All accounts unavailable or provider disabled
      if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
        if (credentials?.providerDisabled) {
          log.warn("CHAT", `[${provider}/${model}] free no-auth provider disabled by settings`);
          return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
        }
        if (credentials?.allRateLimited) {
          const storedStatus = Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
          const combinedRateLimit = aggregateRateLimitBlockers(attemptedBlockers, {
            status: storedStatus,
            retryAt: credentials.retryAfter || null,
            retryAtKnown: Boolean(credentials.retryAfter)
          });
          const status = combinedRateLimit?.status || (
          storedStatus !== 429 ? storedStatus : lastStatus || storedStatus);
          const errorMsg = status === storedStatus ?
          credentials.lastError || "Unavailable" :
          lastError || credentials.lastError || "Unavailable";
          const retryAfter = combinedRateLimit ? combinedRateLimit.retryAt : credentials.retryAfter;
          log.warn("CHAT", `[${provider}/${model}] all accounts unavailable`);
          return unavailableResponse(getClientStatusFromError(status, errorMsg), `[${provider}/${model}] ${errorMsg}`, retryAfter, retryAfter ? credentials.retryAfterHuman : "");
        }
        if (excludeConnectionIds.size === 0) {
          // 404 is right either way here, because /v1/models filters on isActive too,
          // so the model genuinely is not in the catalogue. What differs is why.
          if (isRoutableProvider(provider)) {
            log.warn("AUTH", `No active credentials for provider: ${provider}`);
            return errorResponse(
              HTTP_STATUS.NOT_FOUND,
              `No active credentials for provider: ${provider}. Connect an account for this provider in the dashboard.`,
              { code: "provider_not_configured" },
            );
          }
          log.warn("AUTH", `Unknown provider: ${provider}`);
          return errorResponse(
            HTTP_STATUS.NOT_FOUND,
            `Unknown provider "${provider}" in model "${provider}/${model}". See /v1/models for what this router serves.`,
          );
        }
        if (
        (provider === "antigravity" || provider === "agy") &&
        isAntigravityCapacityError(lastStatus, lastError) &&
        antigravityCapacitySweeps < ANTIGRAVITY_CAPACITY_SWEEP_RETRIES)
        {
          antigravityCapacitySweeps += 1;
          log.warn("CHAT", `[${provider}/${model}] all accounts reported capacity; restarting account sweep ${antigravityCapacitySweeps}/${ANTIGRAVITY_CAPACITY_SWEEP_RETRIES}`);
          excludeConnectionIds.clear();
          continue;
        }
        log.warn("CHAT", "No more accounts available", { provider });
        const attemptedRateLimit = aggregateRateLimitBlockers(attemptedBlockers);
        if (attemptedRateLimit) {
          return unavailableResponse(429, `[${provider}/${model}] ${lastError || "Rate limit exceeded"}`, attemptedRateLimit.retryAt, "");
        }
        return errorResponse(getClientStatusFromError(lastStatus, lastError), lastError || "All accounts unavailable");
      }

      const allowedAttempts = provider === "antigravity" || provider === "agy" ?
      ANTIGRAVITY_CAPACITY_SWEEP_RETRIES + 1 :
      1;
      const priorAttempts = attemptCounts.get(credentials.connectionId) || 0;
      if (priorAttempts >= allowedAttempts || totalAttempts >= MAX_ACCOUNT_ATTEMPTS_PER_REQUEST) {
        excludeConnectionIds.add(credentials.connectionId);
        if (totalAttempts >= MAX_ACCOUNT_ATTEMPTS_PER_REQUEST) {
          log.warn("FALLBACK", "Provider fallback attempt bound reached");
          const attemptedRateLimit = aggregateRateLimitBlockers(attemptedBlockers);
          if (attemptedRateLimit) {
            return unavailableResponse(429, `[${provider}/${model}] ${lastError || "Rate limit exceeded"}`, attemptedRateLimit.retryAt, "");
          }
          return errorResponse(getClientStatusFromError(lastStatus, lastError), lastError || "All accounts unavailable");
        }
        continue;
      }
      attemptCounts.set(credentials.connectionId, priorAttempts + 1);
      totalAttempts += 1;

      if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");

      // Account selection shown in the unified "▶" line (acc:...). OAuth
      // rotation goes through the shared CAS coordinator used by quota refresh.
      let activeConnection = credentials._connection || null;
      let refreshedCredentials = credentials;
      if (activeConnection?.authType === "oauth") {
        try {
          const refreshed = await refreshAndUpdateCredentials(
            activeConnection,
            false,
            proxyOptionsFromCredentials(credentials),
            { signal: requestSignal, log }
          );
          activeConnection = refreshed.connection;
          refreshedCredentials = await projectProviderCredentials(activeConnection, credentials._quotaPreflight);
        } catch (error) {
          if (error?.name === "AbortError") return errorResponse(499, "Request aborted");
          log.warn("TOKEN", "Proactive credential refresh failed; attempting existing credential");
        }
      }

      if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");

      // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
      if ((provider === "antigravity" || provider === "agy" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
        try {
          const pid = await getProjectIdForConnection(
            credentials.connectionId,
            refreshedCredentials.accessToken,
            refreshedCredentials.providerSpecificData,
            requestSignal,
            provider
          );
          if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
          if (pid) {
            refreshedCredentials.projectId = pid;
            // Persist only after the subscriber is still live; a disconnected
            // request must not schedule a late credential write.
            updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => {});
          }
        } catch (error) {
          if (error?.name === "AbortError" || requestAborted(request, requestSignal)) {
            return errorResponse(499, "Request aborted");
          }
        }
      }
      if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
      warmRequestModelLimits(provider, refreshedCredentials);

      // Use shared chatCore
      const chatSettings = await getSettings();
      if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
      const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
      const pxpipeTransform = chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null;
      if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
      let latestAttemptStartedAt = null;
      const quotaReservation = createQuotaReservationLifecycle({
        quotaProfile: credentials._quotaPreflight?.quotaProfile || null,
        connectionId: credentials.connectionId,
        provider,
        routeKey: `${provider}/${model}`,
        config: chatSettings.quotaSelection || {}
      });
      const result = await handleChatCore({
        body: { ...structuredClone(body), model: `${provider}/${model}` },
        modelInfo: { provider, model },
        modelCapabilities: resolvedModelCapabilities,
        credentials: refreshedCredentials,
        log,
        clientRawRequest,
        connectionId: credentials.connectionId,
        userAgent,
        apiKey,
        apiKeyName,
        abortSignal: requestSignal,
        // #747: outer-combo attribution; nested merge narrowed eligibility
        // (comboRouting.allowedConnectionIds) without changing attribution.
        comboId: comboRouting?.id || null,
        comboName: comboRouting?.name || null,
        quotaReservation,
        onProviderAttempt: () => {
          latestAttemptStartedAt = allocateProviderAttemptTimestamp();
          return latestAttemptStartedAt;
        },
        ccFilterNaming: !!chatSettings.ccFilterNaming,
        rtkEnabled: !!chatSettings.rtkEnabled,
        headroomEnabled: !!chatSettings.headroomEnabled,
        headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
        headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
        headroomTimeoutMs: chatSettings.headroomTimeoutMs,
        pxpipeEnabled: !!chatSettings.pxpipeEnabled,
        cavemanEnabled: !!chatSettings.cavemanEnabled,
        cavemanLevel: chatSettings.cavemanLevel || "full",
        ponytailEnabled: !!chatSettings.ponytailEnabled,
        ponytailLevel: chatSettings.ponytailLevel || "full",
        pxpipeMinChars: chatSettings.pxpipeMinChars,
        pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
        pxpipeTransform,
        pxpipeAllowedModels: chatSettings.pxpipeAllowedModels,
        onPxpipeEvent: appendPxpipeEvent,
        onHeadroomEvent: appendHeadroomEvent,
        onTokenSaverEvent: (event) => {
          if (tokenSaverCollector) {
            tokenSaverCollector.latest = event;
          } else {
            lastTokenSaverEvent = event;
          }
        },
        providerThinking,
        providerConcurrencyLimit: chatSettings.providerConcurrencyLimits,
        claudeClassifierCompat: ["off", "auto", "always"].includes(chatSettings.claudeClassifierCompat) ?
        chatSettings.claudeClassifierCompat :
        "off",
        compressionEnabled: !!chatSettings.compressionEnabled,
        compressionEngines: chatSettings.compressionEngines || {},
        // Detect source format by endpoint + body
        sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
        ...(activeConnection?.authType === "oauth" ? {
          refreshCredentials: async ({ signal, force = true } = {}) => {
            const refreshed = await refreshAndUpdateCredentials(
              activeConnection,
              force,
              proxyOptionsFromCredentials(refreshedCredentials),
              { signal, log }
            );
            activeConnection = refreshed.connection;
            refreshedCredentials = await projectProviderCredentials(activeConnection, credentials._quotaPreflight);
            return refreshedCredentials;
          }
        } : null),
        onRequestSuccess: async ({ attemptStartedAt = latestAttemptStartedAt } = {}) => {
          if (provider === "antigravity" || provider === "agy") {
            clearAntigravity429Strikes(credentials.connectionId, model);
          }
          if (!Number.isSafeInteger(attemptStartedAt) || attemptStartedAt <= 0) return;
          await clearAccountError(credentials.connectionId, refreshedCredentials, model, {
            provider,
            attemptStartedAt,
            signal: requestSignal
          });
        },
        // Streaming headers are already committed when emptiness becomes known.
        // Bench this account so the client's retry selects another candidate.
        onEmptyStream: async () => {
          if (!Number.isSafeInteger(latestAttemptStartedAt) || latestAttemptStartedAt <= 0) return;
          await markAccountUnavailable(
            credentials.connectionId,
            HTTP_STATUS.BAD_GATEWAY,
            `Empty streaming response from ${provider}/${model}`,
            provider,
            model,
            Date.now() + EMPTY_CONTENT_COOLDOWN_MS,
            { attemptStartedAt: latestAttemptStartedAt, signal: requestSignal }
          );
        },
        // Empty-stream retries exhausted mid-stream (headers already sent, so no
        // pre-stream fallback is possible): bench the account so the client's
        // automatic retry of the in-stream error lands on the next one. Quota
        // exhaustion passes a precise resetsAtMs instead of the generic cooldown.
        onUpstreamEmptyExhausted: async (reason, resetsAtMs) => {
          if (!Number.isSafeInteger(latestAttemptStartedAt) || latestAttemptStartedAt <= 0) return;
          await markAccountUnavailable(credentials.connectionId, HTTP_STATUS.BAD_GATEWAY, reason, provider, model, resetsAtMs, {
            attemptStartedAt: latestAttemptStartedAt,
            signal: requestSignal
          });
        }
      });

      if (result.success) return result.response;
      // A client-side abort (named AbortError, or a bare request_signal_aborted /
      // "Client disconnected" / "operation was aborted" that defaulted to 502) is a
      // local stream lifecycle event, NOT a provider failure. Return without cooling
      // down the account or accruing fallback state (OmniRoute #7907/#7908).
      if (requestAborted(request, requestSignal) || result.status === 499 || isLocalStreamLifecycleError(result.error)) return result.response;
      if (!requestReplayAttempted && isRequestReplayBufferError(result.status, result.error)) {
        requestReplayAttempted = true;
        requestReplayConnectionId = credentials.connectionId;
        attemptCounts.delete(credentials.connectionId);
        log.warn("RETRY", `ACC:${credentials.connectionName} replaying once after upstream request-buffer overflow`);
        continue;
      }
      if (preferredConnectionId) {
        // A pinned connection must not rotate. Return the failure response immediately.
        log.warn("CHAT", `[${provider}/${model}] pinned connection ${preferredConnectionId.slice(0, 8)} failed; pin is terminal`);
        return result.response;
      }
      if (result.quotaCapacityUnavailable) {
        // A local atomic-capacity race is not provider evidence. Release/expiry is
        // owned by the lifecycle; exclude this account and try a sibling without
        // writing a synthetic 429 or breaker state.
        excludeConnectionIds.add(credentials.connectionId);
        lastError = "Provider quota capacity unavailable";
        lastStatus = HTTP_STATUS.SERVICE_UNAVAILABLE;
        continue;
      }

      const resultAttemptStartedAt = Number.isSafeInteger(result.attemptStartedAt) && result.attemptStartedAt > 0 ?
      result.attemptStartedAt :
      latestAttemptStartedAt;
      const resultErrorBody = result.errorBody && isObject(result.errorBody) ? result.errorBody : null;
      const resultHeaders = result.headers ?? null;
      const upstreamRequestId = ["x-request-id", "request-id", "x-correlation-id"]
        .map((name) => validateProviderRequestId(new Headers(resultHeaders || {}).get(name)))
        .find(Boolean);
      if (upstreamRequestId) {
        const responseHeaders = new Headers(result.response.headers);
        responseHeaders.set("x-upstream-request-id", upstreamRequestId);
        result.response = new Response(result.response.body, {
          status: result.response.status,
          statusText: result.response.statusText,
          headers: responseHeaders,
        });
      }
      const antigravityProvider = provider === "antigravity" || provider === "agy";
      const authoritativeResetAt = Number(result.rateLimitEvidence?.resetAtMs);
      const authoritativeReset = Number.isFinite(result.resetsAtMs) ||
      Number.isFinite(authoritativeResetAt) && authoritativeResetAt > Date.now();
      if (antigravityProvider && result.status === 429 && authoritativeReset) {
        clearAntigravity429Strikes(credentials.connectionId, model);
      }
      /**
       * Antigravity 409s and 429s without executor reset metadata may describe
       * exact model quota. Refresh the shared repository before creating any
       * legacy lock; only a fresh exact-source blocker owns the reselect.
       */
      const shouldRefreshAntigravityQuota =
        antigravityProvider &&
        (result.status === 409 || (result.status === 429 && !authoritativeReset)) &&
        activeConnection &&
        !refreshedQuotaConnectionIds.has(credentials.connectionId);
      if (shouldRefreshAntigravityQuota) {
        refreshedQuotaConnectionIds.add(credentials.connectionId);
        try {
          const refreshResult = await refreshProviderQuota(activeConnection, {
            signal: requestSignal,
            force: true
          });
          const decision = refreshResult?.outcome === "success" && Array.isArray(refreshResult.snapshots) ?
          evaluateProviderQuotaPreflight(refreshResult.snapshots, {
            connectionId: credentials.connectionId,
            provider,
            resourceKeys: quotaResourceKeys,
            now: Date.now(),
            refreshSupported: true
          }) :
          null;
          if (decision?.skip) {
            clearAntigravity429Strikes(credentials.connectionId, model);
            log.info("AUTH", `${provider} | refreshed quota blocked ${credentials.connectionId.slice(0, 8)} (reason=${decision.reason || "unknown"}); reselecting`);
            lastError = result.error;
            lastStatus = result.status;
            continue;
          }
        } catch (error) {
          if (error?.name === "AbortError" || requestAborted(request, requestSignal)) {
            return errorResponse(499, "Request aborted");
          }
          log.warn("QUOTA", `${provider} | reactive quota refresh failed for ${credentials.connectionId.slice(0, 8)}; using standard fallback`);
        }
      }

      const strikeBreakerResetAt = antigravityProvider && result.status === 429 && !authoritativeReset ?
      recordAntigravity429Strike(credentials.connectionId, model) :
      null;
      const fallbackResetAt = strikeBreakerResetAt ?? result.resetsAtMs;
      const fallbackEvidence = strikeBreakerResetAt === null ?
      result.rateLimitEvidence || null :
      { state: result.rateLimitEvidence?.state === "exhausted" ? "exhausted" : "cooldown", resetAtMs: strikeBreakerResetAt, source: "antigravity_strike_breaker" };

      const fallbackState = await markAccountUnavailable(
        credentials.connectionId,
        result.status,
        result.error,
        provider,
        model,
        fallbackResetAt,
        {
          attemptStartedAt: resultAttemptStartedAt,
          rateLimitEvidence: fallbackEvidence,
          headers: resultHeaders,
          errorBody: resultErrorBody,
          signal: requestSignal
        }
      );
      const { shouldFallback } = fallbackState;

      if (shouldFallback) {
        attemptedBlockers.set(credentials.connectionId, {
          status: Number(result.status) || 503,
          retryAt: fallbackState.retryAt || null,
          retryAtKnown: fallbackState.retryAtKnown !== false
        });
        log.warn("FALLBACK", `⇄ ACC:${credentials.connectionId.slice(0, 8)} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
        excludeConnectionIds.add(credentials.connectionId);
        lastError = result.error;
        lastStatus = result.status;
        continue;
      }

      return result.response;
    }
  } finally {
    // Persist the latest routing attempt's event once per logical request.
    // Awaited so the row is durable before the response returns (fail-open
    // inside recordTokenSaverEvent — it catches DB errors and never throws).
    // Skip when a collector is in use; the owner persists after all attempts.
    if (lastTokenSaverEvent && !tokenSaverCollector) await recordTokenSaverEvent(lastTokenSaverEvent);
  }
}
export const handleChat = withRequestCorrelation(handleChatHandler);
