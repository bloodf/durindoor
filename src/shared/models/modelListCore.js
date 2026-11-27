import { getThinkingLevelsFromCapabilities } from "open-sse/providers/thinkingLevels.js";
import { KIMI_CODING_MODELS_URL } from "../../../open-sse/providers/shared.js";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { AI_PROVIDERS, getProviderAlias, isAnthropicCompatibleProvider, isOpenAICompatibleProvider, resolveProviderId } from "@/shared/constants/providers";
import { getProviderConnections, getCombos, getCustomModels, getModelAliases, getSyncedModelCatalogs } from "@/lib/localDb";
import { catalogEntryForConnection, effectiveSyncedModels, isConnectionScopedSyncProvider, isModelAutoSyncEnabled, materializeSyncedModel } from "@/lib/modelAutoSync/catalog.js";
import { getSharedModelMetadata } from "@/lib/modelAutoSync/sharedMetadata.js";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getEnabledModels } from "@/lib/enabledModelsDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { isFreeNoAuthProviderDisabled } from "@/sse/services/freeProviderGate.js";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { PROVIDERS } from "open-sse/config/providers.js";
import { getAzureDeploymentPool } from "open-sse/providers/azureDeployment.js";
import { isLegacyOllamaEmbeddingModel } from "open-sse/services/ollamaCatalog.js";
import { resolveLiveOpenAIModels } from "open-sse/services/liveModelLimits.js";
import { aggregateComboCapabilities, capabilitiesFromServiceKind, enforceCursorCapabilities, getCapabilitiesForModel, overlayComboCapabilities, resolveModelLimits } from "open-sse/providers/capabilities.js";
import { isPaidModel } from "open-sse/providers/pricing.js";
import { getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { projectModelPresentation } from "open-sse/providers/models/presentation.js";
import { resolveChatgptPlanAccess } from "@/sse/services/chatgptPlanAccess.js";
import { listChatgptPlanModels } from "open-sse/providers/chatgpt-plan/index.js";
import { isFunction, isObject, isString } from "../utils/typeChecks.js";
import { isModelExposureAllowed } from "../utils/modelExposureList.js";
import { isRecord, KIMI_LIVE_MODEL_PROVIDERS, LIVE_MODEL_UNION_PROVIDERS, LIVE_MODEL_RESOLVERS, normalizeKimiPlatformModel, OPENAI_MODELS_FETCHER_TYPES, fetchLocalPassthroughModels, resolveProviderMediaCatalog, PROVIDER_MEDIA_CATALOGS } from "./modelCatalogSources.js";
import { LLM_KIND, modelKind, inferKindFromUnknownModelId, customModelKind, getCompatiblePublicIds, providerMatchesKinds } from "./modelListKinds.js";
import { comboMatchesKinds, comboToEntry, visibleComboMembers, buildComboOnlyModels } from "./modelListCombos.js";
import { withCatalogDeadline } from "./catalogDeadline.js";
import { isEffortSuffixedVariantOfListedId } from "../utils/effortSuffixedId.js";

const modelsInFlight = new Map();

function kindFilterKey(kindFilter) {
  return Array.isArray(kindFilter) ? kindFilter.slice().sort().join("\0") : "";
}

async function buildModelsListImpl(kindFilter, guard, options = {}) {
  let settings = null;
  let hidePaidModels = false;
  let exposeComboOnly = false;
  try {
    settings = await getSettings();
    hidePaidModels = settings?.hidePaidModels === true;
    exposeComboOnly = options.exposeComboOnly ?? (settings?.exposeComboOnly === true);
  } catch (e) {
    hidePaidModels = false;
    exposeComboOnly = false;
  }

  // Combo-only exposure is local state. Skip the provider aggregation entirely
  // (no live network probes, no per-provider network) so picker calls do not
  // amplify into upstream fetches.
  if (exposeComboOnly) return buildComboOnlyModels(kindFilter, hidePaidModels);

  // Settings decide whether provider aggregation is needed. Combo-only mode
  // returns above without touching connections or live discovery.
  const connectionsPromise = getProviderConnections();

  const isFreeNoAuthDisabled = (providerId) =>
  isFreeNoAuthProviderDisabled(providerId, settings);

  let dbAvailable = true;
  let connections = [];
  try {
    connections = await connectionsPromise;
    connections = connections.filter((c) => c.isActive !== false);
  } catch (e) {
    dbAvailable = false;
    console.log("Could not fetch providers, returning all models");
  }

  let combos = [];
  try {
    combos = (await getCombos()).filter((c) => c !== null);
  } catch (e) {
    console.log("Could not fetch combos");
  }

  const comboByName = Object.fromEntries(combos.map((combo) => [combo.name, combo.models || []]));

  // decolua/9router#3429: combo-only exposure short-circuits above, so by the
  // time we reach this point the caller wants the full direct+paid catalog.
  let customModels = [];
  try {
    customModels = await getCustomModels();
  } catch (e) {
    console.log("Could not fetch custom models");
  }
  let systemoneNodes = [];
  try {
    const { getProviderNodes } = await import("@/lib/localDb");
    if (isFunction(getProviderNodes)) systemoneNodes = await getProviderNodes({ type: "systemone-compatible" });
  } catch (e) {
    console.log("Could not fetch System One provider nodes");
  }
  const systemoneNodeAliases = new Set(systemoneNodes.flatMap((node) => [node.id, node.prefix]).filter(isString));

  let modelAliases = {};
  try {
    modelAliases = await getModelAliases();
  } catch (e) {
    console.log("Could not fetch model aliases");
  }

  const sharedMetadata = await getSharedModelMetadata().catch(() => null);
  let disabledByAlias = {};
  try {
    disabledByAlias = await getDisabledModels();
  } catch (e) {
    console.log("Could not fetch disabled models");
  }

  const isDisabled = (alias, modelId) => Array.isArray(disabledByAlias[alias]) && (disabledByAlias[alias] ?? []).includes(modelId);
  // Check disabled entries across output prefix, static alias, provider id, and
  // dashboard storage alias so models stay hidden regardless of which key wrote them (#4073).
  const isModelDisabled = (modelId, ...keys) => keys.some((key) => key && isDisabled(key, modelId));

  // Unlike the other optional lookups above, a failed read here cannot fail
  // soft: an empty map means "no provider is restricted", so silently
  // swallowing the error would serve a provider's full catalog on a request
  // that should have been allowlist-restricted. Let the caller's route
  // handler turn this into a 500 instead.
  const enabledByAlias = await getEnabledModels();

  // Visible-model allowlist for one provider. The provider page writes it per
  // alias (`/api/models/enabled`); a hand-set
  // `providerSpecificData.enabledModels` still wins only when the provider-level
  // allowlist is absent. Returns [] when the provider is unrestricted.
  //
  // This is what makes "only these models are visible" work for providers with a
  // live catalog (github/kiro/qoder/...): their registry list lags upstream, so a
  // blacklist can never name the catalog-only ids, only an allowlist can.
  const resolveEnabledModels = (providerId, conn) => {
    const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] ?? providerId;
    const psd = isRecord(conn?.providerSpecificData) ? conn.providerSpecificData : {};

    // The dashboard writes the allowlist under the provider's storage alias
    // (getProviderAlias: uiAlias || alias, or the provider id for compatible
    // providers; e.g. DeepSeek stores under `ds`, not registry `deepseek`) — never
    // under a connection's custom output prefix. Checking the output prefix
    // first let a custom prefix that collided with another provider's static
    // alias pull that other provider's allowlist. Keep the prefix out of the
    // lookup key entirely.
    const candidates = [
      enabledByAlias[getProviderAlias(providerId)],
      enabledByAlias[staticAlias],
      enabledByAlias[providerId],
      psd.enabledModels,
    ];

    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) continue;
      const ids = Array.from(
        new Set(candidate.filter((id) => isString(id) && id.trim() !== ""))
      );
      if (ids.length > 0) return ids;
    }
    return [];
  };

  // Same storage-key rule for the static and keyless readers, whose `alias`
  // is the registry alias (the output prefix), not the dashboard key.
  const storedAllowlist = (providerId, alias) =>
    [getProviderAlias(providerId), alias, providerId].map((key) => enabledByAlias[key]).find((v) => Array.isArray(v) && v.length > 0);

  // Providers whose catalogs belong to one endpoint (including MLX, OpenCode Server and Grokified) are
  // listed from the connection the caller may use: for a key scoped to provider
  // accounts, the first active connection in that scope, and none when the
  // scope holds no connection of the provider. Other providers are unaffected.
  const scopedConnectionIds = Array.isArray(options.allowedConnectionIds) && options.allowedConnectionIds.length > 0 ?
  new Set(options.allowedConnectionIds) : null;
  const activeConnectionByProvider = new Map();
  for (const conn of connections) {
    if (scopedConnectionIds && isConnectionScopedSyncProvider(conn.provider) && !scopedConnectionIds.has(conn.id)) continue;
    if (!activeConnectionByProvider.has(conn.provider)) {
      activeConnectionByProvider.set(conn.provider, conn);
    }
  }
  const activeConnectionEntries = Array.from(activeConnectionByProvider.entries());
  // Multiple local endpoints require model-service connection-prefix routing.
  // Until that contract exists, preserve first active connection semantics.

  // Model auto-sync (src/lib/modelAutoSync): a provider with auto-sync on and
  // a successful synced catalog lists exactly that catalog instead of its
  // registry defaults. Read only when such a provider is connected; a failed
  // read fails soft to registry behavior.
  let syncedCatalogs = {};
  if ([...activeConnectionByProvider.keys()].some((id) => isModelAutoSyncEnabled(id, settings))) {
    try {
      syncedCatalogs = await getSyncedModelCatalogs();
    } catch {
      syncedCatalogs = {};
    }
  }

  const models = [];
  const privatePlanModels = new WeakSet();
  // Model ids below are prefixed with outputAlias (static alias or the active
  // connection's custom prefix), so map each exposed alias back to the
  // provider id — needed for combo capability aggregation on ids like
  // `mykr/<model>` whose prefix is not a registered provider alias.
  const aliasToProviderId = Object.fromEntries(
    Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
  );
  // Overlay active connections so custom prefixes (providerSpecificData.prefix)
  // and the provider's static alias both map back to the provider id. Saved combos
  // may still reference the static alias even after a prefix is configured, and
  // the no-connection fallback catalog also needs the static alias map.
  for (const [providerId, conn] of activeConnectionByProvider) {
    const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] ?? providerId;
    const prefix = isRecord(conn.providerSpecificData) ? conn.providerSpecificData.prefix : undefined;
    const outputAlias = (
    (isString(prefix) ? prefix : undefined) ||
    getProviderAlias(providerId) ||
    staticAlias).
    trim();
    aliasToProviderId[outputAlias] = providerId;
    aliasToProviderId[staticAlias] = providerId;
    aliasToProviderId[providerId] = providerId;
  }

  const compatibleStorageAliases = new Set();
  for (const [providerId, conn] of activeConnectionByProvider) {
    if (!isOpenAICompatibleProvider(providerId) && !isAnthropicCompatibleProvider(providerId)) continue;
    const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] ?? providerId;
    const prefix = isRecord(conn.providerSpecificData) ? conn.providerSpecificData.prefix : undefined;
    const outputAlias = ((isString(prefix) ? prefix : undefined) || getProviderAlias(providerId) || staticAlias).trim();
    compatibleStorageAliases.add(providerId);
    compatibleStorageAliases.add(staticAlias);
    compatibleStorageAliases.add(outputAlias);
  }

  const attachModelLimits = (model, providerId, modelId, explicitCaps = {}, liveLimits = null) => {
    // #3218: expose proven limits in OpenAI's flat model schema. Generic
    // default capabilities are not evidence of a provider guarantee. Live
    // metadata is injected by this server-only builder so capabilities.js
    // remains safe for dashboard client bundles.
    const positive = (value) => Number.isFinite(value) && value > 0;
    let contextWindow = explicitCaps.contextWindow;
    let maxOutput = explicitCaps.maxOutput;
    const explicitKeys = explicitCaps.customKeys instanceof Set ? explicitCaps.customKeys : null;
    const fallback = resolveModelLimits(providerId, modelId, explicitCaps, null, liveLimits, true);
    if (!positive(contextWindow) && fallback.known && !explicitKeys?.has("contextWindow")) contextWindow = fallback.contextWindow;
    if (!positive(maxOutput) && fallback.known && !explicitKeys?.has("maxOutput")) maxOutput = fallback.maxOutput;
    if (positive(contextWindow)) model.context_length = contextWindow;
    if (positive(maxOutput)) model.max_completion_tokens = maxOutput;
    model.capabilities = {
      ...model.capabilities,
      contextWindow: positive(contextWindow) ? contextWindow : undefined,
      maxOutput: positive(maxOutput) ? maxOutput : model.capabilities?.maxOutput === null ? null : undefined,
    };
    return model;
  };

  const addStaticProviderModels = (providerId, alias, { hasCredentials = false } = {}) => {
    if (!providerMatchesKinds(providerId, kindFilter)) return;
    const enabledModels = storedAllowlist(providerId, alias);
    const hasAllowlist = Array.isArray(enabledModels) && enabledModels.length > 0;
    for (const model of PROVIDER_MODELS[alias] ?? []) {
      if (model.routingUnavailableReason) continue;
      if (!kindFilter.includes(modelKind(model))) continue;
      if (model.requiresApiKey === true && !hasCredentials) continue;
      if (hasAllowlist && !enabledModels.includes(model.id)) continue;
      if (isModelDisabled(model.id, alias, providerId, getProviderAlias(providerId))) continue;
      if (hidePaidModels && isPaidModel(`${alias}/${model.id}`)) continue;
      const caps = getCapabilitiesForModel(providerId, model.id);
      const thinkingLevels = modelKind(model) === LLM_KIND ? getThinkingLevelsFromCapabilities(caps, providerId, model.id) : null;
      const entry = {
        id: `${alias}/${model.id}`,
        object: "model",
        owned_by: alias,
        kind: modelKind(model),
        capabilities: caps,
        ...(thinkingLevels?.length ? { thinking_levels: thinkingLevels } : null),
        ...projectModelPresentation({ model, modelId: model.id, providerId, outputAlias: alias }),
      };
      if (modelKind(model) === LLM_KIND) {
        attachModelLimits(entry, providerId, model.id);
      }
      models.push(entry);
    }
  };

  const addNoAuthProviderModels = async (providerId, alias) => {
    if (!providerMatchesKinds(providerId, kindFilter)) return;
    // A native media catalog (AI Horde images) is listed on its own; chat
    // discovery runs only when the request lists chat models.
    if (PROVIDER_MEDIA_CATALOGS[providerId]) {
      const allowlist = storedAllowlist(providerId, alias);
      const hasAllowlist = Array.isArray(allowlist) && allowlist.length > 0;
      for (const row of await resolveProviderMediaCatalog(providerId, kindFilter)) {
        if (isModelDisabled(row.id, alias, providerId, getProviderAlias(providerId))) continue;
        if (hasAllowlist && !allowlist.includes(row.id)) continue;
        if (hidePaidModels && isPaidModel(`${alias}/${row.id}`)) continue;
        models.push({
          id: `${alias}/${row.id}`,
          object: "model",
          owned_by: alias,
          kind: row.kind,
          capabilities: getCapabilitiesForModel(providerId, row.id, row.kind),
          ...projectModelPresentation({ model: row, modelId: row.id, providerId, outputAlias: alias }),
        });
      }
      if (!kindFilter.includes(LLM_KIND)) return;
    }
    const registryFetcher = AI_PROVIDERS[providerId]?.modelsFetcher;
    const transport = PROVIDERS[providerId];
    const isOpenCodeFree = providerId === "opencode" && registryFetcher?.type === "opencode-free";
    if (!registryFetcher || (!OPENAI_MODELS_FETCHER_TYPES.has(registryFetcher.type) && !isOpenCodeFree)) {
      addStaticProviderModels(providerId, alias);
      return;
    }

    const authorization = transport?.headers?.Authorization;
    const token = isString(authorization) && authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token && !isOpenCodeFree) {
      addStaticProviderModels(providerId, alias);
      return;
    }

    // Keyless catalogs honour the same visible-model allowlist as connected
    // providers: without this, a saved allowlist for a noAuth provider (e.g.
    // AI Horde) is silently ignored whenever live discovery succeeds.
    const allowlist = storedAllowlist(providerId, alias);
    const hasAllowlist = Array.isArray(allowlist) && allowlist.length > 0;

    try {
      const live = await withCatalogDeadline(["keyless", providerId, token, registryFetcher.url, guard], () => resolveLiveOpenAIModels({
        id: "noauth",
        connectionId: "noauth",
        provider: providerId,
        accessToken: token,
        providerSpecificData: {},
      }, {
        provider: providerId,
        guard,
        endpoint: registryFetcher.url,
        headers: transport.headers,
        allowNoAuth: isOpenCodeFree,
        cacheVariant: isOpenCodeFree ? "opencode-free" : undefined,
        selectModels: isOpenCodeFree ? (body) => {
          const entries = Array.isArray(body) ? body : body?.data ?? body?.models;
          return Array.isArray(entries) ? entries.filter((entry) =>
            isString(entry?.id) && entry.id !== "deepseek-v4-flash-free" && (entry.id.endsWith("-free") || entry.id === "big-pickle")
          ) : [];
        } : undefined,
      }));
      if (!live?.models?.length) {
        addStaticProviderModels(providerId, alias);
        return;
      }
      for (const liveModel of live.models) {
        const modelId = liveModel.id;
        if (!isString(modelId) || !modelId.trim() || isModelDisabled(modelId, alias, providerId, getProviderAlias(providerId))) continue;
        if (hasAllowlist && !allowlist.includes(modelId)) continue;
        if (hidePaidModels && isPaidModel(`${alias}/${modelId}`)) continue;
        const kind = liveModel.kind || liveModel.type || inferKindFromUnknownModelId(modelId);
        // A model name can suggest a kind the provider cannot serve. A kind
        // owned by a native media catalog is never taken from a chat facade name.
        if (!kindFilter.includes(kind) || !providerMatchesKinds(providerId, [kind])) continue;
        if (PROVIDER_MEDIA_CATALOGS[providerId]?.kinds.includes(kind)) continue;
        const caps = isRecord(liveModel.capabilities) ? liveModel.capabilities : getCapabilitiesForModel(providerId, modelId, kind);
        models.push({
          id: `${alias}/${modelId}`,
          object: "model",
          owned_by: alias,
          kind,
          capabilities: caps,
          ...projectModelPresentation({ model: liveModel, modelId, providerId, outputAlias: alias }),
        });
      }
    } catch {
      addStaticProviderModels(providerId, alias);
    }
  };

  // Custom-model capability overrides — one map for all combo aggregations
  // (no per-member DB reads). Keys are canonical `providerId/modelId`;
  // aggregateComboCapabilities normalizes member prefixes (static alias OR a
  // connection's custom output prefix) through aliasToProviderId before
  // lookup, so `myproxy/model` finds a row stored under the provider alias.
  const customCapsById = new Map(
    customModels.
    filter((m) => m?.id && m?.providerAlias && (m.kind || m.type || "llm") === "llm" && m?.capabilities && isObject(m.capabilities)).
    map((m) => [`${aliasToProviderId[m.providerAlias] ?? m.providerAlias}/${m.id}`, m.capabilities])
  );
  // Capability aggregation accepts model IDs only; legacy members remain
  // visibility evidence but cannot contribute capabilities. Preserve nested
  // combo ceilings in the lookup so no outer combo expands an inner cap.
  const capabilityComboByName = Object.fromEntries(
    combos.map((combo) => [combo.name, {
      models: Array.isArray(combo.models) ? combo.models.filter(isString) : [],
      capabilities: isObject(combo.capabilities) ? combo.capabilities : null
    }])
  );

  // port(upstream): decolua/9router#4627 — a seat nobody can route to must not
  // lower the limits a combo publishes. A seat is routable through an active
  // connection or an enabled keyless provider; a nested combo needs one such
  // seat. With no connections, or no routable seat, every seat still counts.
  const isRoutableSeat = (seat, seen = new Set()) => {
    if (!seat.includes("/")) {
      const nested = capabilityComboByName[seat]?.models;
      if (!nested?.length || seen.has(seat)) return true;
      return nested.some((member) => isRoutableSeat(member, new Set([...seen, seat])));
    }
    const prefix = seat.slice(0, seat.indexOf("/"));
    const providerId = aliasToProviderId[prefix] ?? resolveProviderId(prefix);
    return activeConnectionByProvider.has(providerId) ||
      AI_PROVIDERS[providerId]?.noAuth === true && !isFreeNoAuthDisabled(providerId);
  };
  const routableSeats = (seats) => {
    if (activeConnectionByProvider.size === 0) return seats;
    const routable = seats.filter((seat) => isRoutableSeat(seat));
    return routable.length ? routable : seats;
  };
  const limitComboByName = Object.fromEntries(
    Object.entries(capabilityComboByName).map(([name, combo]) => [name, { ...combo, models: routableSeats(combo.models) }])
  );

  // Combos first (filtered by kind). Web combos expose `kind` so AI knows search vs fetch.
  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter)) continue;
    // #6495 / F-4: filter combo pools to free/unknown members when the toggle
    // is on; omit combos whose members are all paid. Resolves nested combo
    // names via comboByName with a visited set so cyclic/deeper combos can't
    // loop or leak all-paid pools. Persisted combo objects are untouched.
    const visibleMembers = visibleComboMembers(combo, comboByName, hidePaidModels);
    if (hidePaidModels && visibleMembers.length === 0) continue;
    const entry = comboToEntry(combo);
    if (entry.kind !== "webSearch" && entry.kind !== "webFetch") {
      const members = visibleMembers.filter(isString);
      const memberCaps = aggregateComboCapabilities(members, capabilityComboByName, aliasToProviderId, 0, customCapsById);
      if (memberCaps) {
        const { contextWindow, maxOutput } = aggregateComboCapabilities(routableSeats(members), limitComboByName, aliasToProviderId, 0, customCapsById);
        const comboCaps = { ...memberCaps, contextWindow, maxOutput };
        const explicitCap = isObject(combo.capabilities) ? combo.capabilities : null;
        const finalCaps = explicitCap ? overlayComboCapabilities(comboCaps, explicitCap) : comboCaps;
        if (finalCaps) {
          entry.capabilities = finalCaps;
          /**
           * Expose the same proven flat token limits as individual LLM models.
           * Combo aggregation already applies member-safe minima and resolves
           * nested combos, static aliases, and custom connection prefixes.
           * The explicit operator cap is the member-safe-minimum overlay and
           * never enables a capability the derivation would not already allow.
           */
          if ((combo.kind ?? LLM_KIND) === LLM_KIND) {
            attachModelLimits(entry, null, combo.name, {
              ...finalCaps,
              customKeys: new Set(["contextWindow", "maxOutput"])
            });
          }
        }
      }
    }
    models.push(entry);
  }

  // Resolve cached rosters once. Custom rows win first-wins dedup below, so
  // they must inherit the same scoped metadata before operator fields apply.
  // Shared metadata only enriches these existing IDs; it never adds models.
  const syncedModelsByProvider = new Map();
  const inheritedCustomModelsByProvider = new Map();
  for (const [providerId, conn] of activeConnectionEntries) {
    if (isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId) ||
      !isModelAutoSyncEnabled(providerId, settings)) continue;
    const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] ?? providerId;
    const syncedModels = effectiveSyncedModels(
      catalogEntryForConnection(syncedCatalogs, providerId, conn), PROVIDER_MODELS[staticAlias] ?? [], providerId, sharedMetadata
    );
    syncedModelsByProvider.set(providerId, syncedModels);
    if (syncedModels) {
      inheritedCustomModelsByProvider.set(providerId, new Map(
        syncedModels.map((model) => [`${modelKind(model)}\0${model.id}`, model])
      ));
    }
  }

  for (const customModel of customModels) {
    const kind = customModelKind(customModel, systemoneNodeAliases.has(customModel.providerAlias) ? "systemone" : LLM_KIND);
    if (!customModel.id || !kindFilter.includes(kind)) continue;
    const providerAlias = customModel.providerAlias;
    if (!providerAlias) continue;
    if (compatibleStorageAliases.has(providerAlias)) continue;

    const modelId = String(customModel.id).trim();
    if (!modelId) continue;

    const providerId = aliasToProviderId[providerAlias] ?? providerAlias;
    if (providerId === "chatgpt-plan") continue;
    const inherited = inheritedCustomModelsByProvider.get(providerId)?.get(`${kind}\0${modelId}`) ||
      materializeSyncedModel(providerId, { id: modelId, kind }, sharedMetadata);
    const inheritedCaps = inherited.capabilities;
    // Only chat rows use ID-based compatibility floors. Media declarations
    // already come from kind-scoped materialization, not a chat namesake.
    const staticCaps = kind === LLM_KIND ? getCapabilitiesForModel(providerId, modelId) : capabilitiesFromServiceKind(kind);
    const customCaps = isRecord(customModel.capabilities) ? { ...customModel.capabilities } : {};
    const customKeys = new Set(Object.keys(customCaps));
    Object.defineProperty(customCaps, "customKeys", { value: customKeys, enumerable: false });
    const entry = {
      id: `${providerAlias}/${modelId}`,
      object: "model",
      owned_by: providerAlias,
      capabilities: {
        ...staticCaps,
        ...inheritedCaps,
        // Runtime compatibility floors are not discovered token budgets.
        contextWindow: inheritedCaps.contextWindow,
        maxOutput: inheritedCaps.maxOutput,
        maxInput: inheritedCaps.maxInput,
        defaultOutput: inheritedCaps.defaultOutput,
        ...customCaps,
      },
      ...projectModelPresentation({
        model: { ...inherited, ...customModel }, modelId, providerId, outputAlias: providerAlias,
      }),
      kind,
    };
    if (kind === LLM_KIND) attachModelLimits(entry, providerId, modelId, customCaps, inheritedCaps);
    Object.defineProperty(entry.capabilities, "customKeys", { value: customKeys, enumerable: false });
    models.push(entry);
  }

  if (!dbAvailable) {
    for (const alias of Object.keys(PROVIDER_MODELS)) {
      const providerId = aliasToProviderId[alias] ?? alias;
      if (isFreeNoAuthDisabled(providerId)) continue;
      addStaticProviderModels(providerId, alias);
    }
  } else {
    const providerResults = await Promise.all(
      activeConnectionEntries.map(async ([providerId, conn]) => {
        // Private catalogs are fetched separately after checking the caller's scope.
        if (providerId === "chatgpt-plan") return [];
        if (!providerMatchesKinds(providerId, kindFilter)) return [];
        if (isFreeNoAuthDisabled(providerId)) return [];

        const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] ?? providerId;
        const prefix = isRecord(conn.providerSpecificData) ? conn.providerSpecificData.prefix : undefined;
        const outputAlias = (
        (isString(prefix) ? prefix : undefined) ||
        getProviderAlias(providerId) ||
        staticAlias).
        trim();
        let providerModels = PROVIDER_MODELS[staticAlias] ?? [];
        /** Project Vertex's declared transcription kind before ID lookup deduplication.
         * Chat and mixed requests keep the canonical chat row for shared IDs.
         */
        if (providerId === "vertex" && kindFilter.includes("stt") && !kindFilter.includes(LLM_KIND)) {
          const transcriptionModels = new Map(
            (AI_PROVIDERS[providerId]?.sttConfig?.models ?? []).map((model) => [model.id, model])
          );
          providerModels = providerModels.map((model) => transcriptionModels.has(model.id)
            ? { ...model, ...transcriptionModels.get(model.id), kind: "stt" }
            : model);
        }
        let enabledModels = resolveEnabledModels(providerId, conn);
        // An explicit provider-level allowlist restricts what this provider may
        // publish, even when the intersection ends up empty. Only Azure needs the
        // flag today; other providers keep the plain "list is non-empty" rule.
        let hasProviderAllowlist = false;
        if (providerId === "azure") {
          // port(upstream): decolua/9router#5901 — Azure deployment pools publish one
          // model per deployment, and only the connections inside the caller's
          // scope may contribute: a key scoped to one pool must never see another
          // pool's deployments. A provider-level allowlist restricts those
          // deployments; it never adds to them.
          const scopedAzureConnections = connections.filter(
            (connection) => connection.provider === providerId &&
              (!scopedConnectionIds || scopedConnectionIds.has(connection.id))
          );
          const pooledModels = [];
          const servedModels = [];
          for (const connection of scopedAzureConnections) {
            const pool = getAzureDeploymentPool(connection.providerSpecificData);
            if (pool.length > 0) {
              pooledModels.push(...pool);
              continue;
            }
            // Legacy single-deployment connections name the models they serve.
            const own = connection.providerSpecificData?.enabledModels;
            if (Array.isArray(own)) {
              servedModels.push(...own.filter((id) => isString(id) && id.trim() !== ""));
            }
          }
          const providerAllowlist = storedAllowlist(providerId, staticAlias) || [];
          hasProviderAllowlist = providerAllowlist.length > 0;
          if (pooledModels.length > 0) {
            const candidates = Array.from(new Set([...pooledModels, ...servedModels]));
            enabledModels = hasProviderAllowlist
              ? candidates.filter((modelId) => providerAllowlist.includes(modelId))
              : candidates;
          } else {
            // No pool in scope: legacy connections keep their own allowlist, read
            // only from a connection inside the caller's scope.
            enabledModels = scopedAzureConnections.length > 0
              ? resolveEnabledModels(providerId, scopedAzureConnections[0])
              : [];
          }
        }
        const hasExplicitEnabledModels = enabledModels.length > 0 || hasProviderAllowlist;
        const isCompatibleProvider =
        isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
        const liveModelKindById = new Map();
        const liveCapabilitiesById = new Map();
        const liveModelIds = new Set();
        const liveModelById = new Map();

        // Build kind lookup for static models so we can filter even when only IDs are exposed
        // One id may serve several media kinds (Haiper `gen2` is an image and a
        // video row); it is listed under the kind this request asks for.
        const staticModelKindById = new Map();
        for (const m of providerModels) {
          const kind = modelKind(m);
          const known = staticModelKindById.get(m.id);
          if (known === undefined || !kindFilter.includes(known) && kindFilter.includes(kind)) staticModelKindById.set(m.id, kind);
        }
        const staticModelById = new Map(providerModels.map((m) => [m.id, m]));
        const hasUsableCredential = conn.id !== "noauth" && [conn.apiKey, conn.accessToken].
        some((value) => isString(value) &&
        value.trim() !== "" &&
        value !== "public" &&
        value !== "sk_durindoor");
        let rawModelIds = isCompatibleProvider ? [] : hasExplicitEnabledModels ?
        Array.from(
          new Set(
            enabledModels.filter(
              (modelId) => isString(modelId) && modelId.trim() !== ""
            )
          )
        ) :
        providerModels.map((model) => model.id);

        const customModelKindById = new Map();
        const customCapabilitiesById = new Map();
        const customModelById = new Map();
        const customModelIds = customModels.
        filter((m) => {
          if (!m.id) return false;
          const kind = customModelKind(m);
          // imageToText custom models are vision-capable chat models: expose them
          // both in the default LLM list and in /v1/models/image-to-text.
          if (!kindFilter.includes(kind) && !(kind === "imageToText" && kindFilter.includes(LLM_KIND))) return false;
          const alias = m.providerAlias;
          return alias === staticAlias || alias === outputAlias || alias === providerId;
        }).
        map((m) => {
          const modelId = String(m.id).trim();
          const kind = customModelKind(m);
          if (modelId) {
            customModelById.set(modelId, m);
            customModelKindById.set(modelId, kind);
            if (isRecord(m.capabilities)) customCapabilitiesById.set(modelId, m.capabilities);
          }
          return modelId;
        }).
        filter((modelId) => modelId !== "");

        // Auto-synced providers publish exactly the synced list (plus custom
        // models below). The allowlist still narrows it, and the synced rows
        // stand in for live metadata, so no per-request discovery runs.
        const syncedModels = syncedModelsByProvider.get(providerId) ?? null;
        const syncedModelIds = syncedModels ? new Set(syncedModels.map((m) => m.id)) : null;
        if (syncedModels) {
          rawModelIds = hasExplicitEnabledModels ?
          rawModelIds.filter((id) => syncedModelIds.has(id)) :
          [...syncedModelIds];
          for (const m of syncedModels) {
            liveModelById.set(m.id, m);
            liveModelIds.add(m.id);
            if (m.kind) liveModelKindById.set(m.id, m.kind);
            if (isRecord(m.capabilities)) liveCapabilitiesById.set(m.id, m.capabilities);
          }
        }

        // Live metadata precedence is user override > live upstream > static
        // catalog > default. Compatible catalogs merge live and saved IDs.
        const providerLiveResolver = isCompatibleProvider ? LIVE_MODEL_RESOLVERS.compatible : LIVE_MODEL_RESOLVERS[providerId];
        const registryFetcher = AI_PROVIDERS[providerId]?.modelsFetcher;
        const genericFetcher = registryFetcher && OPENAI_MODELS_FETCHER_TYPES.has(registryFetcher.type) ?
        registryFetcher :
        null;
        const isKimiLiveProvider = KIMI_LIVE_MODEL_PROVIDERS.has(providerId);
        const openAIStyleLiveResolver = !isCompatibleProvider && (genericFetcher || isKimiLiveProvider && customModelIds.length === 0) ?
        async (connection, liveGuard) => {
          const psd = isRecord(connection.providerSpecificData) ? connection.providerSpecificData : {};
          const proxyOptions = await resolveConnectionProxyConfig(psd);
          return resolveLiveOpenAIModels(connection, {
            provider: providerId,
            guard: liveGuard,
            proxyOptions,
            endpoint: genericFetcher?.url || (providerId === "kimi" ? "https://api.moonshot.ai/v1/models" : isKimiLiveProvider ? KIMI_CODING_MODELS_URL : undefined),
            anthropic: false,
            modelAliases: undefined,
            normalizeModel: providerId === "kimi" ? normalizeKimiPlatformModel : undefined,
          });
        } :
        null;
        // A curated custom-model list on a compatible node is the operator's
        // selection: it must not be unioned with the provider's full upstream
        // catalog (upstream decolua/9router #3880 / #3115).
        const hasCuratedCompatibleModels = isCompatibleProvider && customModelIds.length > 0;
        // Without curated rows, an explicit allowlist is the node's catalog
        // (upstream decolua/9router #4954): it stays listed when discovery is
        // empty or down, and discovery only adds metadata to those ids.
        if (isCompatibleProvider && !hasCuratedCompatibleModels && hasExplicitEnabledModels) rawModelIds = enabledModels;
        const liveResolver = syncedModels || hasCuratedCompatibleModels ? null : providerLiveResolver || openAIStyleLiveResolver;
        // Taken before any lookup: a resolver may refresh the connection's tokens in place.
        const catalogIdentity = [providerId, conn.id, conn.apiKey, conn.accessToken, conn.providerSpecificData, guard];
        const resolveLive = () => withCatalogDeadline(["live", ...catalogIdentity], () => liveResolver(conn, guard));
        if (liveResolver && (!hasExplicitEnabledModels || providerLiveResolver || openAIStyleLiveResolver)) {
          try {
            const live = await resolveLive();
            if (live?.models?.length) {
              /**
               * Registry `/models` catalogs are credential-scoped. Never add a
               * durable cache keyed only by provider: different credentials can
               * expose different private or preview model IDs.
               */
              const unionRegistryLiveModels = Boolean(genericFetcher) && !hasExplicitEnabledModels;
              const enrichExistingOnly = hasExplicitEnabledModels || !isCompatibleProvider && !unionRegistryLiveModels && !LIVE_MODEL_UNION_PROVIDERS.has(providerId) && (
              Boolean(openAIStyleLiveResolver) || providerId === "cloudflare-ai") &&
              rawModelIds.length > 0;
              const servedIds = new Set(rawModelIds);
              const liveModels = enrichExistingOnly ?
              live.models.filter((m) => servedIds.has(m.id)) :
              live.models;
              // Registry discovery unions credential-scoped live IDs with static
              // catalog IDs. Dedicated resolvers retain their existing semantics.
              // Generic `modelsFetcher` providers with an explicit `enabledModels`
              // allowlist keep the user's selection authoritative: never add live
              // sibling IDs. Existing provider-specific enrichment still runs to
              // backfill caps (e.g. contextWindow) for the selected models.
              if (isCompatibleProvider) {
                rawModelIds = Array.from(new Set([...rawModelIds, ...liveModels.map((m) => m.id)]));
              } else if (!hasExplicitEnabledModels) {
                if (providerId === "codex") {
                  // The account catalog decides which chat models exist (upstream #4292). It never
                  // lists image or transcription rows, or the review aliases of the models it lists.
                  const listed = new Set(liveModels.map((m) => m.id));
                  const registryOnly = providerModels.filter((m) => modelKind(m) !== LLM_KIND ||
                    m.quotaFamily === "review" && listed.has(m.upstreamModelId));
                  rawModelIds = Array.from(new Set([...listed, ...registryOnly.map((m) => m.id)]));
                } else if (unionRegistryLiveModels || LIVE_MODEL_UNION_PROVIDERS.has(providerId)) {
                  rawModelIds = Array.from(new Set([...rawModelIds, ...liveModels.map((m) => m.id)]));
                } else if (!enrichExistingOnly) {
                  rawModelIds = liveModels.map((m) => m.id);
                }
              }
              for (const m of liveModels) {
                if (!isRecord(m) || !isString(m.id)) continue;
                liveModelById.set(m.id, m);
                liveModelIds.add(m.id);
                if (m.kind || m.type) liveModelKindById.set(m.id, m.kind || m.type);
                if (isRecord(m.capabilities)) liveCapabilitiesById.set(m.id, m.capabilities);
              }
              if (isCompatibleProvider && enrichExistingOnly) {
                const prefixKey = `${outputAlias}/`;
                for (const m of live.models) {
                  if (!isRecord(m) || !isString(m.id) || !isRecord(m.capabilities)) continue;
                  if (m.id.startsWith(prefixKey) && servedIds.has(m.id.slice(prefixKey.length))) {
                    liveCapabilitiesById.set(m.id, m.capabilities);
                  }
                }
              }
            }
          } catch {
            // Live discovery is optional metadata; static catalog remains authoritative fallback.
          }
        } else if (providerId === "ollama-local" && liveResolver && hasExplicitEnabledModels) {
          // ollama-local only: explicit enabledModels keep the user's
          // selection, but /api/tags still supplies kind metadata so a
          // selected bge-m3 classifies as embedding instead of falling
          // through to the LLM heuristic. Other providers keep their
          // no-network fast path.
          try {
            const live = await resolveLive();
            for (const m of live?.models ?? []) {
              if (!rawModelIds.includes(m.id)) continue;
              liveModelById.set(m.id, m);
              if (m.kind || m.type) liveModelKindById.set(m.id, m.kind || m.type);
              if (isRecord(m.capabilities)) liveCapabilitiesById.set(m.id, m.capabilities);
            }
          } catch (err) {
            console.log(`Live model classification failed for ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // Native media catalog rows join the chat discovery. An id the chat
        // catalog already lists keeps its chat row; the allowlist still applies.
        // Only ids in the current catalog may be published with a catalog-owned
        // kind, including rows a synced catalog stored earlier.
        const mediaCatalogRows = PROVIDER_MEDIA_CATALOGS[providerId] ? await resolveProviderMediaCatalog(providerId, kindFilter) : [];
        const mediaCatalogIds = new Set(mediaCatalogRows.map((row) => row.id));
        if (!syncedModels) {
          for (const row of mediaCatalogRows) {
            if (liveModelIds.has(row.id) || staticModelById.has(row.id)) continue;
            if (hasExplicitEnabledModels && !enabledModels.includes(row.id)) continue;
            if (!rawModelIds.includes(row.id)) rawModelIds.push(row.id);
            liveModelById.set(row.id, row);
            liveModelIds.add(row.id);
            liveModelKindById.set(row.id, row.kind);
          }
        }
        // Local passthrough live discovery (lm-studio, vllm, lemonade). Hits
        // transport.baseUrl + /models with optional Bearer apiKey.
        if (
        !isCompatibleProvider &&
        rawModelIds.length === 0 &&
        AI_PROVIDERS[providerId]?.passthroughModels &&
        !AI_PROVIDERS[providerId]?.modelsFetcher)
        {
          try {
            const localPassthroughIds = await withCatalogDeadline(
              ["passthrough", ...catalogIdentity],
              () => fetchLocalPassthroughModels(conn, guard)
            ) ?? [];
            if (localPassthroughIds.length) rawModelIds = localPassthroughIds;
          } catch (err) {
            console.log(`Local passthrough model fetch failed for ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const modelIds = rawModelIds.
        map((modelId) => {
          // Some vendor ids start with the provider's own alias (fal-ai/flux/dev,
          // nvidia/parakeet-...). Stripping them would publish an id that routes
          // to a model the upstream does not have.
          if (staticModelById.has(modelId) || liveModelIds.has(modelId)) return modelId;
          if (modelId.startsWith(`${outputAlias}/`)) return modelId.slice(outputAlias.length + 1);
          if (modelId.startsWith(`${staticAlias}/`)) return modelId.slice(staticAlias.length + 1);
          if (modelId.startsWith(`${providerId}/`)) return modelId.slice(providerId.length + 1);
          return modelId;
        }).
        filter((modelId) => isString(modelId) && modelId.trim() !== "");

        const aliasModelIds = isCompatibleProvider ? [] : Object.values(modelAliases).
        filter((fullModel) => isString(fullModel) && fullModel.includes("/")).
        map((fullModel) => {
          if (fullModel.startsWith(`${outputAlias}/`)) return fullModel.slice(outputAlias.length + 1);
          if (fullModel.startsWith(`${staticAlias}/`)) return fullModel.slice(staticAlias.length + 1);
          if (fullModel.startsWith(`${providerId}/`)) return fullModel.slice(providerId.length + 1);
          return fullModel;
        }).
        filter((modelId) => isString(modelId) && modelId.trim() !== "").
        // An allowlist restricts what /v1/models publishes for this provider;
        // an alias pointed at an id outside it must not re-expose that id.
        // Custom models keep their separate always-visible exception.
        filter((modelId) => !hasExplicitEnabledModels || enabledModels.includes(modelId)).
        // A pruned model stays out even when an alias still points at it.
        filter((modelId) => !syncedModelIds || syncedModelIds.has(modelId));
        const compatiblePublicIds = isCompatibleProvider ? getCompatiblePublicIds({
          customModelIds,
          modelAliases,
          providerId,
          staticAlias,
          outputAlias
        }) :
        null;
        const mergedModelIds = Array.from(new Set(compatiblePublicIds ?
        [...modelIds, ...compatiblePublicIds.ids, ...compatiblePublicIds.aliasIds] :
        [...modelIds, ...customModelIds, ...aliasModelIds]));
        const perProviderModels = [];

        for (const modelId of mergedModelIds) {
          if (staticModelById.get(modelId)?.routingUnavailableReason) continue;
          if (staticModelById.get(modelId)?.requiresApiKey === true && !hasUsableCredential) continue;
          // Resolve kind: prefer custom/live/static metadata, otherwise infer from ID heuristics
          const customKind = customModelKindById.get(modelId);
          const liveKind = liveModelKindById.get(modelId);
          const kind = customKind || liveKind || staticModelKindById.get(modelId) ||
            (providerId === "ollama-local" && isLegacyOllamaEmbeddingModel({ id: modelId }) ? "embedding" : inferKindFromUnknownModelId(modelId));
          // imageToText custom models stay in the LLM list (vision-capable chat models)
          const allowAsLlm = kind === "imageToText" && kindFilter.includes(LLM_KIND);
          // Only the native media catalog may give such a provider a media row;
          // a kind inferred or synced from a chat facade name is not one.
          if (!customKind && !staticModelKindById.has(modelId) && PROVIDER_MEDIA_CATALOGS[providerId]?.kinds.includes(kind) && !mediaCatalogIds.has(modelId)) continue;
          if (!kindFilter.includes(kind) && !allowAsLlm) continue;
          if (isModelDisabled(modelId, outputAlias, staticAlias, providerId, getProviderAlias(providerId))) continue;
          // #6495 / F-4: drop paid provider models when the toggle is on.
          // Classify by output alias so provider-specific overrides (gh/…,
          // api-airforce (Free) markers, …) are honored identically to the
          // modal + combo filters.
          if (hidePaidModels && isPaidModel(`${outputAlias}/${modelId}`)) continue;

          const customCaps = {
            ...(capabilitiesFromServiceKind(customKind || liveKind) || {}),
            ...(customCapabilitiesById.get(modelId) || {})
          };
          const liveCaps = liveCapabilitiesById.get(modelId) || (isCompatibleProvider ? liveCapabilitiesById.get(`${outputAlias}/${modelId}`) : null) || null;
          const explicitCaps = { ...(liveCaps || {}), ...customCaps };
          /**
           * Compatible providers reuse proven static family limits even when
           * their UUID-scoped registry has no literal model row. Unknown IDs
           * keep explicit/live metadata only, so generic defaults stay hidden.
           */
          const hasStaticModel = staticModelById.has(modelId);
          // ID-only provider catalogs prove routing, not a model-family limit.
          // Apply pattern fallback to configured/compatible IDs, but never to a
          // newly enumerated MiniMax/GLM ID absent from the static registry.
          const isUncatalogedIdOnlyLiveModel = (
          providerId === "minimax" || providerId === "minimax-cn" ||
          providerId === "glm" || providerId === "glm-cn") &&
          liveModelIds.has(modelId) && !hasStaticModel;
          const hasStaticLimits = hasStaticModel ||
          !isUncatalogedIdOnlyLiveModel && resolveModelLimits(providerId, modelId).known;
          const caps = hasStaticLimits ?
          { ...getCapabilitiesForModel(providerId, modelId, kind), ...explicitCaps } :
          explicitCaps;
          const presentationModel = customModelById.get(modelId)
            || liveModelById.get(modelId)
            || staticModelById.get(modelId)
            || { id: modelId };
          const presentation = projectModelPresentation({
            model: presentationModel,
            modelId,
            providerId,
            outputAlias,
          });
          const model = {
            id: `${outputAlias}/${modelId}`,
            object: "model",
            owned_by: outputAlias,
            kind,
            capabilities: caps,
            ...presentation,
          };
          if ((kind === LLM_KIND || allowAsLlm) && (hasStaticLimits || Object.keys(explicitCaps).length)) {
            attachModelLimits(model, providerId, modelId, customCaps, liveCaps);
          }
          if (kind === LLM_KIND || allowAsLlm) {
            const levels = getThinkingLevelsFromCapabilities(caps, providerId, modelId);
            if (levels?.length) model.thinking_levels = levels;
          }
          perProviderModels.push(model);
        }

        // Web search/fetch — provider IS the model, expose as {alias}/search and/or {alias}/fetch with explicit kind
        const providerInfo = AI_PROVIDERS[providerId];
        if (kindFilter.includes("webSearch") && providerInfo?.searchConfig) {
          perProviderModels.push({
            id: `${outputAlias}/search`,
            object: "model",
            kind: "webSearch",
            owned_by: outputAlias
          });
        }
        if (kindFilter.includes("webFetch") && providerInfo?.fetchConfig) {
          perProviderModels.push({
            id: `${outputAlias}/fetch`,
            object: "model",
            kind: "webFetch",
            owned_by: outputAlias
          });
        }

        return perProviderModels;
      })
    );

    for (const result of providerResults) {
      models.push(...result);
    }

    // Keyless catalogs stay visible even when unrelated saved connections
    // exist. A real connection for the same provider already contributes its
    // catalog above and suppresses this synthetic fallback. Dynamic no-auth
    // catalogs reuse the guarded, five-minute cached OpenAI resolver.
    for (const [providerId, provider] of Object.entries(AI_PROVIDERS)) {
      if (provider?.noAuth !== true || activeConnectionByProvider.has(providerId)) continue;
      if (isFreeNoAuthDisabled(providerId)) continue;
      const alias = PROVIDER_ID_TO_ALIAS[providerId] ?? getProviderAlias(providerId) ?? providerId;
      await addNoAuthProviderModels(providerId, alias);
    }
  }

  // OmniRoute b748429cf5b3aeb142a708fd3e8751b6918b9dc8,
  // open-sse/config/providers/registry/chatgpt/index.ts: account catalog discovery.
  // Never cache this roster or load private storage before authorization gates.
  if (kindFilter.includes(LLM_KIND) && process.env.DURINDOOR_CHATGPT_PLAN_ENROLLMENT === "1" &&
      PROVIDERS["chatgpt-plan"] && options.verifiedKey?.isActive === true &&
      Array.isArray(options.allowedConnectionIds) && options.allowedConnectionIds.length) {
    const eligiblePlanConnections = connections.filter((c) => c.provider === "chatgpt-plan" && c.isActive === true && c.authType === "oauth" && options.allowedConnectionIds.includes(c.id));
    const conn = eligiblePlanConnections.length === 1 ? eligiblePlanConnections[0] : null;
    if (conn) {
      try {
        const { createChatGptPlanAccounts } = await import("@/lib/oauth/chatgptPlanAccounts.js");
        const access = await resolveChatgptPlanAccess({
          verifiedKey: options.verifiedKey, allowedConnectionIds: options.allowedConnectionIds,
          selectedConnection: conn, accountSelection: conn.providerSpecificData?.chatgptPlanAccount,
          ownerOperatedEnabled: true, providerRegistered: true,
          accounts: { readAccount: (selection) => createChatGptPlanAccounts({ fetchAdapter: (url, init) => fetch(url, init) }).readAccount(selection) },
        });
        if (access) {
          const rows = await listChatgptPlanModels(access);
          const alias = getProviderAlias("chatgpt-plan") || "chatgpt-plan";
          for (const row of rows) {
            if (isDisabled(alias, row.slug)) continue;
            const enabled = resolveEnabledModels("chatgpt-plan", conn);
            if (enabled.length && !enabled.includes(row.slug)) continue;
            const model = { id: `${alias}/${row.slug}`, object: "model", owned_by: alias, kind: LLM_KIND, name: row.display_name || row.slug, capabilities: {} };
            privatePlanModels.add(model);
            models.push(model);
          }
        }
      } catch {
        // Private account or upstream failures must not reveal credentials.
      }
    }
  }


  const dedupedModels = [];
  const seenModelIds = new Set();
  const listedIds = new Set(models.map((model) => model?.id));
  for (const model of models) {
    if (!model?.id || seenModelIds.has(model.id)) continue;
    const prefix = model.id.split("/")[0];
    if ((aliasToProviderId[prefix] ?? prefix) === "chatgpt-plan" && !privatePlanModels.has(model)) continue;
    seenModelIds.add(model.id);
    // #6495 / F-4: backstop filter — catches any path that didn't pre-filter
    // (custom models, alias-backed rows, keyless static fallback). Combos are
    // already member-filtered above; skip them here so an empty/all-paid combo
    // can't be re-hidden by its bare name (unknown → visible).
    if (hidePaidModels && model.owned_by !== "combo" && isPaidModel(model.id)) continue;
    // OmniRoute #11481 (port(omniroute)): operator glob allow/deny list for
    // /v1/models exposure. Same backstop shape as hidePaidModels above so
    // every code path that can push a model entry is covered in one place.
    // Named combos are exempt (an entry is a bare combo name, not a
    // provider/model pair); their member pool is filtered separately where
    // it feeds auto/* resolution (src/sse/services/model.js::getComboModels).
    if (model.owned_by !== "combo" && model.id.includes("/")) {
      const slash = model.id.indexOf("/");
      const provider = model.id.slice(0, slash);
      const modelId = model.id.slice(slash + 1);
      if (!isModelExposureAllowed(provider, modelId, settings, (p) => aliasToProviderId[p])) continue;
      enforceCursorCapabilities(aliasToProviderId[provider] ?? provider, model.capabilities);
    }
    // Codex clients consume effort objects; advertise only the levels already
    // resolved for this model rather than a provider-wide guessed list. An
    // effort alias gets none: its id already fixes the effort.
    if ((aliasToProviderId[prefix] ?? prefix) === "codex" && model.thinking_levels?.length &&
        !isEffortSuffixedVariantOfListedId(model.id, listedIds)) {
      model.supported_reasoning_levels = model.thinking_levels.map((effort) => ({
        effort,
        description: effort === "none" ? "Disable Thinking" : effort === "xhigh" ? "Extra High" : effort.charAt(0).toUpperCase() + effort.slice(1),
      }));
    }
    dedupedModels.push(model);
  }

  return dedupedModels;
}

/**
 * Coalescing wrapper for `buildModelsList` (OmniRoute #6440).
 *
 * Concurrent `/v1/models` (and `/v1/models/{kind}`) requests that arrive while
 * the first is still aggregating share a single in-flight promise instead of
 * each re-running provider/combo/catalog aggregation. Keyed by the serialized
 * `kindFilter` so root `["llm"]` and capability filters (e.g. `["image"]`) do
 * not collide. The map entry is deleted in `finally`, so:
 *   - settled results are NEVER cached (next request observes fresh DB state),
 *   - a rejection cannot poison subsequent calls.
 *
 * OmniRoute #6966: live discovery fetches (`resolveLiveOpenAIModels` and
 * `fetchLocalPassthroughModels`) use `guardedProbeFetch` with the same
 * local-first SSRF guard tier as provider connection validation. LAN-local
 * OpenAI-compatible servers remain available under the default guard, while
 * cloud-metadata/link-local destinations and redirect-based SSRF stay blocked.
 * Both fetchers fail soft, so one unavailable provider cannot break the list.
 *
 * @param {string[]} kindFilter - service kinds to include.
 * @param {"none"|"public-only"|"block-metadata"} [guard] - resolved SSRF guard
 *   mode for discovery fetches. Defaults to `getProviderValidationGuard()` so
 *   direct callers (policy catalog, tests) always run guarded; the models
 *   routes pass the same resolution explicitly.
 * @param {{ exposeComboOnly?: boolean, allowedConnectionIds?: string[]|null }} [options] -
 *   `exposeComboOnly` is an internal override for callers that require the full
 *   direct-model catalog. `allowedConnectionIds` is the caller's API-key scope
 *   (empty or absent means unrestricted); it selects the connection whose
 *   models connection-scoped providers (including MLX, OpenCode Server and Grokified) list.
 * @returns {Promise<object[]>} OpenAI-format model entries.
 */
export function buildModelsList(kindFilter, guard = getProviderValidationGuard(), options = {}) {
  // A verified request must never share an account-bound result with another key.
  if (options.verifiedKey) return buildModelsListImpl(kindFilter, guard, options);
  // #6440: store the impl promise itself so concurrent same-kind callers get
  // the SAME reference. Map insertion happens synchronously before any caller
  // can observe the async aggregation result. #6495/F-4 hide-paid filtering is
  // resolved inside the impl, so one shared build serves all concurrent
  // same-kind callers consistently.
  // #6966: guard mode and the internal exposure override affect behavior, so
  // both join the coalescing key. Public callers omit the override and retain
  // settings-driven /v1/models behavior.
  const exposureKey = options.exposeComboOnly === undefined ? "settings" : String(options.exposeComboOnly);
  // A scoped caller must never share a build with another scope's caller.
  const scopeKey = Array.isArray(options.allowedConnectionIds) && options.allowedConnectionIds.length > 0 ?
  JSON.stringify([...new Set(options.allowedConnectionIds)].sort()) : "";
  const pendingKey = `${kindFilterKey(kindFilter)}\0${guard}\0${exposureKey}\0${scopeKey}`;
  const existing = modelsInFlight.get(pendingKey);
  if (existing) return existing;

  const promise = buildModelsListImpl(kindFilter, guard, options).finally(() => {
    // Only delete if still the same promise (guards against a stale entry if
    // the map is ever manipulated elsewhere).
    if (modelsInFlight.get(pendingKey) === promise) modelsInFlight.delete(pendingKey);
  });
  modelsInFlight.set(pendingKey, promise);
  return promise;
}
