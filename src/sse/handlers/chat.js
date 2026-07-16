import "open-sse/index.js";

import {
  getProviderCredentials,
  projectProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  evaluateApiKeyAuth,
  isProviderConnectionModelLocked,
  providerAllowsPublicNoAuthFallback,
} from "../services/auth.js";
import { cacheClaudeHeaders } from "open-sse/utils/claudeHeaderCache.js";
import {
  getSettings, getApiKeyByKey, getApiKeyUsageLimitStatus,
  getProviderConnections, getQuotaReservationPressure,
} from "@/lib/localDb";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { getModelInfo, getComboModels } from "../services/model.js";
import { isAutoComboId } from "open-sse/services/autoComboResolver.js";
import { applyVisionBridgeReroute } from "open-sse/services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import {
  getComboModelQuotaHealth,
  handleComboChat,
  handleFusionChat,
} from "open-sse/services/combo.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { handlePonytailCommands, DEFAULT_PONYTAIL_HELP, resolvePonytailStream } from "open-sse/utils/tokenSaverBridge.js";
import { resolveTokenSaverEnabled } from "open-sse/rtk/index.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { detectFormat } from "open-sse/services/provider.js";
import { isAntigravityCapacityError } from "open-sse/services/accountFallback.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials } from "../services/tokenRefresh.js";
import { refreshAndUpdateCredentials } from "@/shared/services/providerCredentials";
import { refreshProviderQuota } from "@/shared/services/providerQuotaTracker";
import { allocateProviderAttemptTimestamp } from "@/shared/services/providerRateLimitEvidence";
import {
  getModelQuotaFamily,
  getModelUpstreamId,
  PROVIDER_ID_TO_ALIAS,
} from "open-sse/config/providerModels.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { enforceApiKeyModelPolicy } from "../services/apiKeyPolicy.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { validateChatRequestBody } from "open-sse/translator/validate.js";
import {
  createQuotaReservationLifecycle,
  rankQuotaConnections,
} from "@/shared/services/quotaSelection";
import { buildQuotaResourceKeys, inspectProviderQuota } from "@/shared/services/providerQuotaPreflight";
import {
  quotaDecisionDiagnostic,
  rankQuotaCandidates,
} from "open-sse/services/quota/scoring.js";

const ANTIGRAVITY_CAPACITY_SWEEP_RETRIES = 2;
const MAX_ACCOUNT_ATTEMPTS_PER_REQUEST = 1024;

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
  const retryAt = complete
    ? entries.map((entry) => entry.retryAt).sort((left, right) => Date.parse(left) - Date.parse(right))[0]
    : null;
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
    disableEnvProxy: config.disableEnvProxy === true,
  };
}

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
) {
  try {
    const resolveModelInfo = dependencies.getModelInfo || resolveQuotaModelInfo;
    const loadConnections = dependencies.getProviderConnections || getProviderConnections;
    const inspectQuota = dependencies.inspectProviderQuota || inspectProviderQuota;
    const loadPressure = dependencies.getQuotaReservationPressure || getQuotaReservationPressure;
    const isLocked = dependencies.isProviderConnectionModelLocked || isProviderConnectionModelLocked;
    const allowsPublicNoAuth = dependencies.providerAllowsPublicNoAuthFallback
      || providerAllowsPublicNoAuthFallback;
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
      const connections = await loadConnections({ provider, isActive: true });
      const resourceKeys = buildQuotaResourceKeys({
        provider,
        modelCandidates: [...new Set([model, upstreamModel].filter(Boolean))],
        quotaFamily,
      });
      const decisions = await inspectQuota(connections, { provider, resourceKeys, now });
      const pressure = connections.length > 0
        ? await loadPressure({ provider, connectionIds: connections.map((connection) => connection.id), now })
        : new Map();
      const lockedConnectionIds = new Set(connections
        .filter((connection) => isLocked(connection, provider, model, now))
        .map((connection) => connection.id));
      const allLocked = connections.length > 0 && lockedConnectionIds.size === connections.length;
      const allLockedWithoutPublicFallback = allLocked && !allowsPublicNoAuth(provider);
      const selectableConnections = connections.filter((connection) => (
        !decisions.get(connection.id)?.skip
        && !lockedConnectionIds.has(connection.id)
      ));
      const publicFallbackWillApply = allowsPublicNoAuth(provider)
        && connections.length > 0
        && selectableConnections.length === 0;
      const rankedConnections = rankQuotaConnections(selectableConnections, decisions, pressure, {
        provider,
        now,
        config: settings.quotaSelection || {},
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
            reason: decision.reason || "exhausted",
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
          comboStrategy === "smart-scoring"
            ? comboHealth(comboName, modelStr)
            : "healthy",
        ),
        routingFloorBlocked,
        priority: index,
        priorityRank: index,
      });
    }
    const ranked = rankQuotaCandidates(candidates, { now });
    for (const candidate of ranked) {
      log.debug("QUOTA", "combo candidate", quotaDecisionDiagnostic(candidate.quotaDecision));
    }
    return [
      ...ranked.filter((candidate) => candidate.quotaDecision?.eligible !== false),
      ...ranked.filter((candidate) => candidate.quotaDecision?.eligible === false),
    ].map((candidate) => candidate.value);
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
export async function handleChat(request, clientRawRequest = null) {
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

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  cacheClaudeHeaders(clientRawRequest.headers);

  let modelStr = body.model;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Stored credentials are always validated; local mode only permits unknown
  // placeholders when API-key enforcement is disabled.
  const settings = await getSettings();
  const apiKeyAuth = await evaluateApiKeyAuth(apiKey, { required: settings.requireApiKey === true, request });
  if (!apiKeyAuth.ok) {
    if (apiKeyAuth.reason === "missing") {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    log.warn("AUTH", "Invalid API key");
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  // Per-key combo access control. Retain the authenticated record so local
  // commands can expose only this key's own lifetime totals.
  let authenticatedKeyRecord = null;
  if (apiKey && modelStr) {
    authenticatedKeyRecord = await getApiKeyByKey(apiKey);
    if (authenticatedKeyRecord && Array.isArray(authenticatedKeyRecord.allowedCombos) && authenticatedKeyRecord.allowedCombos.length > 0) {
      const comboCheck = await getComboModels(modelStr);
      if (comboCheck && !authenticatedKeyRecord.allowedCombos.includes(modelStr)) {
        log.warn("AUTH", `API key "${authenticatedKeyRecord.name}" not allowed to access combo "${modelStr}"`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Access denied: combo "${modelStr}" is not allowed for this API key`);
      }
    }
  }

  if (apiKey) {
    const limitStatus = await getApiKeyUsageLimitStatus(apiKey);
    if (limitStatus.exceeded) {
      const used = Math.round(limitStatus.usedTokens);
      const limit = Math.round(limitStatus.limitTokens);
      log.warn("AUTH", `API key daily token limit exceeded (${used}/${limit})`);
      return errorResponse(HTTP_STATUS.RATE_LIMITED, `API key daily token limit exceeded (${used}/${limit} tokens)`);
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
  const vb = applyVisionBridgeReroute({ body, modelStr, settings });
  if (vb.rerouted) {
    const policyError = await enforceApiKeyModelPolicy(request, vb.modelStr);
    if (policyError) {
      log.warn("CHAT", `Vision Bridge target "${vb.toModel}" denied by API key policy; keeping "${modelStr}"`);
    } else {
      log.info("CHAT", `Vision Bridge reroute: ${vb.fromModel} -> ${vb.toModel}`);
      body = vb.body;
      modelStr = vb.modelStr;
      // clientRawRequest intentionally keeps the ORIGINAL client body so usage
      // logs record the model the caller actually asked for; the reroute only
      // changes what we dispatch upstream.
    }
  }

  // Per-request token-saver bypass (#2609): `X-DurinDoor-Token-Saver: off`
  // (or legacy `X-9Router-Token-Saver: off`) disables the local Ponytail
  // slash-command interceptor so the request reaches the provider untransformed.
  const tokenSaverEnabled = resolveTokenSaverEnabled(clientRawRequest?.headers);

  // Ponytail slash commands are local-only: respond before any account/credential lookup.
  const sourceFormat = detectFormatByEndpoint(
    clientRawRequest?.endpoint || new URL(request.url).pathname,
    body,
  ) || detectFormat(body);
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  if (tokenSaverEnabled) {
    const ponytailResponse = await handlePonytailCommands(body, modelStr, {
      fetchStats: authenticatedKeyRecord
        ? async () => {
            const { getApiKeyUsageTotals } = await import("@/lib/localDb");
            return {
              ...(await getApiKeyUsageTotals(authenticatedKeyRecord.id)),
              scope: "this API key",
            };
          }
        : null,
      helpText: DEFAULT_PONYTAIL_HELP,
      sourceFormatOverride: sourceFormat,
      streamOverride: resolvePonytailStream(body, sourceFormat, acceptHeader),
    });
    if (ponytailResponse?.success && ponytailResponse.response) {
      return ponytailResponse.response;
    }
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

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
    const comboStrategies = settings.comboStrategies || {};
    const perCombo = comboStrategies[modelStr] || {};
    const comboSpecificStrategy = isAutoComboId(modelStr)
      ? (perCombo.strategy ?? perCombo.fallbackStrategy)
      : perCombo.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";

    // Combo names are intentionally excluded from the model allowlist; the allowlist
    // is enforced against each concrete underlying model during expansion. Combo-level
    // combo access control above remains the gate for combo names.
    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
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
          );
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
      contextRequirements: perCombo.contextRequirements,
      quotaRanker: (ordered) => rankComboModelsByQuota(
        ordered,
        settings,
        Date.now(),
        modelStr,
        comboStrategy,
      ),
      signal: request?.signal || null,
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, attemptSignal = null) {
  const requestSignal = attemptSignal || request?.signal || null;
  if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const chatSettings = await getSettings();
    // #6495 / F-4: filter paid members when the toggle is on.
    const comboModels = await getComboModels(modelStr, chatSettings.hidePaidModels === true);
    if (comboModels) {
      // Check for combo-specific strategy first, fallback to global. Auto-combo
      // ids honor the F-2 `.strategy` shape; named combos keep `.fallbackStrategy`.
      const comboStrategies = chatSettings.comboStrategies || {};
      const perCombo = comboStrategies[modelStr] || {};
      const comboSpecificStrategy = isAutoComboId(modelStr)
        ? (perCombo.strategy ?? perCombo.fallbackStrategy)
        : perCombo.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
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
            );
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m) => handleSingleModelChat(
          b,
          m,
          clientRawRequest,
          request,
          apiKey,
          requestSignal,
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit,
        contextRequirements: perCombo.contextRequirements,
        quotaRanker: (ordered) => rankComboModelsByQuota(
          ordered,
          chatSettings,
          Date.now(),
          modelStr,
          comboStrategy,
        ),
        signal: requestSignal,
      });
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
  const policyError2 = await enforceApiKeyModelPolicy(request, `${provider}/${model}`);
  if (policyError2) return policyError2;

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

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  const attemptCounts = new Map();
  const attemptedBlockers = new Map();
  let lastError = null;
  let lastStatus = null;
  let antigravityCapacitySweeps = 0;
  let totalAttempts = 0;
  const providerAlias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const upstreamModel = getModelUpstreamId(providerAlias, model);
  const quotaFamily = getModelQuotaFamily(providerAlias, model);
  const modelCandidates = [...new Set([model, upstreamModel].filter(Boolean))];

  while (true) {
    if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
    let credentials;
    try {
      credentials = await getProviderCredentials(provider, excludeConnectionIds, model, {
        signal: requestSignal,
        modelCandidates,
        quotaFamily,
      });
    } catch (error) {
      if (error?.name === "AbortError" || requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
      throw error;
    }

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const storedStatus = Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        const combinedRateLimit = aggregateRateLimitBlockers(attemptedBlockers, {
          status: storedStatus,
          retryAt: credentials.retryAfter || null,
          retryAtKnown: Boolean(credentials.retryAfter),
        });
        const status = combinedRateLimit?.status
          || (storedStatus !== 429 ? storedStatus : (lastStatus || storedStatus));
        const errorMsg = status === storedStatus
          ? (credentials.lastError || "Unavailable")
          : (lastError || credentials.lastError || "Unavailable");
        const retryAfter = combinedRateLimit ? combinedRateLimit.retryAt : credentials.retryAfter;
        log.warn("CHAT", `[${provider}/${model}] all accounts unavailable`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, retryAfter, retryAfter ? credentials.retryAfterHuman : "");
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      if (
        (provider === "antigravity" || provider === "agy") &&
        isAntigravityCapacityError(lastStatus, lastError) &&
        antigravityCapacitySweeps < ANTIGRAVITY_CAPACITY_SWEEP_RETRIES
      ) {
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
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const allowedAttempts = (provider === "antigravity" || provider === "agy")
      ? ANTIGRAVITY_CAPACITY_SWEEP_RETRIES + 1
      : 1;
    const priorAttempts = attemptCounts.get(credentials.connectionId) || 0;
    if (priorAttempts >= allowedAttempts || totalAttempts >= MAX_ACCOUNT_ATTEMPTS_PER_REQUEST) {
      excludeConnectionIds.add(credentials.connectionId);
      if (totalAttempts >= MAX_ACCOUNT_ATTEMPTS_PER_REQUEST) {
        log.warn("FALLBACK", "Provider fallback attempt bound reached");
        const attemptedRateLimit = aggregateRateLimitBlockers(attemptedBlockers);
        if (attemptedRateLimit) {
          return unavailableResponse(429, `[${provider}/${model}] ${lastError || "Rate limit exceeded"}`, attemptedRateLimit.retryAt, "");
        }
        return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "All accounts unavailable");
      }
      continue;
    }
    attemptCounts.set(credentials.connectionId, priorAttempts + 1);
    totalAttempts += 1;

    // Refresh stale/missing provider quota outside the credential-selection
    // mutex. Batch 2 deduplicates concurrent subscribers and fences late work.
    if (credentials._quotaPreflight?.shouldRefresh && credentials._connection) {
      refreshProviderQuota(credentials._connection, { signal: requestSignal }).catch((error) => {
        if (error?.name !== "AbortError") log.warn("QUOTA", "Background quota refresh failed");
      });
    }

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
          { signal: requestSignal, log },
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
        );
        if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");
        if (pid) {
          refreshedCredentials.projectId = pid;
          // Persist only after the subscriber is still live; a disconnected
          // request must not schedule a late credential write.
          updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
        }
      } catch (error) {
        if (error?.name === "AbortError" || requestAborted(request, requestSignal)) {
          return errorResponse(499, "Request aborted");
        }
      }
    }
    if (requestAborted(request, requestSignal)) return errorResponse(499, "Request aborted");

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
      config: chatSettings.quotaSelection || {},
    });
    const result = await handleChatCore({
      body: { ...structuredClone(body), model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      abortSignal: requestSignal,
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
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      pxpipeTransform,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      providerConcurrencyLimit: chatSettings.providerConcurrencyLimits,
      claudeClassifierCompat: ["off", "auto", "always"].includes(chatSettings.claudeClassifierCompat)
        ? chatSettings.claudeClassifierCompat
        : "off",
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
            { signal, log },
          );
          activeConnection = refreshed.connection;
          refreshedCredentials = await projectProviderCredentials(activeConnection, credentials._quotaPreflight);
          return refreshedCredentials;
        },
      } : {}),
      onRequestSuccess: async ({ attemptStartedAt = latestAttemptStartedAt } = {}) => {
        if (!Number.isSafeInteger(attemptStartedAt) || attemptStartedAt <= 0) return;
        await clearAccountError(credentials.connectionId, refreshedCredentials, model, {
          provider,
          attemptStartedAt,
          signal: requestSignal,
        });
      },
      // Empty-stream retries exhausted mid-stream (headers already sent, so no
      // pre-stream fallback is possible): bench the account so the client's
      // automatic retry of the in-stream error lands on the next one. Quota
      // exhaustion passes a precise resetsAtMs instead of the generic cooldown.
      onUpstreamEmptyExhausted: async (reason, resetsAtMs) => {
        if (!Number.isSafeInteger(latestAttemptStartedAt) || latestAttemptStartedAt <= 0) return;
        await markAccountUnavailable(credentials.connectionId, HTTP_STATUS.BAD_GATEWAY, reason, provider, model, resetsAtMs, {
          attemptStartedAt: latestAttemptStartedAt,
          signal: requestSignal,
        });
      }
    });

    if (result.success) return result.response;
    if (requestAborted(request, requestSignal) || result.status === 499) return result.response;
    if (result.quotaCapacityUnavailable) {
      // A local atomic-capacity race is not provider evidence. Release/expiry is
      // owned by the lifecycle; exclude this account and try a sibling without
      // writing a synthetic 429 or breaker state.
      excludeConnectionIds.add(credentials.connectionId);
      lastError = "Provider quota capacity unavailable";
      lastStatus = HTTP_STATUS.SERVICE_UNAVAILABLE;
      continue;
    }

    // Mark account unavailable (auto-calculates cooldown with exponential backoff, or precise resetsAtMs)
    const resultAttemptStartedAt = Number.isSafeInteger(result.attemptStartedAt) && result.attemptStartedAt > 0
      ? result.attemptStartedAt
      : latestAttemptStartedAt;
    const fallbackState = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, result.resetsAtMs, {
      attemptStartedAt: resultAttemptStartedAt,
      rateLimitEvidence: result.rateLimitEvidence || null,
      signal: requestSignal,
    });
    const { shouldFallback } = fallbackState;

    if (shouldFallback) {
      attemptedBlockers.set(credentials.connectionId, {
        status: Number(result.status) || 503,
        retryAt: fallbackState.retryAt || null,
        retryAtKnown: fallbackState.retryAtKnown !== false,
      });
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionId.slice(0, 8)} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
