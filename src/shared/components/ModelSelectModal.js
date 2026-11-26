"use client";

import { requestSettings } from "@/store/settingsStore";

import { useState, useMemo, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import CapabilityIcons from "@/shared/ui/v5/combos/CapabilityIcons.jsx";
import "@/shared/ui/v5/combos/combos.css";
import Modal from "@/shared/ui/components/Modal.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import { Chip } from "@/shared/ui/components/Chip.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import CapacityBadges from "./CapacityBadges";
import { passthroughAliasModels } from "../utils/passthroughAliasModels.js";
import { getCircularComboNames } from "../utils/circularCombos.js";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { useOrcaRouterCatalog } from "@/shared/hooks/useOrcaRouterCatalog";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, AI_PROVIDERS, isHiddenProvider, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, getProviderAlias, LIVE_CATALOG_PROVIDERS } from "@/shared/constants/providers";
import { mergeLiveCatalogs, liveCatalogModelEntries } from "@/shared/utils/liveCatalogModels";
import { resolveProviderPrefix } from "@/shared/utils/providerPrefix";

// Provider order: OAuth first, then Free Tier, then API Key (matches dashboard/providers)
import { isString } from "../utils/typeChecks.js";
const PROVIDER_ORDER = [
...Object.keys(OAUTH_PROVIDERS),
...Object.keys(FREE_PROVIDERS),
...Object.keys(FREE_TIER_PROVIDERS),
...Object.keys(APIKEY_PROVIDERS)];


/**
 * No-auth, non-hidden providers from both free categories, deduplicated for combo pickers.
 * Includes runtime-configured entries such as SearXNG without claiming reachability.
 * Reuses the registry-backed generic-selection predicate; ported from upstream PR #3280.
 */
export const NO_AUTH_PROVIDER_IDS = [...new Set([
...Object.keys(FREE_PROVIDERS).filter((id) => FREE_PROVIDERS[id].noAuth && !isHiddenProvider(id)),
...Object.keys(FREE_TIER_PROVIDERS).filter((id) => FREE_TIER_PROVIDERS[id].noAuth && !isHiddenProvider(id))]
)];

/**
 * Drop no-auth providers the operator disabled (settings.disabledFreeProviders).
 * Ported from upstream PR #2650 (picker half); server gates already live in
 * freeProviderGate.js.
 */
export function filterEnabledNoAuthIds(ids, disabledFreeProviders) {
  const disabled = new Set(Array.isArray(disabledFreeProviders) ? disabledFreeProviders : []);
  return ids.filter((id) => !disabled.has(id));
}

// kindFilter (UI service kind) → /api/v1/models slug. webSearch/webFetch share
// the `web` slug server-side. null/absent → root LLM list.
const KIND_TO_SLUG = {
  image: "image",
  tts: "tts",
  stt: "stt",
  video: "video",
  music: "music",
  embedding: "embedding",
  imageToText: "image-to-text",
  webSearch: "web",
  webFetch: "web"
};

// Web provider-as-model rows are routed by providerId but cataloged as
// `<alias>/search` and `<alias>/fetch`; map the UI kind to its catalog suffix.
const WEB_KIND_SUFFIX = { webSearch: "search", webFetch: "fetch" };

/** V5 presents the same catalog and selection callbacks as rows; empty-search feedback remains announced. */
export default function ModelSelectModal({
  isOpen,
  onClose,
  onSelect,
  onDeselect,
  selectedModel,
  activeProviders = [],
  title = "Select Model",
  modelAliases = {},
  kindFilter = null,
  addedModelValues = [],
  closeOnSelect = true,
  comboContext = null
}) {
  // Filter activeProviders by active state and serviceKinds when kindFilter set (e.g. "webSearch", "webFetch")
  const filteredActiveProviders = useMemo(() => {
    const activeOnly = (activeProviders || []).filter((p) => p && p.isActive !== false);
    if (!kindFilter) return activeOnly;
    return activeOnly.filter((p) => {
      const info = AI_PROVIDERS[p.provider];
      const kinds = info?.serviceKinds || ["llm"];
      return kinds.includes(kindFilter);
    });
  }, [activeProviders, kindFilter]);
  const { getCaps } = useModelCaps(isOpen);
  // OrcaRouter: capability-scoped live catalog. `kindFilter` selects the entry
  // point, so the model list is recomputed whenever the selector changes kind.
  const orcaCapability = kindFilter === "embedding" ? "embedding" :
  kindFilter === "image" ? "image" :
  kindFilter === "video" ? "video" :
  "chat";
  const orcaConnectionIds = useMemo(
    () => (activeProviders || []).filter((p) => p?.provider === "orcarouter" && p.isActive !== false).map((p) => p.id),
    [activeProviders]
  );
  const orcaCatalog = useOrcaRouterCatalog(isOpen, orcaConnectionIds, orcaCapability, null);
  const v5 = useUiV5();
  const [providerFilter, setProviderFilter] = useState("all");
  const [discoveryPending, setDiscoveryPending] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [planKey, setPlanKey] = useState("");
  const [planConnection, setPlanConnection] = useState("");
  const [planStatus, setPlanStatus] = useState("");
  const planRequestVersion = useRef(0);
  const [combos, setCombos] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [customModels, setCustomModels] = useState([]);
  const [disabledModels, setDisabledModels] = useState({});
  const [fetchedModels, setFetchedModels] = useState({});
  // Clear a transient credential when the parent closes the modal externally.
  useEffect(() => {
    if (!isOpen) {
      planRequestVersion.current++;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlanKey("");
      setPlanStatus("");
      setFetchedModels((previous) => previous["chatgpt-plan"]?.length ? { ...previous, "chatgpt-plan": [] } : previous);
    }
    return () => { planRequestVersion.current++; };
  }, [isOpen]);
  // Effective auto-synced model lists by provider id (/api/models/auto-sync);
  // a provider listed here shows its synced list instead of the registry.
  const [syncedModelLists, setSyncedModelLists] = useState({});
  // #6495 / F-4: ids the server catalog currently exposes. /api/v1/models is
  // already filtered by the hide-paid toggle server-side, so intersecting the
  // modal's locally-built entries with this set enforces the toggle without
  // bundling the pricing catalog into the dashboard chunk. A null set means
  // "toggle off / not yet checked" → no client filtering. Once the toggle is
  // confirmed ON the set is seeded EMPTY (fail-closed) and only replaced with
  // real ids after a valid catalog fetch, so a fetch error or malformed body
  // hides paid models rather than leaking them. When the toggle is off the
  // server returns the full catalog and the intersection is a no-op for known
  // models while still keeping custom/unknown entries visible.
  const [visibleModelIds, setVisibleModelIds] = useState(null);
  const [visibleCatalogReady, setVisibleCatalogReady] = useState(false);
  const [disabledFreeProviders, setDisabledFreeProviders] = useState([]);

  useEffect(() => {
    if (!isOpen) return;
    // Clear any stale set so a kind/toggle change never filters the freshly
    // rendered picker with the previous catalog while the new fetch is in
    // flight; an ignore flag drops a slow prior response from overwriting a
    // newer one.
    let ignore = false;
    setVisibleCatalogReady(false);
    setVisibleModelIds(null);
    const controller = new AbortController();
    (async () => {
      try {
        const settingsRes = await requestSettings({ signal: controller.signal });
        if (!settingsRes.ok) throw new Error(`settings ${settingsRes.status}`);
        const settingsData = await settingsRes.json();
        if (ignore) return;
        setDisabledFreeProviders(Array.isArray(settingsData?.disabledFreeProviders) ? settingsData.disabledFreeProviders : []);
        if (settingsData?.hidePaidModels !== true) {
          setVisibleCatalogReady(true);
          return;
        }
        // Fail-closed: from this point the toggle is confirmed ON. Hide
        // everything until a VALID catalog response replaces this set — non-OK
        // status, thrown fetch, or a malformed `data` payload must NOT fall
        // back to showing paid ids (A200 leakage fix).
        setVisibleModelIds(new Set());
        const slug = kindFilter ? KIND_TO_SLUG[kindFilter] : null;
        const url = slug ? `/api/v1/models/${slug}` : "/api/v1/models";
        const modelsRes = await fetch(url, { signal: controller.signal });
        if (!modelsRes.ok) throw new Error(`models ${modelsRes.status}`);
        const modelsData = await modelsRes.json();
        if (!Array.isArray(modelsData?.data) || ignore) return;
        const ids = modelsData.data.
        map((m) => m.id).
        filter((id) => isString(id));
        setVisibleModelIds(new Set(ids));
        setVisibleCatalogReady(true);
      } catch (error) {
        if (error?.name === "AbortError") return;
        console.error("Error fetching visible model ids:", error);
      }
    })();
    return () => {
      ignore = true;
      controller.abort();
    };
  }, [isOpen, kindFilter]);

  const fetchCombos = async () => {
    try {
      const res = await fetch("/api/combos");
      if (!res.ok) throw new Error(`Failed to fetch combos: ${res.status}`);
      const data = await res.json();
      setCombos(data.combos || []);
    } catch (error) {
      console.error("Error fetching combos:", error);
      setCombos([]);
    }
  };

  useEffect(() => {
    if (isOpen) fetchCombos();
  }, [isOpen]);

  const fetchProviderNodes = async () => {
    setDiscoveryPending(true);
    setCatalogError("");
    try {
      const res = await fetch("/api/provider-nodes");
      if (!res.ok) throw new Error(`Failed to fetch provider nodes: ${res.status}`);
      const data = await res.json();
      setProviderNodes(data.nodes || []);
    } catch (error) {
      console.error("Error fetching provider nodes:", error);
      setProviderNodes([]);
      setCatalogError("Provider details could not load. Reopen to retry.");
    } finally {
      setDiscoveryPending(false);
    }
  };

  useEffect(() => {
    if (isOpen) fetchProviderNodes();
  }, [isOpen]);

  const fetchCustomModels = async () => {
    try {
      const res = await fetch("/api/models/custom");
      if (!res.ok) throw new Error(`Failed to fetch custom models: ${res.status}`);
      const data = await res.json();
      setCustomModels(data.models || []);
    } catch (error) {
      console.error("Error fetching custom models:", error);
      setCustomModels([]);
    }
  };

  useEffect(() => {
    if (isOpen) fetchCustomModels();
  }, [isOpen]);

  // Fetch models dynamically from custom provider endpoints
  const fetchProviderModels = async (providerId) => {
    try {
      // Find the connection ID for this provider
      const connection = activeProviders.find((p) => p.provider === providerId);
      if (!connection?.id) return null;

      const res = await fetch(`/api/providers/${connection.id}/models`);
      if (!res.ok) {
        console.log(`Failed to fetch models for ${providerId}:`, res.status);
        return null;
      }
      const data = await res.json();
      return data.models || [];
    } catch (error) {
      console.error(`Error fetching models for ${providerId}:`, error);
      return null;
    }
  };

  // Fetch a provider's account-scoped live catalog for every active connection
  // and merge the results. Entries collapse by model id: two connections of the
  // same provider expose the same catalog, so the first one wins.
  const fetchLiveCatalogModels = async (providerId) => {
    const connections = activeProviders.filter((p) => p.provider === providerId && p.id);
    if (connections.length === 0) return [];

    const catalogs = await Promise.all(connections.map(async (connection) => {
      try {
        const res = await fetch(`/api/providers/${connection.id}/models`);
        if (!res.ok) {
          console.log(`Failed to fetch live models for ${providerId}:`, res.status);
          return [];
        }
        const data = await res.json();
        return Array.isArray(data.models) ? data.models : [];
      } catch (error) {
        console.error(`Error fetching live models for ${providerId}:`, error);
        return [];
      }
    }));

    return mergeLiveCatalogs(catalogs);
  };

  // Fetch models for all custom providers when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let ignore = false;

    const loadProviderModels = async () => {
      const customProviderIds = activeProviders.
      filter((p) => isOpenAICompatibleProvider(p.provider) || isAnthropicCompatibleProvider(p.provider) || p.provider === "hcnsec").
      map((p) => p.provider);
      // Providers that publish a per-account live catalog (claude, commandcode):
      // a passthrough provider has no static list at all, and an account's
      // catalog is not the static registry either.
      const liveCatalogProviderIds = [...new Set(activeProviders.
        map((p) => p.provider).
        filter((providerId) => LIVE_CATALOG_PROVIDERS.includes(providerId)))];

      if (customProviderIds.length === 0 && liveCatalogProviderIds.length === 0) return;

      const fetched = {};
      await Promise.all([
        ...customProviderIds.map(async (providerId) => {
          const models = await fetchProviderModels(providerId);
          if (models && models.length > 0) {
            fetched[providerId] = models;
          }
        }),
        ...liveCatalogProviderIds.map(async (providerId) => {
          const models = await fetchLiveCatalogModels(providerId);
          if (models.length > 0) fetched[providerId] = models;
        }),
      ]);

      if (ignore) return;
      setFetchedModels(fetched);
    };

    loadProviderModels();
    return () => { ignore = true; };
  }, [isOpen, activeProviders]);

  const fetchDisabledModels = async () => {
    try {
      const res = await fetch("/api/models/disabled");
      if (!res.ok) throw new Error(`Failed to fetch disabled models: ${res.status}`);
      const data = await res.json();
      setDisabledModels(data.disabled || {});
    } catch (error) {
      console.error("Error fetching disabled models:", error);
      setDisabledModels({});
    }
  };

  useEffect(() => {
    if (isOpen) fetchDisabledModels();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let ignore = false;
    fetch("/api/models/auto-sync", { cache: "no-store" }).
    then((res) => res.ok ? res.json() : null).
    then((data) => {
      if (ignore) return;
      const lists = {};
      for (const [providerId, status] of Object.entries(data?.providers || {})) {
        if (Array.isArray(status?.models)) lists[providerId] = status.models;
      }
      setSyncedModelLists(lists);
    }).
    catch(() => {});
    return () => {
      ignore = true;
    };
  }, [isOpen]);

  const allProviders = useMemo(() => ({ ...OAUTH_PROVIDERS, ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...APIKEY_PROVIDERS }), []);

  // Group models by provider with priority order
  const groupedModels = useMemo(() => {
    const groups = {};

    // Kinds where the provider IS the model (no per-model selection needed)
    const PROVIDER_AS_MODEL_KINDS = new Set(["webSearch", "webFetch"]);
    // Media pickers must use their own model kind, including passthrough catalogs.
    const TYPED_KINDS = new Set(["image", "tts", "stt", "embedding", "imageToText", "video", "music"]);
    // For these kinds, providers without hardcoded models can still be picked (provider-as-model fallback)
    const ALLOW_PROVIDER_FALLBACK_KINDS = new Set(["tts", "image", "webFetch"]);

    // Filter a models[] array by kindFilter (keep only matching kind)
    const filterByKind = (models) => {
      // No kindFilter means the LLM selector. Keep custom models visible because
      // user-added models may have typed capabilities (for example imageToText)
      // while still being valid chat/combo targets.
      if (!kindFilter) return models.filter((m) => m.isPlaceholder || m.isCustom || !getModelKind(m) || getModelKind(m) === "llm");
      if (!TYPED_KINDS.has(kindFilter)) return models;
      return models.filter((m) => m.isPlaceholder || getModelKind(m) === kindFilter);
    };

    // Get all active provider IDs from connections (filtered by kindFilter if set)
    const activeConnectionIds = filteredActiveProviders.map((p) => p.provider);

    // No-auth providers: filter by kindFilter as well
    const enabledNoAuthIds = filterEnabledNoAuthIds(NO_AUTH_PROVIDER_IDS, disabledFreeProviders);
    const noAuthIds = kindFilter ?
    enabledNoAuthIds.filter((id) => (AI_PROVIDERS[id]?.serviceKinds || ["llm"]).includes(kindFilter)) :
    enabledNoAuthIds;

    // Show connected providers and no-auth providers. Custom compatible-provider
    // nodes are covered by activeConnectionIds (connection.provider === node id),
    // so they appear only with a non-disabled connection — the parent already
    // filtered disabled connections out of activeProviders (DurinDoor #2526).
    const providerIdsToShow = new Set([
    ...activeConnectionIds, // Connected providers (incl. active custom nodes)
    ...noAuthIds // No-auth providers (kind-filtered)
    ]);

    // Sort by PROVIDER_ORDER
    const sortedProviderIds = [...providerIdsToShow].sort((a, b) => {
      const indexA = PROVIDER_ORDER.indexOf(a);
      const indexB = PROVIDER_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    sortedProviderIds.forEach((providerId) => {
      const alias = getProviderAlias(providerId);
      const providerInfo = allProviders[providerId] || { name: providerId };
      const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

      // For provider-as-model kinds (webSearch/webFetch): emit a single entry where value === providerId
      if (kindFilter && PROVIDER_AS_MODEL_KINDS.has(kindFilter)) {
        groups[providerId] = {
          name: providerInfo.name,
          alias,
          models: [{ id: providerId, name: providerInfo.name, value: providerId }]
        };
        return;
      }

      // OrcaRouter resolves first: its capability-filtered live catalog is
      // authoritative and must win over the passthrough branch below, which only
      // knows locally-registered aliases. An empty slice exposes no options at
      // all rather than degrading to free text.
      if (providerId === "orcarouter") {
        const live = orcaCatalog.models;
        if (live.length > 0) {
          groups[providerId] = {
            name: providerInfo.name,
            alias,
            color: providerInfo.color,
            models: live.map((m) => ({
              id: m.id,
              name: m.name || m.id,
              value: `${alias}/${m.id}`
            }))
          };
        }
        return;
      }

      if (providerInfo.passthroughModels) {
        const aliasModels = passthroughAliasModels(modelAliases, providerId, alias);
        const customRegisteredModels = customModels.
        filter((m) => m.providerAlias === alias).
        map((m) => ({
          id: m.id,
          name: m.name || m.id,
          value: `${alias}/${m.id}`,
          kind: getModelKind(m),
          isCustom: true
        }));

        // For typed kinds, only include hardcoded typed models (aliases are typically LLM-only and lack type info)
        let combined = aliasModels;
        if (kindFilter && TYPED_KINDS.has(kindFilter)) {
          const registeredTyped = customRegisteredModels.filter((m) => getModelKind(m) === kindFilter);
          combined = [
          ...registeredTyped,
          ...getModelsByProviderId(providerId).
          filter((m) => getModelKind(m) === kindFilter).
          map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) })).
          filter((m) => !registeredTyped.some((registered) => registered.value === m.value))];

          // Fallback: provider-as-model when no hardcoded models match (tts/image/webFetch only)
          if (combined.length === 0 && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
            const supports = (providerInfo.serviceKinds || ["llm"]).includes(kindFilter);
            if (supports) combined = [{ id: providerId, name: providerInfo.name, value: alias }];
          }
          // Augment with live-fetched models of the same kind when available
          const dynamicModels = fetchedModels[providerId] || [];
          const dynamicModelEntries = dynamicModels.
          map((m) => ({
            id: m.id || m.slug || m.model || m.name,
            name: m.name || m.displayName || m.id,
            value: `${alias}/${m.id || m.slug || m.model || m.name}`,
            kind: getModelKind(m)
          })).
          filter((m) => m.id && getModelKind(m) === kindFilter && !combined.some((existing) => existing.value === m.value));
          combined = [...combined, ...dynamicModelEntries];
        } else {
          // LLM/null kind: merge hardcoded models (e.g. mimo-free → mimo-auto) with user-added models
          const registeredLlms = customRegisteredModels.filter((m) => !getModelKind(m) || getModelKind(m) === "llm");
          const seen = new Set([...aliasModels, ...registeredLlms].map((m) => m.value));
          const hardcoded = getModelsByProviderId(providerId).
          filter((m) => !getModelKind(m) || getModelKind(m) === "llm").
          map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) })).
          filter((m) => !seen.has(m.value));
          combined = [...registeredLlms, ...aliasModels.filter((m) => !registeredLlms.some((registered) => registered.value === m.value)), ...hardcoded];
          // Augment with live-fetched LLM models when available
          const dynamicModels = fetchedModels[providerId] || [];
          const dynamicModelEntries = dynamicModels.
          map((m) => ({
            id: m.id || m.slug || m.model || m.name,
            name: m.name || m.displayName || m.id,
            value: `${alias}/${m.id || m.slug || m.model || m.name}`,
            kind: getModelKind(m)
          })).
          filter((m) => {
            if (!m.id) return false;
            if (getModelKind(m) && getModelKind(m) !== "llm") return false;
            return !combined.some((existing) => existing.value === m.value);
          });
          combined = [...combined, ...dynamicModelEntries];
        }

        if (combined.length > 0) {
          // Check for custom name from providerNodes (for compatible providers)
          const matchedNode = providerNodes.find((node) => node.id === providerId);
          const displayName = matchedNode?.name || providerInfo.name;

          groups[providerId] = {
            name: displayName,
            alias: alias,
            models: combined
          };
        }
      } else if (isCustomProvider) {
        // Custom (openai/anthropic-compatible) providers are LLM-only — skip for typed media kinds
        if (kindFilter && TYPED_KINDS.has(kindFilter)) return;
        // Find connection object to get prefix synchronously without waiting for providerNodes fetch
        const connection = activeProviders.find((p) => p.provider === providerId);
        const matchedNode = providerNodes.find((node) => node.id === providerId);
        const displayName = matchedNode?.name || connection?.name || providerInfo.name;
        // The published prefix is the operator's configured prefix. Only
        // provider nodes are remapped, so a stray `prefix` on a built-in
        // connection never renames that provider's models.
        const nodePrefix = resolveProviderPrefix({
          providerId,
          providerSpecificData: connection?.providerSpecificData,
          node: matchedNode
        });

        // Aliases are stored using the raw providerId as key (e.g. "openai-compatible-chat-<uuid>/glm-4.7"),
        // so we must filter by providerId, not by the display prefix.
        const nodeModels = Object.entries(modelAliases).
        filter(([, fullModel]) => isString(fullModel) && fullModel.startsWith(`${providerId}/`)).
        map(([aliasName, fullModel]) => ({
          id: fullModel.replace(`${providerId}/`, ""),
          name: aliasName,
          value: `${nodePrefix}/${fullModel.replace(`${providerId}/`, "")}`
        }));

        // Fetch models dynamically from the provider's upstream API
        const dynamicModels = fetchedModels[providerId] || [];
        const dynamicModelEntries = dynamicModels.map((m) => ({
          id: m.id || m.slug || m.model || m.name,
          name: m.name || m.displayName || m.id,
          value: `${nodePrefix}/${m.id || m.slug || m.model || m.name}`,
          capabilities: m.capabilities,
          isFetched: true
        }));

        // Merge custom models registered via /api/models/custom for this provider
        // providerAlias in DB uses the raw providerId, not the display prefix
        const registeredCustom = customModels.
        filter((m) => m.providerAlias === providerId).
        map((m) => ({
          id: m.id,
          name: m.name || m.id,
          value: `${nodePrefix}/${m.id}`,
          capabilities: m.capabilities,
          isCustom: true
        }));

        const seenValues = new Set(nodeModels.map((m) => m.value));
        const mergedCustom = registeredCustom.filter((m) => {
          if (seenValues.has(m.value)) return false;
          seenValues.add(m.value);
          return true;
        });

        const mergedDynamic = dynamicModelEntries.filter((m) => {
          if (seenValues.has(m.value)) return false;
          seenValues.add(m.value);
          return true;
        });

        const mergedModels = [...nodeModels, ...mergedCustom, ...mergedDynamic];

        // Always show compatible providers that are connected, even with no aliases or fetched models.
        // When no models exist, show a placeholder so users know it's available.
        const modelsToShow = mergedModels.length > 0 ? mergedModels : [{
          id: `__placeholder__${providerId}`,
          name: `${nodePrefix}/model-id`,
          value: `${nodePrefix}/model-id`,
          isPlaceholder: true
        }];

        groups[providerId] = {
          name: displayName,
          alias: nodePrefix,
          models: modelsToShow,
          isCustom: true,
          hasModels: mergedModels.length > 0
        };
      } else {
        const hardcodedModels = syncedModelLists[providerId] || getModelsByProviderId(providerId);
        const hardcodedIds = new Set(hardcodedModels.map((m) => m.id));

        // Custom models: if no hardcoded models (e.g. openrouter), show all aliases for this provider
        // Otherwise only show aliases where aliasName === modelId ("Add Model" button pattern)
        const hasHardcoded = hardcodedModels.length > 0;
        const customAliasModels = Object.entries(modelAliases).
        filter(([aliasName, fullModel]) =>
        isString(fullModel) &&
        fullModel.startsWith(`${alias}/`) && (
        hasHardcoded ? aliasName === fullModel.replace(`${alias}/`, "") : true) &&
        !hardcodedIds.has(fullModel.replace(`${alias}/`, ""))
        ).
        map(([aliasName, fullModel]) => {
          const modelId = fullModel.replace(`${alias}/`, "");
          return { id: modelId, name: aliasName, value: fullModel, isCustom: true };
        });

        // Custom models registered via /api/models/custom (provider "Add Model" button)
        const customAliasIds = new Set(customAliasModels.map((m) => m.id));
        const customRegisteredModels = customModels.
        filter((m) => m.providerAlias === alias && !hardcodedIds.has(m.id) && !customAliasIds.has(m.id)).
        map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}`, capabilities: m.capabilities, isCustom: true }));

        const merged = [
        ...hardcodedModels.map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m), capabilities: m.capabilities })),
        ...customAliasModels,
        ...customRegisteredModels,
        // The account's live catalog is offered next to the static registry: a
        // model the connected account can actually use must be selectable even
        // when the registry does not list it.
        ...liveCatalogModelEntries(alias, fetchedModels[providerId] || []).
        filter((m) => !hardcodedIds.has(m.id) && !customAliasIds.has(m.id))];

        // Dedupe by value (alias may equal hardcoded id, causing React key collision)
        const seen = new Set();
        let allModels = filterByKind(merged.filter((m) => {
          if (seen.has(m.value)) return false;
          seen.add(m.value);
          return true;
        }));

        // Provider-as-model fallback: providers that support the kind but have no hardcoded models
        // can still be picked (value = providerAlias). Skips embedding (always needs model).
        if (allModels.length === 0 && kindFilter && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
          const supports = (providerInfo.serviceKinds || ["llm"]).includes(kindFilter);
          if (supports) {
            allModels = [{ id: providerId, name: providerInfo.name, value: alias }];
          }
        }

        if (allModels.length > 0) {
          groups[providerId] = {
            name: providerInfo.name,
            alias: alias,
            models: allModels
          };
        }
      }
    });

    // Filter out disabled models per provider (disabled keyed by storage alias OR providerId)
    Object.entries(groups).forEach(([providerId, group]) => {
      const aliasKey = getProviderAlias(providerId);
      const disabledIds = new Set([
      ...(disabledModels[aliasKey] || []),
      ...(disabledModels[providerId] || [])]
      );
      if (disabledIds.size === 0) return;
      group.models = group.models.filter((m) => !disabledIds.has(m.id));
      if (group.models.length === 0) delete groups[providerId];
    });

    // #6495 / F-4: intersect with the server catalog's visible ids so the
    // hide-paid toggle (applied server-side) propagates to every picker. A null
    // set = not loaded / fetch failed → fail open (no filtering). The fetched
    // catalog matches the current kindFilter (root LLM list for the default
    // selector, /api/v1/models/{kind} for typed pickers). Synthetic
    // placeholders are not catalog rows and not evidence of paid status, so
    // they stay visible. Web provider-as-model rows are routed by providerId
    // but cataloged as `<alias>/search` / `<alias>/fetch`, so they match
    // against the cataloged id, not `m.value`.
    if (visibleModelIds) {
      const webSuffix = WEB_KIND_SUFFIX[kindFilter];
      Object.entries(groups).forEach(([providerId, group]) => {
        group.models = group.models.filter((m) => {
          if (m.isPlaceholder) return true;
          if (webSuffix) return visibleModelIds.has(`${group.alias}/${webSuffix}`);
          return visibleModelIds.has(m.value);
        });
        if (group.models.length === 0) delete groups[providerId];
      });
    }

    return groups;
  }, [filteredActiveProviders, modelAliases, allProviders, providerNodes, customModels, disabledModels, kindFilter, activeProviders, disabledFreeProviders, fetchedModels, visibleModelIds, orcaCatalog, syncedModelLists]);

  // Filter combos by search query (and hide combos when kindFilter is set — combos are LLM-only by design)
  const filteredCombos = useMemo(() => {
    if (kindFilter) return [];
    // #6495 / F-4: intersect with the server catalog's visible ids. The catalog
    // already omits all-paid combos and keeps mixed ones (with paid members
    // filtered), so a combo name present in the set is a visible combo. A null
    // set = not loaded / fetch failed → fail open (no filtering).
    let list = combos;
    if (visibleModelIds) list = list.filter((c) => visibleModelIds.has(c.name));
    if (!searchQuery.trim()) return list;
    const query = searchQuery.toLowerCase();
    return list.filter((c) => c.name.toLowerCase().includes(query));
  }, [combos, searchQuery, kindFilter, visibleModelIds]);

  // Choices that would make the edited combo reference itself. One already
  // added stays enabled so it can be removed.
  const circularCombos = getCircularComboNames(combos, comboContext);
  const isCircularChoice = (name) => circularCombos.has(name) && !addedModelValues.includes(name);
  const circularTitle = (name) => isCircularChoice(name) ? "Would create a circular combo" : undefined;

  // Sort models alphabetically, with added models floated to top
  const sortModels = (models) => {
    const added = models.filter((m) => addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    const rest = models.filter((m) => !addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    return [...added, ...rest];
  };

  // Filter models by search query
  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered = {};
    Object.entries(groupedModels).forEach(([providerId, group]) => {
      let models = group.models;
      if (query) {
        const providerNameMatches = group.name.toLowerCase().includes(query);
        models = models.filter(
          (m) =>
          m.name.toLowerCase().includes(query) ||
          m.id.toLowerCase().includes(query)
        );
        if (models.length === 0 && !providerNameMatches) return;
      }
      filtered[providerId] = {
        ...group,
        models: sortModels(models)
      };
    });

    return filtered;
  }, [groupedModels, searchQuery, addedModelValues]);

  const planConnections = filteredActiveProviders.filter((p) => p.provider === "chatgpt-plan" && p.id);
  const loadPlanModels = async () => {
    if (!planConnection || !planKey) return;
    const version = ++planRequestVersion.current;
    setPlanStatus("Loading models…");
    try {
      const response = await fetch(`/api/providers/${encodeURIComponent(planConnection)}/models`, {
        headers: { Authorization: `Bearer ${planKey}` }, cache: "no-store",
      });
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json();
      if (version !== planRequestVersion.current) return;
      setFetchedModels((previous) => ({ ...previous, "chatgpt-plan": data.models || [] }));
      setPlanStatus("Models loaded for the selected connection.");
    } catch {
      if (version !== planRequestVersion.current) return;
      setFetchedModels((previous) => ({ ...previous, "chatgpt-plan": [] }));
      setPlanStatus("Could not load models. Check the key and connection scope.");
    } finally {
      if (version === planRequestVersion.current) setPlanKey("");
    }
  };

  const handleSelect = (model) => {
    const value = model?.value || model?.name || model;
    const isAdded = addedModelValues.includes(value);

    if (isAdded && onDeselect) {
      onDeselect(model);
    } else {
      onSelect(model);
    }

    if (closeOnSelect) {
      planRequestVersion.current++;
      setPlanKey("");
      setFetchedModels((previous) => ({ ...previous, "chatgpt-plan": [] }));
      onClose();
      setSearchQuery("");
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={() => {
        planRequestVersion.current++;
        onClose();
        setSearchQuery("");
        setPlanKey("");
        setPlanStatus("");
        setFetchedModels((previous) => ({ ...previous, "chatgpt-plan": [] }));
      }}
      title={title}
      size={v5 ? "xl" : "md"}
      surfaceClassName={v5 ? "v5-model-picker" : undefined}
      className="p-0!"
      footer={null}
    >
      <div className="flex flex-col gap-4 px-1">
        {v5 && catalogError ? <p role="alert">{catalogError}</p> : null}
        <div role="status" className="flex items-center gap-2 rounded-dd-lg border border-dd-accent/30 bg-dd-accent-soft px-3 py-2 text-xs text-dd-text">
          <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-dd-accent">info</span>
          <span>Click to add, click again to remove. Changes are saved automatically.</span>
        </div>
        {planConnections.length > 0 && (!kindFilter || kindFilter === "llm") && (
          <div className="flex flex-col gap-2 rounded-dd-lg border border-dd-border p-3">
            <label htmlFor="plan-connection">ChatGPT plan connection</label>
            <select id="plan-connection" value={planConnection} onChange={(event) => { planRequestVersion.current++; setPlanStatus(""); setPlanConnection(event.target.value); setFetchedModels((previous) => ({ ...previous, "chatgpt-plan": [] })); }}>
              <option value="">Select a connection</option>
              {planConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name || connection.id}</option>)}
            </select>
            <label htmlFor="plan-key">Gateway API key scoped to this connection</label>
            <input id="plan-key" type="password" autoComplete="off" value={planKey} onChange={(event) => setPlanKey(event.target.value)} />
            <button type="button" onClick={loadPlanModels} disabled={!planConnection || !planKey}>Load plan models</button>
            <span role="status">{planStatus}</span>
          </div>
        )}
        {/* A degraded (fallback) OrcaRouter list is labelled rather than presented
            as live discovery. */}
        {orcaCatalog.models.length > 0 && orcaCatalog.degraded ? (
          <div
            role="status"
            data-testid="orca-catalog-degraded"
            className="flex items-center gap-2 rounded-dd-lg border border-dd-warning/30 bg-dd-surface-2 px-3 py-2 text-xs text-dd-muted"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-dd-warning">cloud_off</span>
            <span>OrcaRouter live catalog unavailable, showing a verified offline list. Reopen to retry.</span>
          </div>
        ) : null}
        <Input
          size="sm"
          icon="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search..."
          aria-label="Search models"
        />
        {v5 ? <>
          <label>Filter provider <select aria-label="Filter provider" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}><option value="all">All providers</option><option value="combos">Nested combos</option>{Object.entries(groupedModels).map(([id, group]) => <option key={id} value={id}>{group.name}</option>)}</select></label>
          <div className={`v5-model-picker-layout ${closeOnSelect ? "v5-model-picker-single" : ""}`}>
            <div className="v5-model-picker-catalog" role="region" aria-label="Available model catalog" tabIndex={0}>
              <div className="v5-model-picker-results" role="status">{discoveryPending || !visibleCatalogReady ? "Loading models…" : "Available models"}</div>
              {(providerFilter === "all" || providerFilter === "combos") && filteredCombos.length > 0 ? <section aria-label="Combos"><h3>Nested combos <span>{filteredCombos.length}</span></h3>{filteredCombos.map((combo) => <button key={combo.id} type="button" className="v5-model-picker-row disabled:cursor-not-allowed disabled:opacity-40" disabled={isCircularChoice(combo.name)} title={circularTitle(combo.name)} aria-pressed={addedModelValues.includes(combo.name) || selectedModel === combo.name} onClick={() => handleSelect({ id: combo.name, name: combo.name, value: combo.name })}>{combo.name}</button>)}</section> : null}
              {Object.entries(filteredGroups).filter(([id]) => providerFilter === "all" || providerFilter === id).map(([id, group]) => <section key={id} aria-label={group.name}><h3><ProviderLogo provider={id} size={18} />{group.name}<span>{group.models.length}</span></h3>{group.models.map((model) => {
                const custom = customModels.find((item) => item.id === model.id && (item.providerAlias === id || item.providerAlias === group.alias));
                const caps = { ...getCaps(model.value) };
                if (!Array.isArray(model.capabilities)) Object.assign(caps, model.capabilities);
                Object.assign(caps, custom?.capabilities);
                return <button key={model.value} type="button" className="v5-model-picker-row" aria-label={model.name === model.value ? model.name : `${model.name} (${model.value})`} aria-pressed={addedModelValues.includes(model.value) || selectedModel === model.value} onClick={() => handleSelect(model)}><span className="v5-model-check" aria-hidden="true">{addedModelValues.includes(model.value) || selectedModel === model.value ? "✓" : ""}</span><span className="v5-model-picker-identity"><strong>{model.name}</strong>{model.value !== model.name ? <code>{model.value}</code> : null}<CapabilityIcons caps={caps} />{model.isPlaceholder ? <span>Custom ID</span> : null}</span></button>;
              })}</section>)}
              {visibleCatalogReady && !discoveryPending && !Object.entries(filteredGroups).some(([id, group]) => (providerFilter === "all" || providerFilter === id) && group.models.length) && !((providerFilter === "all" || providerFilter === "combos") && filteredCombos.length) ? <EmptyState icon="search_off" title="No models found" message="Try a different search or connect a new provider." /> : null}
            </div>
            {!closeOnSelect ? <aside className="v5-model-picker-selection" aria-label="Selected models"><h3>Selected <span>{addedModelValues.length}</span></h3>{addedModelValues.length === 0 ? <p>Select models from the catalog.</p> : <ol>{addedModelValues.map((value, index) => <li key={`${value}-${index}`}><span>{index + 1}</span><code>{value}</code>{onDeselect ? <button type="button" aria-label={`Remove ${value} from selection`} onClick={() => onDeselect({ id: value, name: value, value })}>×</button> : null}</li>)}</ol>}</aside> : null}
          </div>
        </> : <div className="max-h-[400px] space-y-3 overflow-y-auto pr-1">
          {filteredCombos.length > 0 ? <section aria-label="Combos"><header className="sticky top-0 z-10 flex items-center gap-1.5 bg-dd-surface py-1"><span aria-hidden="true" className="material-symbols-outlined text-[14px] text-dd-accent">layers</span><span className="text-xs font-semibold text-dd-accent">Combos</span><span className="text-[10px] text-dd-muted">({filteredCombos.length})</span></header><div className="mt-2 flex flex-wrap gap-1.5">{filteredCombos.map((combo) => {
            const isSelected = selectedModel === combo.name;
            const isAdded = addedModelValues.includes(combo.name);
            return <Chip key={combo.id} size="sm" className="disabled:cursor-not-allowed disabled:opacity-40" disabled={isCircularChoice(combo.name)} title={circularTitle(combo.name)} icon={isAdded ? "check" : undefined} selected={isSelected || isAdded} onClick={() => handleSelect({ id: combo.name, name: combo.name, value: combo.name })} label={<span className="inline-flex items-center gap-1.5">{combo.name}<CapacityBadges caps={getCaps(combo.name)} colorOverride="text-dd-muted" size={12} /></span>} />;
          })}</div></section> : null}
          {Object.entries(filteredGroups).map(([providerId, group]) => <section key={providerId} aria-label={group.name}><header className="sticky top-0 z-10 flex items-center gap-1.5 bg-dd-surface py-1"><ProviderLogo provider={providerId} size={14} className="rounded-dd" /><span className="text-xs font-semibold text-dd-accent">{group.name}</span><span className="text-[10px] text-dd-muted">({group.models.length})</span></header><div className="mt-2 flex flex-wrap gap-1.5">{group.models.map((model) => {
            const isSelected = selectedModel === model.value;
            const isPlaceholder = model.isPlaceholder;
            const isAdded = addedModelValues.includes(model.value);
            const customOverride = customModels.find((m) => m.id === model.id && (m.providerAlias === providerId || m.providerAlias === group.alias));
            const liveCaps = Array.isArray(model.capabilities) ? null : model.capabilities;
            const caps = { ...getCaps(model.value), ...liveCaps, ...customOverride?.capabilities };
            return <Chip key={model.value} size="sm" icon={isAdded && !isPlaceholder ? "check" : undefined} selected={isSelected || isAdded} onClick={() => handleSelect(model)} title={isPlaceholder ? "Select to pre-fill, then edit model ID in the input" : undefined} label={isPlaceholder ? <span className="inline-flex items-center gap-1 italic text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined text-[12px]">edit</span>{model.name}</span> : <span className="inline-flex items-center gap-1">{model.name}{model.isCustom ? <span className="text-xs font-normal text-dd-muted">custom</span> : null}{model.isFetched ? <span className="text-xs font-normal text-dd-muted">auto</span> : null}<CapacityBadges caps={caps} colorOverride="text-dd-muted" size={12} /></span>} />;
          })}</div></section>)}
          <div role="status" aria-atomic="true">
            {visibleCatalogReady && Object.keys(filteredGroups).length === 0 && filteredCombos.length === 0 ? <EmptyState icon="search_off" title="No models found" message="Try a different search or connect a new provider." /> : null}
          </div>
        </div>}
      </div>
    </Modal>);

}

ModelSelectModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  onDeselect: PropTypes.func,
  selectedModel: PropTypes.string,
  activeProviders: PropTypes.arrayOf(
    PropTypes['shape']({
      provider: PropTypes.string.isRequired
    })
  ),
  title: PropTypes.string,
  modelAliases: PropTypes.object,
  kindFilter: PropTypes.string,
  addedModelValues: PropTypes.arrayOf(PropTypes.string),
  closeOnSelect: PropTypes.bool,
  comboContext: PropTypes.object
};
