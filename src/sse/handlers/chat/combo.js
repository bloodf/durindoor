import { getSettings } from "@/lib/localDb";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { mergeComboRouting } from "open-sse/services/comboRoutingPolicy.js";
import { isProviderConnectionModelLocked, providerAllowsPublicNoAuthFallback } from "../../services/auth.js";
import { getAutoModelCandidates } from "../../services/autoModel.js";
import { scopeAutoComboModels } from "../../services/autoComboScope.js";
import { appendComboPrompt } from "open-sse/rtk/comboPrompt.js";
import { getProviderConnections, getQuotaReservationPressure, getComboForModel } from "@/lib/localDb";
import { getModelInfo, getComboModels, getComboCanonicalName, loadCustomCapabilities, parseModel } from "../../services/model.js";
import { resolveDecisionBackend } from "../../services/decisionBackend.js";
import { recordTokenSaverEvent } from "@/lib/usageDb";
import { isAutoComboId } from "open-sse/services/autoComboResolver.js";
import { runWithTransientBackendRetry } from "open-sse/services/transientBackendRetry.js";
import { getComboModelQuotaHealth, handleComboChat, handleFusionChat } from "open-sse/services/combo.js";
import { getComboRoutingPolicy } from "open-sse/services/comboRoutingPolicy.js";
import { COMBO_MODEL_TIMEOUT_MS } from "open-sse/config/runtimeConfig.js";
import * as log from "../../utils/logger.js";
import { getModelQuotaFamily, getDispatchUpstreamModelId, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { rankQuotaConnections } from "@/shared/services/quotaSelection";
import { buildQuotaResourceKeys, inspectProviderQuota } from "@/shared/services/providerQuotaPreflight";
import { quotaDecisionDiagnostic, rankQuotaCandidates } from "open-sse/services/quota/scoring.js";
import { combineAbortSignals } from "./shared.js";
import { handleSingleModelChat } from "./singleModel.js";

/**
 * Per-combo `timeoutMs` wins, including 0 (no combo timer). A nullish value
 * uses `COMBO_MODEL_TIMEOUT_MS`, which is itself 0 when that default is off.
 * @param {number|null|undefined} perComboTimeoutMs
 * @param {number|null|undefined} [envDefaultMs]
 * @returns {number}
 */
export function resolveComboModelTimeoutMs(perComboTimeoutMs, envDefaultMs = COMBO_MODEL_TIMEOUT_MS) {
  return perComboTimeoutMs ?? envDefaultMs ?? 0;
}

const resolveQuotaModelInfo = getModelInfo;

function leastHealthy(...states) {
  const rank = { unhealthy: 0, open: 0, degraded: 1, "half-open": 1, healthy: 2, closed: 2 };
  return states.filter(Boolean).sort((left, right) => (rank[left] ?? 2) - (rank[right] ?? 2))[0] || "healthy";
}

// Read live per-connection locks on every request. A model is unavailable only
// when every eligible credential is locked; no shared model cooldown is stored.
export async function rankComboModelsByLocks(models, now = Date.now(), dependencies = {}, comboRouting = null) {
  const resolveModel = dependencies.getModelInfo || resolveQuotaModelInfo;
  const loadConnections = dependencies.getProviderConnections || getProviderConnections;
  const isLocked = dependencies.isProviderConnectionModelLocked || isProviderConnectionModelLocked;
  const allowsPublic = dependencies.providerAllowsPublicNoAuthFallback || providerAllowsPublicNoAuthFallback;
  const availability = await Promise.all(models.map(async (value) => {
    const { provider, model } = await resolveModel(value);
    if (!provider) return { value, locked: false };
    const all = await loadConnections({ provider, isActive: true });
    const restricted = comboRouting?.restrictionApplied === true;
    const connections = restricted ? all.filter((connection) => comboRouting.allowedConnectionIds?.includes(connection.id)) : all;
    const locked = connections.length > 0 && connections.every((connection) => isLocked(connection, provider, model, now));
    return { value, locked: locked && (restricted || !allowsPublic(provider)) };
  }));
  return [...availability.filter((entry) => !entry.locked), ...availability.filter((entry) => entry.locked)].map((entry) => entry.value);
}

export async function rankComboModelsByQuota(
models,
settings,
now = Date.now(),
comboName = null,
comboStrategy = "fallback",
dependencies = {},
comboRouting = null,
body = null)
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
      // Key quota by the tier row chatCore will actually dispatch.
      const upstreamModel = getDispatchUpstreamModelId(providerAlias, model, body, settings?.providerThinking?.[provider]);
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

export async function dispatchChat({ body, modelStr, settings, request, apiKeyAuth, apiKey, clientRawRequest, planRequest, authenticatedKeyRecord, billingEpoch, finishChat }) {
  // single-model requests. Denied requests no longer trigger DB lookups.

  // Check if model is a combo (has multiple models with fallback)
  // #6495 / F-4: filter paid members when the toggle is on. The auth ACL check
  // above intentionally calls getComboModels without the flag so combo
  // existence/ACL still see the real, unfiltered member list.
  // auto/<family> pools are narrowed to the key's connection allowlist (c40aaac6).
  const savedComboModels = await scopeAutoComboModels(
    modelStr,
    await getComboModels(modelStr, settings.hidePaidModels === true, settings),
    apiKeyAuth.apiKeyId
  );
  const selector = savedComboModels ? null : await getAutoModelCandidates(modelStr, "llm", request, apiKeyAuth.apiKeyId);
  const comboModels = savedComboModels || selector?.models;
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global. Auto-combo
    // ids (`auto/<family>`) honor the F-2 `comboStrategies[modelStr].strategy`
    // shape; named combos keep the legacy `.fallbackStrategy`. Auto IDs fall
    // through to `.fallbackStrategy` when `.strategy` is absent so partial config
    // still works. A stray `.strategy` on a named-combo config never changes
    // legacy behavior.
    const comboName = (await getComboCanonicalName(modelStr)) || modelStr;
    const comboMembers = (await getComboForModel(comboName))?.members || [];
    const comboVisited = new Set([comboName]);
    // #747: resolve the combo's allow-list once per top-level request. Every
    // attempt / fallback inside the same logical request shares this policy.
    const comboRouting = await getComboRoutingPolicy(comboName);
    const comboStrategies = settings.comboStrategies || {};
    const perCombo = comboStrategies[comboName] || {};
    const comboPrompts = appendComboPrompt([], settings.comboPrompts, comboName);
    const comboSpecificStrategy = isAutoComboId(modelStr) ?
    perCombo.strategy ?? perCombo.fallbackStrategy :
    perCombo.fallbackStrategy;
    const comboStrategy = selector ? "fallback" : comboSpecificStrategy || settings.comboStrategy || "fallback";

    // Combo names are intentionally excluded from the model allowlist; the allowlist
    // is enforced against each concrete underlying model during expansion. Combo-level
    // combo access control above remains the gate for combo names.
    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${comboName}" with ${comboModels.length} models (strategy: fusion)`);
      const capabilitiesMap = await resolveComboCapabilitiesMap([...comboModels, perCombo.judgeModel].filter(Boolean));
      return finishChat(handleFusionChat({
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
            { dispatchNestedCombo, settings, planRequest, allowVisionBridge: false, apiKeyName: authenticatedKeyRecord?.name || (apiKey ? "Unknown API Key" : "Local (No API Key)"), apiKeyId: apiKeyAuth.apiKeyId, billingEpoch, comboRouting, comboPrompts, comboVisited, reportComboPolicyRejections: true }
          );
        },
        log,
        comboName,
        judgeModel: perCombo.judgeModel,
        tuning: perCombo.fusionTuning,
        autoSwitch: true,
        contextRequirements: perCombo.contextRequirements,
        capabilitiesMap
      }));
    }

    const capabilitiesMap = await resolveComboCapabilitiesMap(comboModels);
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    const comboTimeoutMs = resolveComboModelTimeoutMs(perCombo?.timeoutMs);
    log.info("CHAT", `Combo "${comboName}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit}, timeout: ${comboTimeoutMs || "off"})`);
    // #2562: combo fallback must persist ONE token-saver row for the whole
    // logical request, not one per fallback attempt. Collect the latest event
    // across attempts and persist after handleComboChat returns.
    const tokenSaverCollector = { latest: null };
    const comboResult = await handleComboChat({
      apiKeyId: apiKeyAuth.apiKeyId,
      body,
      models: comboModels,
      handleSingleModel: (b, m, attemptSignal, attemptOptions) => {
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
          { dispatchNestedCombo, settings, planRequest, allowVisionBridge: false, apiKeyName: authenticatedKeyRecord?.name || (apiKey ? "Unknown API Key" : "Local (No API Key)"), apiKeyId: apiKeyAuth.apiKeyId, billingEpoch, comboRouting, comboPrompts, comboVisited, reportComboPolicyRejections: attemptOptions?.reportComboPolicyRejections }
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
        comboRouting,
        body
      ),
      lockRanker: (ordered) => rankComboModelsByLocks(ordered, Date.now(), {}, comboRouting),
      jevClassify: true,
      decisionBackend: resolveDecisionBackend,
      signal: request?.signal || null
    });
    // One row per logical combo request (collector holds only the latest
    // attempt's event) — never one per fallback attempt (Codex P2 on #306).
    if (tokenSaverCollector.latest) {
      try {await recordTokenSaverEvent(tokenSaverCollector.latest);} catch {/* telemetry must not break requests */}
    }
    return finishChat(comboResult);
  }

  // Single model request. Wrapped with a bounded jittered retry on transient
  // 502/503/504 backend errors (#13143 upstream) — the combo loop above has
  // its own cooldown/fallback handling already, so this only covers the
  // direct, non-combo path. Retries only ever see a non-ok error response
  // constructed before any bytes reach the client, so re-running cannot
  // double-send a stream.
  return finishChat(runWithTransientBackendRetry(
    () =>
      handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, null, null, {
        dispatchNestedCombo,
        settings,
        planRequest,
        allowVisionBridge: true,
        apiKeyName: authenticatedKeyRecord?.name || (apiKey ? "Unknown API Key" : "Local (No API Key)"),
        apiKeyId: apiKeyAuth.apiKeyId,
        billingEpoch,
      }),
    { signal: request?.signal || undefined, source: "single-model" }
  ));
}

// Expand nested combo requests through the same account dispatch boundary.
export async function dispatchNestedCombo({ body, modelStr, clientRawRequest, request, apiKey, tokenSaverCollector, requestSignal, comboRouting, comboPrompts, comboVisited, planRequest, apiKeyName, apiKeyId, billingEpoch, reportComboPolicyRejections }) {
    const chatSettings = await getSettings();
    // #6495 / F-4: filter paid members when the toggle is on.
    const comboModels = await scopeAutoComboModels(
      modelStr,
      await getComboModels(modelStr, chatSettings.hidePaidModels === true, chatSettings),
      apiKeyId
    );
    if (comboModels) {
      // Resolve the canonical persisted name once so ACL, per-combo strategy
      // lookups, and rotation/scoring keys are stable regardless of the
      // casing the client sent (#10177). Auto-combo ids pass through as-is.
      const comboName = (await getComboCanonicalName(modelStr)) || modelStr;
      // Bound imported cycles and long acyclic chains; each branch owns its path.
      if (comboVisited.has(comboName) || comboVisited.size >= 16) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, "Combo cycle or nesting limit exceeded");
      }
      const nestedVisited = new Set([...comboVisited, comboName]);
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
      const nestedPrompts = appendComboPrompt(comboPrompts, chatSettings.comboPrompts, comboName);
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
              { dispatchNestedCombo, settings: chatSettings, planRequest, allowVisionBridge: false, apiKeyName, apiKeyId, billingEpoch, comboRouting: mergedRouting, comboPrompts: nestedPrompts, comboVisited: nestedVisited, reportComboPolicyRejections: true }
            );
          },
          log,
          comboName,
          judgeModel: perCombo.judgeModel,
          tuning: perCombo.fusionTuning,
          autoSwitch: true,
          contextRequirements: perCombo.contextRequirements,
          capabilitiesMap: await resolveComboCapabilitiesMap([...comboModels, perCombo.judgeModel].filter(Boolean))
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      const comboTimeoutMs = resolveComboModelTimeoutMs(perCombo?.timeoutMs);
      log.info("CHAT", `Combo "${comboName}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit}, timeout: ${comboTimeoutMs || "off"})`);
      // Nested combos inherit the parent's collector if present; otherwise own
      // it so nested fallback attempts do not double-count rows.
      const ownsCollector = !tokenSaverCollector;
      const nestedCollector = tokenSaverCollector || { latest: null };
      const nestedCapabilitiesMap = await resolveComboCapabilitiesMap(comboModels);
      const nestedResult = await handleComboChat({
        apiKeyId,
        body,
        models: comboModels,
        handleSingleModel: (b, m, attemptSignal, attemptOptions) => {
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
            { dispatchNestedCombo, settings: chatSettings, planRequest, allowVisionBridge: false, apiKeyName, apiKeyId, billingEpoch, comboRouting: mergedRouting, comboPrompts: nestedPrompts, comboVisited: nestedVisited, reportComboPolicyRejections: reportComboPolicyRejections || attemptOptions?.reportComboPolicyRejections }
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
          mergedRouting,
          body
        ),
        lockRanker: (ordered) => rankComboModelsByLocks(ordered, Date.now(), {}, mergedRouting),
        jevClassify: true,
        decisionBackend: resolveDecisionBackend,
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
