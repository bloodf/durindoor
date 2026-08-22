"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Button, Badge, Input, Modal, CardSkeleton, OAuthModal, KiroOAuthWrapper, CursorAuthModal, ImportTokenModal, IFlowCookieModal, GitLabAuthModal, Toggle, Select, EditConnectionModal, NoAuthProxyCard, ConfirmModal, ProviderIcon } from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { toCodexPlanEntry, buildCodexPlanMap } from "@/shared/utils/codexPlanLabel";
import { translate } from "@/i18n/runtime";
import { fetchSuggestedModels } from "@/shared/utils/providerModelsFetcher";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import { shouldShowProviderConnections } from "@/shared/utils/providerAuthMode";
import { buildImportTokenPayload, isImportTokenOAuthProvider } from "@/shared/utils/importTokenProviders";
import { createLatestIntentQueue } from "@/shared/utils/latestIntentQueue";
import ModelRow from "./ModelRow";
import PassthroughModelsSection from "./PassthroughModelsSection";
import CompatibleModelsSection from "./CompatibleModelsSection";
import ConnectionRow from "./ConnectionRow";
import AddApiKeyModal from "./AddApiKeyModal";
import { apiKeyConnectionNames } from "./apiKeyConnectionName";
import EditCompatibleNodeModal from "./EditCompatibleNodeModal";
import { updateCompatibleProviderNode } from "./updateCompatibleProviderNode";
import AddCustomModelModal from "./AddCustomModelModal";
import BulkImportCodexModal from "./BulkImportCodexModal";
import { getProviderThinkingLevels } from "./providerThinkingLevels";
import { getCustomModelCapabilities } from "./customModelCapabilities";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getThinkingLevelsFromCapabilities } from "open-sse/providers/thinkingLevels.js";
import { sortConnectionsByAvailability, persistConnectionOrder } from "@/shared/utils/connectionReorder";
import { replaceUpdatedConnections } from "@/shared/utils/connectionStatus";

const ONE_BY_ONE_DELAY_MS = 1000;

const AUTO_PING_SETTINGS_KEYS = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};
/** Static retry delays offered by decolua/9router#2895; Auto keeps provider reset/backoff behavior. */
const RETRY_DELAY_OPTIONS = [
  ["auto", "Retry: Auto"],
  ["15", "Retry: 15s"],
  ["30", "Retry: 30s"],
  ["60", "Retry: 1m"],
  ["120", "Retry: 2m"],
  ["300", "Retry: 5m"],
  ["600", "Retry: 10m"],
  ["1800", "Retry: 30m"],
  ["3600", "Retry: 1h"],
];


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function ProviderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const providerId = params.id;
  const currentProviderIdRef = useRef(null);
  const fetchConnectionsGenerationRef = useRef(0);
  const { getCaps } = useModelCaps();
  const [connections, setConnections] = useState([]);
  /** connectionId → live Codex plan from the usage API (decolua/9router#3210). */
  const [codexPlans, setCodexPlans] = useState({});
  const [providerApiKeyConnectionNames, setProviderApiKeyConnectionNames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    currentProviderIdRef.current = providerId;
    // Clear the previous provider's rows immediately on switch. Without this the
    // old connections and plan badges stay rendered under the new provider's
    // header until its fetch resolves — and a stale in-flight response is
    // discarded rather than clearing them, so they can persist indefinitely.
    setConnections([]);
    setCodexPlans({});
    setProviderApiKeyConnectionNames([]);
    setLoading(true);
  }, [providerId]);
  const [providerNode, setProviderNode] = useState(null);
  const [proxyPools, setProxyPools] = useState([]);
  const [proxyPoolsReadyForProvider, setProxyPoolsReadyForProvider] = useState(null);
  const proxyPoolsReady = proxyPoolsReadyForProvider === providerId;
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  // When set, the open OAuth modal replaces this existing connection in place
  // (the Reconnect flow) instead of creating a new row. Cleared on close/success.
  const [reconnectConnectionId, setReconnectConnectionId] = useState(null);
  const [showIFlowCookieModal, setShowIFlowCookieModal] = useState(false);
  const [showImportTokenModal, setShowImportTokenModal] = useState(false);
  const [importTokenValue, setImportTokenValue] = useState("");
  const [importTokenError, setImportTokenError] = useState("");
  const [importingToken, setImportingToken] = useState(false);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
  const [addConnectionError, setAddConnectionError] = useState("");
  const [showBulkImportCodex, setShowBulkImportCodex] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState(false);
  const [showBulkProxyModal, setShowBulkProxyModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [modelAliases, setModelAliases] = useState({});
  const [customModels, setCustomModels] = useState([]);
  const [modelTestResults, setModelTestResults] = useState({});
  const [modelsTestError, setModelsTestError] = useState("");
  const [testingModelIds, setTestingModelIds] = useState(() => new Set());
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const [editingCustomModel, setEditingCustomModel] = useState(null);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState([]);
  const [bulkProxyPoolId, setBulkProxyPoolId] = useState("__none__");
  const [bulkUpdatingProxy, setBulkUpdatingProxy] = useState(false);
  const [bulkStatusAction, setBulkStatusAction] = useState(null);
  const [providerStrategy, setProviderStrategy] = useState(null);
  const [providerStickyLimit, setProviderStickyLimit] = useState("");
  const [thinkingMode, setThinkingMode] = useState("auto");
  const [concurrencyLimit, setConcurrencyLimit] = useState("");
  const [retryDelay, setRetryDelay] = useState("auto");
  const [autoPing, setAutoPing] = useState({ enabled: false, connections: {} });
  const [autoPingQueue] = useState(() => createLatestIntentQueue({
      write: async (_key, enabled, { connectionId }) => {
        const response = await fetch(`/api/providers/${encodeURIComponent(connectionId)}/auto-ping`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        if (!response.ok) throw new Error(`Auto-ping update failed (${response.status})`);
        return response.json();
      },
      onOptimistic: (_key, enabled, { connectionId }) => setAutoPing((current) => ({
        ...current,
        connections: { ...current.connections, [connectionId]: enabled },
      })),
      onConfirmed: (_key, enabled, { connectionId }) => setAutoPing((current) => ({
        ...current,
        connections: { ...current.connections, [connectionId]: enabled },
      })),
      onRollback: (_key, enabled, { connectionId }, error) => {
        console.log("Error saving auto-ping config:", error);
        setAutoPing((current) => ({
          ...current,
          connections: { ...current.connections, [connectionId]: enabled },
        }));
      },
    }));
  const [suggestedModels, setSuggestedModels] = useState([]);
  const [syncingModels, setSyncingModels] = useState(false);
  const [modelsFetchedAt, setModelsFetchedAt] = useState(null);
  const [kiloFreeModels, setKiloFreeModels] = useState([]);
  const [disabledModelIds, setDisabledModelIds] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [showAgRiskModal, setShowAgRiskModal] = useState(false);
  const [oneByOneRunning, setOneByOneRunning] = useState(false);
  const [oneByOneStopping, setOneByOneStopping] = useState(false);
  const [oneByOneCurrentConnectionId, setOneByOneCurrentConnectionId] = useState(null);
  const [oneByOneResults, setOneByOneResults] = useState({});
  const [oneByOneSummary, setOneByOneSummary] = useState(null);
  const stopOneByOneRef = useRef(false);
  const [importingQoderModels, setImportingQoderModels] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const AG_RISK_STORAGE_KEY = "ag_risk_confirmed";

  const openOAuthConnection = () => {
    if (isImportTokenOAuthProvider(providerId)) {
      setImportTokenError("");
      setShowImportTokenModal(true);
      return;
    }
    setShowOAuthModal(true);
  };

  const triggerOAuthConnection = () => {
    if (providerId === "antigravity" && typeof window !== "undefined") {
      const confirmed = window.localStorage.getItem(AG_RISK_STORAGE_KEY) === "true";
      if (!confirmed) {
        setShowAgRiskModal(true);
        return;
      }
    }
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  const triggerApiKeyConnection = () => {
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  const triggerAddConnection = () => {
    if (isImportToken) {
      openOAuthConnection();
      return;
    }
    if (isOAuth) {
      triggerOAuthConnection();
      return;
    }
    triggerApiKeyConnection();
  };

  const handleAgRiskConfirm = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AG_RISK_STORAGE_KEY, "true");
    }
    setShowAgRiskModal(false);
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    triggerApiKeyConnection();
  };

  const providerInfo = providerNode
    ? {
        id: providerNode.id,
        name: providerNode.name || (providerNode.type === "anthropic-compatible" ? "Anthropic Compatible" : "OpenAI Compatible"),
        color: providerNode.type === "anthropic-compatible" ? "#D97757" : "#10A37F",
        textIcon: providerNode.type === "anthropic-compatible" ? "AC" : "OC",
        apiType: providerNode.apiType,
        baseUrl: providerNode.baseUrl,
        type: providerNode.type,
        ...(providerNode.iconUrl ? { iconUrl: providerNode.iconUrl } : {}),
      }
    : (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId] || WEB_COOKIE_PROVIDERS[providerId]);
  const authModes = providerInfo?.authModes || [];
  const isImportToken = providerInfo?.flowType === "import_token";
  const isOAuth = !!OAUTH_PROVIDERS[providerId] || authModes.includes("oauth") || FREE_PROVIDERS[providerId]?.oauth;
  const supportsApiKeyAuth = !!APIKEY_PROVIDERS[providerId] || authModes.includes("apikey");
  const isFreeNoAuth = !!FREE_PROVIDERS[providerId]?.noAuth;
  const isStoredNoAuth = isFreeNoAuth && providerId === "mimocode";
  const showConnections = shouldShowProviderConnections(providerInfo, { storedNoAuth: isStoredNoAuth });
  const models = getModelsByProviderId(providerId);
  const providerAlias = getProviderAlias(providerId);
  
  const isOpenAICompatible = isOpenAICompatibleProvider(providerId);
  const isAnthropicCompatible = isAnthropicCompatibleProvider(providerId);
  const isCompatible = isOpenAICompatible || isAnthropicCompatible;
  const hasDualAuthModes = !isCompatible && isOAuth && supportsApiKeyAuth;
  const oauthConnectionLabel =
    providerId === "xai"
      ? "Grok Build OAuth"
      : providerId === "grok-cli"
        ? "Grok CLI Device Login"
        : "OAuth";
  const apiKeyConnectionLabel = providerId === "xai" ? "xAI API Key" : "API Key";
  // Resolve suffix "(level)" for a model when a thinking level is picked and the model supports it.
  // Upstream decolua/9router#2534: "none" suppresses the suffix (explicit strip, not a level label).
  const resolveThinkingSuffix = (modelId, customCaps) => {
    if (!thinkingMode || thinkingMode === "auto" || thinkingMode === "none") return null;
    const caps = getCustomModelCapabilities({ providerId, modelId, capabilities: customCaps });
    const levels = getThinkingLevelsFromCapabilities(caps, providerId, modelId);
    return levels && levels.includes(thinkingMode) ? thinkingMode : null;
  };
  const providerStorageAlias = isCompatible ? providerId : providerAlias;
  // Union of levels across this provider's reasoning models — drives the level picker options.
  // Include custom models too (e.g. manually added gpt-5.6-sol → max).
  const providerThinkingLevels = getProviderThinkingLevels({
    providerId,
    models,
    kiloFreeModels,
    customModels,
    providerStorageAlias,
  });

  const providerDisplayAlias = isCompatible
    ? (providerNode?.prefix || providerId)
    : providerAlias;

  const fetchDisabledModels = useCallback(async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDisabledModelIds(data.ids || []);
    } catch (error) {
      console.log("Error fetching disabled models:", error);
    }
  }, [providerStorageAlias]);

  const handleDisableModel = async (modelId) => {
    try {
      const res = await fetch("/api/models/disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, ids: [modelId] }),
      });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.log("Error disabling model:", error);
    }
  };

  const handleEnableModel = async (modelId) => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}&id=${encodeURIComponent(modelId)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.log("Error enabling model:", error);
    }
  };

  const handleDisableAll = async (ids) => {
    if (!ids.length) return;
    setConfirmState({
      title: "Disable All Models",
      message: `Disable all ${ids.length} model(s)?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch("/api/models/disabled", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerAlias: providerStorageAlias, ids }),
          });
          if (res.ok) await fetchDisabledModels();
        } catch (error) {
          console.log("Error disabling all models:", error);
        }
      }
    });
  };

  const handleEnableAll = async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.log("Error enabling all models:", error);
    }
  };

  // Define callbacks BEFORE the useEffect that uses them
  const fetchAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) {
        setModelAliases(data.aliases || {});
      }
    } catch (error) {
      console.log("Error fetching aliases:", error);
    }
  }, []);

  const fetchCustomModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models/custom", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setCustomModels(data.models || []);
      }
    } catch (error) {
      console.log("Error fetching custom models:", error);
    }
  }, []);

  // Fetch free models from Kilo API for kilocode provider
  useEffect(() => {
    if (providerId !== "kilocode") return;
    fetch("/api/providers/kilo/free-models")
      .then((res) => res.json())
      .then((data) => { if (data.models?.length) setKiloFreeModels(data.models); })
      .catch(() => {});
  }, [providerId]);

  const fetchConnections = useCallback(async () => {
    const requestProviderId = providerId;
    const requestGeneration = ++fetchConnectionsGenerationRef.current;
    const isCurrentRequest = () =>
      fetchConnectionsGenerationRef.current === requestGeneration &&
      currentProviderIdRef.current === requestProviderId;
    try {
      const [connectionsRes, nodesRes, proxyPoolsRes, settingsRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/provider-nodes", { cache: "no-store" }),
        fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const connectionsData = await connectionsRes.json();
      const nodesData = await nodesRes.json();
      const proxyPoolsData = await proxyPoolsRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      if (!isCurrentRequest()) return;
      if (connectionsRes.ok) {
        const allConnections = connectionsData.connections || [];
        const filtered = allConnections.filter(c => c.provider === providerId);

        // Codex plan badges prefer the live usage plan; the connection's stored
        // OAuth metadata is only written at authorization time, so it goes stale
        // after an upgrade. Fails open per connection — a failed read leaves the
        // stored value to serve as the fallback (decolua/9router#3210).
        //
        // Computed BEFORE any setState so the whole group lands atomically after
        // one staleness check: setting rows first and bailing afterwards would
        // leave a switched-away provider's connections rendered.
        let plans = {};
        if (providerId === "codex" && filtered.length > 0) {
          const entries = await Promise.all(filtered.map(async (connection) => {
            try {
              const usageRes = await fetch(`/api/usage/${connection.id}`);
              if (!usageRes.ok) return null;
              return toCodexPlanEntry(connection.id, await usageRes.json());
            } catch {
              return null;
            }
          }));
          plans = buildCodexPlanMap(entries);
        }

        if (!isCurrentRequest()) return;
        setConnections(filtered);
        setCodexPlans(plans);
        // #6499 — the name-based collision scope in createProviderConnection is
        // (provider, authType=apikey, name): provider-local. Derive default-name
        // candidates from THIS provider's apikey connections only; using global
        // names would pointlessly skip "main" just because another provider took it.
        setProviderApiKeyConnectionNames(apiKeyConnectionNames(filtered));
      }
      if (proxyPoolsRes.ok) {
        setProxyPools(proxyPoolsData.proxyPools || []);
      }
      // Load per-provider strategy override
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProviderStrategy(override.fallbackStrategy || null);
      setProviderStickyLimit(override.stickyRoundRobinLimit != null ? String(override.stickyRoundRobinLimit) : "1");
      // Load per-provider thinking config
      const thinkingCfg = (settingsData.providerThinking || {})[providerId] || {};
      setThinkingMode(thinkingCfg.mode || "auto");
      // Load per-provider concurrency limit
      const cLimit = (settingsData.providerConcurrencyLimits || {})[providerId];
      setConcurrencyLimit(cLimit != null ? String(cLimit) : "");
      const selectedRetryDelay = (settingsData.retryDelayByProvider || {})[providerId];
      setRetryDelay(selectedRetryDelay != null ? String(selectedRetryDelay) : "auto");
      const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
      const apCfg = autoPingSettingsKey ? settingsData[autoPingSettingsKey] || {} : {};
      autoPingQueue.hydrate(
        Object.entries(apCfg.connections || {}).map(([id, enabled]) => [`${providerId}:${id}`, enabled]),
      );
      setAutoPing({ enabled: apCfg.enabled === true, connections: apCfg.connections || {} });
      if (nodesRes.ok) {
        let node = (nodesData.nodes || []).find((entry) => entry.id === providerId) || null;

        // Newly created compatible nodes can be briefly unavailable on one worker.
        // Retry a few times before showing "Provider not found".
        if (!node && isCompatible) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            if (!isCurrentRequest()) return;
            const retryRes = await fetch("/api/provider-nodes", { cache: "no-store" });
            if (!retryRes.ok) continue;
            const retryData = await retryRes.json();
            node = (retryData.nodes || []).find((entry) => entry.id === providerId) || null;
            if (node) break;
          }
        }

        if (isCurrentRequest()) setProviderNode(node);
      }
    } catch (error) {
      if (isCurrentRequest()) console.log("Error fetching connections:", error);
    } finally {
      // OAuth defaults to an explicit direct route, but must not start before
      // the selectable strict pools have either loaded or definitively failed.
      if (isCurrentRequest()) {
        setProxyPoolsReadyForProvider(requestProviderId);
        setLoading(false);
      }
    }
  }, [providerId, isCompatible, autoPingQueue]);

  const handleUpdateNode = async (formData) => {
    await updateCompatibleProviderNode({
      providerId,
      formData,
      onSuccess: async (node) => {
        setProviderNode(node);
        await fetchConnections();
        setShowEditNodeModal(false);
      },
    });
  };

  const saveProviderStrategy = async (strategy, stickyLimit) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerStrategies || {};

      // Build override: null strategy means remove override, use global
      const override = {};
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") {
        override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
      }

      const updated = { ...current };
      if (Object.keys(override).length === 0) {
        delete updated[providerId];
      } else {
        updated[providerId] = override;
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
    } catch (error) {
      console.log("Error saving provider strategy:", error);
    }
  };

  const handleRoundRobinToggle = (enabled) => {
    const strategy = enabled ? "round-robin" : null;
    const sticky = enabled ? (providerStickyLimit || "1") : providerStickyLimit;
    if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
    setProviderStrategy(strategy);
    saveProviderStrategy(strategy, sticky);
  };

  const handleStickyLimitChange = (value) => {
    setProviderStickyLimit(value);
    saveProviderStrategy("round-robin", value);
  };

  const saveThinkingConfig = async (mode) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerThinking || {};
      const updated = { ...current };
      if (!mode || mode === "auto") {
        delete updated[providerId];
      } else {
        updated[providerId] = { mode };
      }
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerThinking: updated }),
      });
    } catch (error) {
      console.log("Error saving thinking config:", error);
    }
  };

  const handleThinkingModeChange = (mode) => {
    setThinkingMode(mode);
    saveThinkingConfig(mode);
  };

  const saveConcurrencyLimit = async (value) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerConcurrencyLimits || {};
      const updated = { ...current };
      const numVal = parseInt(value, 10);
      if (value && Number.isFinite(numVal) && numVal > 0) {
        updated[providerId] = numVal;
      } else {
        delete updated[providerId];
      }
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerConcurrencyLimits: updated }),
      });
    } catch (error) {
      console.log("Error saving concurrency limit:", error);
    }
  };

  const handleConcurrencyLimitChange = (value) => {
    setConcurrencyLimit(value);
    saveConcurrencyLimit(value);
  };
  const saveRetryDelay = async (value) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const updated = { ...(settingsData.retryDelayByProvider || {}) };
      if (value === "auto") delete updated[providerId];
      else updated[providerId] = Number(value);
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryDelayByProvider: updated }),
      });
    } catch (error) {
      console.log("Error saving retry delay:", error);
    }
  };

  const handleRetryDelayChange = (value) => {
    setRetryDelay(value);
    saveRetryDelay(value);
  };


  const handleAutoPingConnection = (connectionId, on) => {
    if (!AUTO_PING_SETTINGS_KEYS[providerId]) return;
    autoPingQueue.enqueue(`${providerId}:${connectionId}`, on, { connectionId });
  };

  useEffect(() => {
    fetchConnections();
    fetchAliases();
    fetchCustomModels();
    fetchDisabledModels();
  }, [fetchConnections, fetchAliases, fetchCustomModels, fetchDisabledModels]);

  // Fetch suggested models from provider's public API (if configured)
  useEffect(() => {
    const fetcher = (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId])?.modelsFetcher;
    if (!fetcher) return;
    fetchSuggestedModels(fetcher).then(setSuggestedModels);
  }, [providerId]);

  const handleSyncModels = async () => {
    const fetcher = (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId])?.modelsFetcher;
    if (!fetcher) return;
    setSyncingModels(true);
    try {
      setSuggestedModels(await fetchSuggestedModels(fetcher, { force: true }));
      setModelsFetchedAt(new Date());
    } finally {
      setSyncingModels(false);
    }
  };

  const handleSetAlias = async (modelId, alias, providerAliasOverride = providerAlias) => {
    const fullModel = `${providerAliasOverride}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) {
        await fetchAliases();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to set alias");
      }
    } catch (error) {
      console.log("Error setting alias:", error);
    }
  };

  const handleDeleteAlias = async (alias) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchAliases();
      }
    } catch (error) {
      console.log("Error deleting alias:", error);
    }
  };

  const handleAddCustomModel = async (payload, type = "llm", providerAliasOverride = providerStorageAlias) => {
    const modelId = typeof payload === "string" ? payload : payload.id;
    const capabilities = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload.capabilities : undefined;
    try {
      const res = await fetch("/api/models/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerAliasOverride, id: modelId, type, capabilities }),
      });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
        return;
      }
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to add custom model");
    } catch (error) {
      // Rethrow so callers (capability editor, quick-add rows) surface it.
      throw error instanceof Error ? error : new Error("Failed to add custom model");
    }
  };

  const handleUpdateCustomModel = async ({ id, capabilities }) => {
    try {
      const res = await fetch("/api/models/custom", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, id, type: "llm", capabilities }),
      });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
        return;
      }
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to update custom model");
    } catch (error) {
      // Rethrow so the capability editor stays open and shows the message.
      throw error instanceof Error ? error : new Error("Failed to update custom model");
    }
  };

  const handleDeleteCustomModel = async (modelId, type = "llm", providerAliasOverride = providerStorageAlias) => {
    try {
      const params = new URLSearchParams({ providerAlias: providerAliasOverride, id: modelId, type });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (error) {
      console.log("Error deleting custom model:", error);
    }
  };

  // Fetch Qoder model list and automatically add to available models
  const handleImportQoderModels = async () => {
    if (importingQoderModels) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) {
      alert(translate("Please add an active Qoder connection first"));
      return;
    }

    setImportingQoderModels(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || translate("Failed to fetch models"));
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert(translate("No models returned"));
        return;
      }

      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name;
        if (!modelId) continue;
        
        // Qoder model ID format may be "qoder/auto" or "auto", need to remove prefix
        const cleanModelId = modelId.replace(/^qoder\//, "");
        const alreadyExists = customModels.some(
          (entry) => entry.providerAlias === providerStorageAlias && entry.id === cleanModelId && (entry.kind || entry.type || "llm") === "llm"
        ) || Object.values(modelAliases).includes(`${providerStorageAlias}/${cleanModelId}`);
        if (alreadyExists) {
          continue;
        }

        await handleAddCustomModel(cleanModelId, "llm", providerStorageAlias);
        importedCount += 1;
      }
      
      if (importedCount === 0) {
        alert(translate("All models already exist, no new models added"));
      } else {
        alert(translate("Successfully added") + ` ${importedCount} ` + translate("models"));
      }
    } catch (error) {
      console.log("Error importing Qoder models:", error);
      alert(translate("Error fetching models") + ": " + error.message);
    } finally {
      setImportingQoderModels(false);
    }
  };

  const handleRunOneByOneTest = async () => {
    if (oneByOneRunning || connections.length === 0) return;

    const queuedState = Object.fromEntries(
      connections.map((connection) => [connection.id, { state: "queued", error: null }]),
    );

    stopOneByOneRef.current = false;
    setOneByOneRunning(true);
    setOneByOneStopping(false);
    setOneByOneCurrentConnectionId(null);
    setOneByOneResults(queuedState);
    setOneByOneSummary({ total: connections.length, completed: 0, passed: 0, failed: 0, stopped: false });

    let passed = 0;
    let failed = 0;

    try {
      for (let index = 0; index < connections.length; index += 1) {
        if (stopOneByOneRef.current) {
          setOneByOneSummary({
            total: connections.length,
            completed: index,
            passed,
            failed,
            stopped: true,
          });
          break;
        }

        const connection = connections[index];
        setOneByOneCurrentConnectionId(connection.id);
        setOneByOneResults((prev) => ({
          ...prev,
          [connection.id]: { state: "testing", error: null },
        }));

        try {
          const res = await fetch(`/api/providers/${connection.id}/test`, { method: "POST" });
          const data = await res.json();
          const valid = !!data.valid;

          if (valid) {
            passed += 1;
          } else {
            failed += 1;
          }

          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: valid ? "success" : "failed",
              error: valid ? null : (data.error || null),
            },
          }));
        } catch (error) {
          failed += 1;
          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: "failed",
              error: error.message || "Test failed",
            },
          }));
        }

        setOneByOneSummary({
          total: connections.length,
          completed: index + 1,
          passed,
          failed,
          stopped: false,
        });

        if (index < connections.length - 1) {
          await sleep(ONE_BY_ONE_DELAY_MS);
        }
      }
    } finally {
      setOneByOneCurrentConnectionId(null);
      setOneByOneRunning(false);
      setOneByOneStopping(false);
      stopOneByOneRef.current = false;
    }
  };

  const handleStopOneByOneTest = () => {
    if (!oneByOneRunning) return;
    stopOneByOneRef.current = true;
    setOneByOneStopping(true);
  };

  const handleDelete = async (id) => {
    setConfirmState({
      title: "Delete Connection",
      message: "Delete this connection?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
          if (res.ok) {
            setConnections(prev => prev.filter(c => c.id !== id));
          }
        } catch (error) {
          console.log("Error deleting connection:", error);
        }
      }
    });
  };

  const handleBulkDelete = () => {
    const count = selectedConnectionIds.length;
    if (count === 0) return;
    setConfirmState({
      title: `Delete ${count} Connection${count > 1 ? "s" : ""}`,
      message: `Delete ${count} connection${count > 1 ? "s" : ""}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmState(null);
        let failed = 0;
        const idsToDelete = [...selectedConnectionIds];
        for (const id of idsToDelete) {
          try {
            const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
            if (!res.ok) failed += 1;
          } catch (error) {
            console.log("Error deleting connection:", error);
            failed += 1;
          }
        }
        setConnections(prev => prev.filter(c => !idsToDelete.includes(c.id)));
        setSelectedConnectionIds([]);
        if (failed > 0) alert(`Deleted ${idsToDelete.length - failed} connection(s), ${failed} failed.`);
      }
    });
  };

  const handleOAuthSuccess = () => {
    fetchConnections();
    setShowOAuthModal(false);
    setReconnectConnectionId(null);
  };

  // Reconnect an expired OAuth account: re-run the same OAuth flow but stamp the
  // target connection id so completion replaces the failed row in place.
  const handleReconnect = (conn) => {
    setReconnectConnectionId(conn.id);
    openOAuthConnection();
  };

  const handleIFlowCookieSuccess = () => {
    fetchConnections();
    setShowIFlowCookieModal(false);
  };

  const handleImportTokenSubmit = async () => {
    setImportTokenError("");
    const payload = buildImportTokenPayload(importTokenValue);
    if (!payload) {
      setImportTokenError("Paste a Grok CLI auth.json file, raw JWT, or structured token body.");
      return;
    }

    setImportingToken(true);
    try {
      const res = await fetch(`/api/oauth/${providerId}/import-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Import failed (${res.status})`);
      }
      setImportTokenValue("");
      setShowImportTokenModal(false);
      await fetchConnections();
    } catch (error) {
      setImportTokenError(error.message || "Failed to import token");
    } finally {
      setImportingToken(false);
    }
  };

  const handleSaveApiKey = async (formData) => {
    setAddConnectionError("");
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, ...formData }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (res.ok) {
        await fetchConnections();
        setShowAddApiKeyModal(false);
        return;
      }

      setAddConnectionError(data?.error || "Failed to save connection");
    } catch (error) {
      console.log("Error saving connection:", error);
      setAddConnectionError("Failed to save connection");
    }
  };

  const handleUpdateConnection = async (formData) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        await fetchConnections();
        setShowEditModal(false);
      }
    } catch (error) {
      console.log("Error updating connection:", error);
    }
  };

  const handleUpdateConnectionStatus = async (id, isActive) => {
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        const { connection } = await res.json();
        if (connection) setConnections((prev) => replaceUpdatedConnections(prev, [connection]));
      }
    } catch (error) {
      console.log("Error updating connection status:", error);
    }
  };

  const handleBulkSetConnectionStatus = async (isActive) => {
    const idsToUpdate = [...selectedConnectionIds];
    if (idsToUpdate.length === 0) return;

    setBulkStatusAction(isActive ? "on" : "off");
    try {
      const results = await Promise.all(
        idsToUpdate.map(async (id) => {
          try {
            const res = await fetch(`/api/providers/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isActive }),
            });
            if (!res.ok) return { id, ok: false };
            const { connection } = await res.json();
            return { id, ok: true, connection };
          } catch (error) {
            console.log("Error updating connection status:", error);
            return { id, ok: false };
          }
        })
      );

      const successfulConnections = results
        .filter((result) => result.ok && result.connection)
        .map((result) => result.connection);
      const successfulIds = results.filter((result) => result.ok).map((result) => result.id);
      const failed = results.length - successfulIds.length;

      if (successfulConnections.length > 0) {
        setConnections((prev) => replaceUpdatedConnections(prev, successfulConnections));
      }

      if (failed > 0) {
        alert(`${isActive ? "Enabled" : "Disabled"} ${successfulIds.length} connection(s), ${failed} failed.`);
      }
    } finally {
      setBulkStatusAction(null);
    }
  };

  const handleSwapPriority = async (index1, index2) => {
    // Optimistic update state
    const newConnections = [...connections];
    [newConnections[index1], newConnections[index2]] = [newConnections[index2], newConnections[index1]];
    setConnections(newConnections);

    try {
      await Promise.all([
        fetch(`/api/providers/${newConnections[index1].id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: index1 + 1 }),
        }),
        fetch(`/api/providers/${newConnections[index2].id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: index2 + 1 }),
        }),
      ]);
    } catch (error) {
      console.log("Error swapping priority:", error);
      await fetchConnections();
    }
  };

  const handleReorderByStatus = async () => {
    const sorted = sortConnectionsByAvailability(connections);
    setConnections(sorted);

    try {
      await persistConnectionOrder(providerId, sorted);
    } catch (error) {
      console.log("Error reordering by status:", error);
      await fetchConnections();
    }
  };

  const selectedConnections = connections.filter((conn) => selectedConnectionIds.includes(conn.id));
  const selectedActiveCount = selectedConnections.filter((conn) => conn.isActive !== false).length;
  const selectedInactiveCount = selectedConnections.length - selectedActiveCount;
  const allSelected = connections.length > 0 && selectedConnectionIds.length === connections.length;

  const toggleSelectConnection = (connectionId) => {
    setSelectedConnectionIds((prev) => (
      prev.includes(connectionId)
        ? prev.filter((id) => id !== connectionId)
        : [...prev, connectionId]
    ));
  };

  const toggleSelectAllConnections = () => {
    if (allSelected) {
      setSelectedConnectionIds([]);
      return;
    }
    setSelectedConnectionIds(connections.map((conn) => conn.id));
  };

  const clearSelection = () => {
    setSelectedConnectionIds([]);
    setBulkProxyPoolId("__none__");
  };

  useEffect(() => {
    setSelectedConnectionIds((prev) => prev.filter((id) => connections.some((conn) => conn.id === id)));
  }, [connections]);

  const selectedProxySummary = (() => {
    if (selectedConnections.length === 0) return "";
    const poolIds = new Set(selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId || "__none__"));
    if (poolIds.size === 1) {
      const onlyId = [...poolIds][0];
      if (onlyId === "__none__") return "All selected currently unbound";
      const pool = proxyPools.find((p) => p.id === onlyId);
      return `All selected currently bound to ${pool?.name || onlyId}`;
    }
    return "Selected connections have mixed proxy bindings";
  })();

  const openBulkProxyModal = () => {
    if (selectedConnections.length === 0) return;
    const uniquePoolIds = [...new Set(selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId || "__none__"))];
    setBulkProxyPoolId(uniquePoolIds.length === 1 ? uniquePoolIds[0] : "__none__");
    setShowBulkProxyModal(true);
  };

  const closeBulkProxyModal = () => {
    if (bulkUpdatingProxy) return;
    setShowBulkProxyModal(false);
  };

  const applyProxyAssignments = async (assignments) => {
    setBulkUpdatingProxy(true);
    try {
      let failed = 0;
      for (const { connectionId, proxyPoolId } of assignments) {
        try {
          const res = await fetch(`/api/providers/${connectionId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ proxyPoolId }),
          });
          if (!res.ok) failed += 1;
        } catch (e) {
          console.log("Error applying proxy for", connectionId, e);
          failed += 1;
        }
      }
      if (failed > 0) alert(`Updated with ${failed} failed request(s).`);
      await fetchConnections();
      setShowBulkProxyModal(false);
    } finally {
      setBulkUpdatingProxy(false);
    }
  };

  const handleApplySinglePool = (proxyPoolId) => {
    const targets = connections.map((c) => ({ connectionId: c.id, proxyPoolId }));
    return applyProxyAssignments(targets);
  };

  const handleApplyOneToOne = () => {
    const activePools = proxyPools.filter((p) => p.isActive === true);
    if (activePools.length === 0) {
      alert("No active proxy pools available.");
      return;
    }
    const targets = connections.map((c, i) => ({
      connectionId: c.id,
      proxyPoolId: activePools[i % activePools.length].id,
    }));
    return applyProxyAssignments(targets);
  };


  const isSelected = (connectionId) => selectedConnectionIds.includes(connectionId);

  const connectionsList = (
    <div className="flex min-w-0 flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03]">
      {connections
        .map((conn, index) => (
          <div key={conn.id} className="flex min-w-0 items-stretch">
            <div className="flex shrink-0 items-center pl-1 sm:pl-2">
              <input
                type="checkbox"
                checked={isSelected(conn.id)}
                onChange={() => toggleSelectConnection(conn.id)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
            </div>
            <div className="flex-1 min-w-0">
              <ConnectionRow
                connection={conn}
                plan={codexPlans[conn.id]}
                proxyPools={proxyPools}
                isOAuth={isOAuth}
                isFirst={index === 0}
                isLast={index === connections.length - 1}
                onMoveUp={() => handleSwapPriority(index, index - 1)}
                onMoveDown={() => handleSwapPriority(index, index + 1)}
                onToggleActive={(isActive) => handleUpdateConnectionStatus(conn.id, isActive)}
                autoPing={AUTO_PING_SETTINGS_KEYS[providerId] && conn.authType === "oauth" && conn.isActive !== false ? {
                  on: autoPing.connections[conn.id] === true,
                  onToggle: (on) => handleAutoPingConnection(conn.id, on),
                  provider: providerId,
                } : null}
                onUpdateProxy={async (proxyPoolId) => {
                  try {
                    const res = await fetch(`/api/providers/${conn.id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ proxyPoolId: proxyPoolId || null }),
                    });
                    if (res.ok) {
                      const { connection: updatedConnection } = await res.json();
                      setConnections(prev => prev.map(c =>
                        c.id === conn.id
                          ? (updatedConnection || c)
                          : c
                      ));
                    }
                  } catch (error) {
                    console.log("Error updating proxy:", error);
                  }
                }}
                onEdit={() => {
                  setSelectedConnection(conn);
                  setShowEditModal(true);
                }}
                onDelete={() => handleDelete(conn.id)}
                onReconnect={() => handleReconnect(conn)}
                oneByOneStatus={oneByOneResults[conn.id] || null}
              />
            </div>
          </div>
        ))}
    </div>
  );

  const activePools = proxyPools.filter((p) => p.isActive === true);

  const bulkActionModal = (
    <Modal
      isOpen={showBulkProxyModal}
      onClose={closeBulkProxyModal}
      title={`Apply Proxy (${connections.length} connections)`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <button
            onClick={handleApplyOneToOne}
            disabled={bulkUpdatingProxy || activePools.length === 0}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-text-muted text-[18px]">sync_alt</span>
            <span className="text-sm text-text-main">One-to-one (rotate)</span>
          </button>
          <button
            onClick={() => handleApplySinglePool(null)}
            disabled={bulkUpdatingProxy}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-text-muted text-[18px]">link_off</span>
            <span className="text-sm text-text-main">None (unbind all)</span>
          </button>
          {proxyPools.map((pool) => (
            <button
              key={pool.id}
              onClick={() => handleApplySinglePool(pool.id)}
              disabled={bulkUpdatingProxy || pool.isActive !== true}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-text-muted text-[18px]">lan</span>
              <span className="truncate text-sm text-text-main">{pool.name}</span>
              {pool.isActive !== true && (
                <span className="text-[10px] text-text-muted">(inactive)</span>
              )}
            </button>
          ))}
        </div>

        {bulkUpdatingProxy && <p className="text-xs text-text-muted">Applying...</p>}

        <Button onClick={closeBulkProxyModal} variant="ghost" fullWidth disabled={bulkUpdatingProxy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );

  const handleTestModel = async (modelId) => {
    if (testingModelIds.has(modelId)) return;
    setTestingModelIds((prev) => new Set(prev).add(modelId));
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setModelsTestError(data.ok ? "" : (data.error || "Model not reachable"));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setModelsTestError("Network error");
    } finally {
      setTestingModelIds((prev) => { const n = new Set(prev); n.delete(modelId); return n; });
    }
  };

  const renderModelsSection = () => {
    if (isCompatible) {
      return (
        <CompatibleModelsSection
          providerStorageAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          modelAliases={modelAliases}
          customModels={customModels}
          copied={copied}
          onCopy={copy}
          onSetAlias={handleSetAlias}
          onDeleteAlias={handleDeleteAlias}
          onAddCustomModel={(modelId) => handleAddCustomModel(modelId, "llm", providerStorageAlias)}
          onDeleteCustomModel={(modelId) => handleDeleteCustomModel(modelId, "llm", providerStorageAlias)}
          onEditCustomModel={(modelId) => {
            // Pass the persisted custom-model record (incl. capabilities) so
            // the modal's edit mode prefills the capability editor.
            const record = customModels.find((m) => m.id === modelId && m.providerAlias === providerStorageAlias && (m.kind || m.type || "llm") === "llm");
            if (record) setEditingCustomModel(record);
          }}
          onRefresh={() => Promise.all([fetchAliases(), fetchCustomModels()])}
          connections={connections}
          isAnthropic={isAnthropicCompatible}
        />
      );
    }
    // Combine hardcoded models with Kilo free models (deduplicated)
    // Exclude non-llm models (embedding, tts, etc.) — they have dedicated pages under media-providers
    const allModels = [
      ...models,
      ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
    ].filter((m) => { const k = getModelKind(m); return !k || k === "llm"; });
    const disabledSet = new Set(disabledModelIds);
    const displayModels = allModels.filter((m) => !disabledSet.has(m.id));
    const disabledDisplayModels = allModels.filter((m) => disabledSet.has(m.id));
    const customModelRows = getProviderCustomModelRows({
      customModels,
      modelAliases,
      providerAlias: providerStorageAlias,
      builtInModels: models,
      type: "llm",
    });

    return (
      <div className="flex flex-wrap gap-3">
        {/* Custom models first */}
        {customModelRows.map((model) => (
          <ModelRow
            key={`${model.source}-${model.fullModel}`}
            model={{ id: model.id, name: model.name }}
            fullModel={`${providerDisplayAlias}/${model.id}`}
            alias={model.alias}
            copied={copied}
            onCopy={copy}
            onSetAlias={() => {}}
            onDeleteAlias={() => {
              if (model.source === "custom") {
                handleDeleteCustomModel(model.id, "llm", providerStorageAlias);
              } else {
                handleDeleteAlias(model.alias);
              }
            }}
            testStatus={modelTestResults[model.id]}
            onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
            isTesting={testingModelIds.has(model.id)}
            isCustom
            isFree={false}
            caps={getCustomModelCapabilities({ providerId, modelId: model.id, capabilities: model.capabilities })}
            thinkingSuffix={resolveThinkingSuffix(model.id, model.capabilities)}
            onEdit={model.source === "custom" ? () => setEditingCustomModel(model) : undefined}
          />
        ))}

        {displayModels.map((model) => {
          const fullModel = `${providerStorageAlias}/${model.id}`;
          const oldFormatModel = `${providerId}/${model.id}`;
          const existingAlias = Object.entries(modelAliases).find(
            ([, m]) => m === fullModel || m === oldFormatModel
          )?.[0];
          return (
            <ModelRow
              key={model.id}
              model={model}
              fullModel={`${providerDisplayAlias}/${model.id}`}
              alias={existingAlias}
              copied={copied}
              onCopy={copy}
              onSetAlias={(alias) => handleSetAlias(model.id, alias, providerStorageAlias)}
              onDeleteAlias={() => handleDeleteAlias(existingAlias)}
              testStatus={modelTestResults[model.id]}
              onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
              isTesting={testingModelIds.has(model.id)}
              isFree={model.isFree}
              onDisable={() => handleDisableModel(model.id)}
              caps={getCaps(`${providerId}/${model.id}`)}
              thinkingSuffix={resolveThinkingSuffix(model.id)}
            />
          );
        })}

        {/* Add model button — inline, same style as model chips */}
        <button
          onClick={() => setShowAddCustomModel(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-2 text-xs text-primary transition-colors hover:border-primary hover:bg-primary/5 sm:w-auto"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Add Model
        </button>

        {/* Import Qoder models button — only show for qoder provider */}
        {providerId === "qoder" && connections.some((conn) => conn.isActive !== false) && (
          <button
            onClick={handleImportQoderModels}
            disabled={importingQoderModels}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-blue-500/40 px-3 py-2 text-xs text-blue-600 dark:text-blue-400 transition-colors hover:border-blue-500 hover:bg-blue-500/5 sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-sm" style={importingQoderModels ? { animation: "spin 1s linear infinite" } : undefined}>
              {importingQoderModels ? "progress_activity" : "download"}
            </span>
            {importingQoderModels ? translate("Fetching...") : translate("Fetch Qoder Models")}
          </button>
        )}

        {(OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId])?.modelsFetcher && (
          <button
            onClick={handleSyncModels}
            disabled={syncingModels}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/5 sm:w-auto disabled:opacity-50"
            title={modelsFetchedAt ? `Last synced ${modelsFetchedAt.toLocaleString()}` : "Fetch latest provider models"}
          >
            <span className={`material-symbols-outlined text-sm ${syncingModels ? "animate-spin" : ""}`}>sync</span>
            {syncingModels ? "Syncing…" : "Sync models"}
          </button>
        )}

        {/* Suggested models from provider API — show only models not yet added */}
        {suggestedModels.length > 0 && (() => {
          const addedFullModels = new Set([
            ...Object.values(modelAliases),
            ...customModelRows.map((model) => model.fullModel),
          ]);
          const hardcodedIds = new Set(models.map((m) => m.id));
          const notAdded = suggestedModels.filter(
            (m) => !addedFullModels.has(`${providerStorageAlias}/${m.id}`) && !hardcodedIds.has(m.id)
          );
          if (notAdded.length === 0) return null;
          return (
            <div className="w-full mt-2">
              <p className="text-xs text-text-muted mb-2">Suggested free models (≥200k context):</p>
              <div className="flex flex-wrap gap-2">
                {notAdded.map((m) => (
                  <button
                    key={m.id}
                    onClick={async () => {
                      await handleAddCustomModel(m.id, "llm", providerStorageAlias);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-xs text-text-muted hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
                    title={`${m.name} · ${(m.contextLength / 1000).toFixed(0)}k ctx`}
                  >
                    <span className="material-symbols-outlined text-[13px]">add</span>
                    {m.id.split("/").pop()}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Disabled models — restorable */}
        {disabledDisplayModels.length > 0 && (
          <div className="w-full mt-2">
            <p className="text-xs text-text-muted mb-2">Disabled models ({disabledDisplayModels.length}):</p>
            <div className="flex flex-wrap gap-2">
              {disabledDisplayModels.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleEnableModel(m.id)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-black/10 dark:border-white/10 text-xs text-text-muted hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
                  title="Restore model"
                >
                  <span className="material-symbols-outlined text-[13px]">add</span>
                  {m.id}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
}

  if (!providerInfo) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted">Provider not found</p>
        <Link href="/dashboard/providers" className="text-primary mt-4 inline-block">
          Back to Providers
        </Link>
      </div>
    );
  }

  // Determine icon path: OpenAI Compatible providers use specialized icons
  const getHeaderIconPath = () => {
    if (isOpenAICompatible && providerInfo.apiType) {
      return providerInfo.apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
    }
    if (isAnthropicCompatible) {
      return "/providers/anthropic-m.png";
    }
    return `/providers/${providerInfo.id}.png`;
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:gap-8 sm:px-0">
      {/* Header */}
      <div className="min-w-0">
        <Link
          href="/dashboard/providers"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          Back to Providers
        </Link>
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${providerInfo.color}15` }}
          >
            <ProviderIcon
              src={providerInfo.iconUrl || getHeaderIconPath()}
              alt={providerInfo.name}
              size={48}
              className="max-h-12 max-w-12 rounded-lg object-contain"
              fallbackText={providerInfo.textIcon || providerInfo.id.slice(0, 2).toUpperCase()}
              fallbackColor={providerInfo.color}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{providerInfo.name}</h1>
              {(providerInfo.notice?.apiKeyUrl || providerInfo.notice?.signupUrl || providerInfo.website) && (
                <a
                  href={providerInfo.notice?.apiKeyUrl || providerInfo.notice?.signupUrl || providerInfo.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                  {providerInfo.notice?.apiKeyUrl ? "Get API Key" : "Sign up / Learn more"}
                </a>
              )}
            </div>
            <p className="text-text-muted">
              {connections.length} connection{connections.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <label htmlFor="provider-retry-delay" className="hidden text-xs text-text-muted sm:inline">Retry delay</label>
            <select
              id="provider-retry-delay"
              value={retryDelay}
              onChange={(event) => handleRetryDelayChange(event.target.value)}
              title="Static cooldown when the provider reports no reset deadline"
              className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
            >
              {RETRY_DELAY_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {providerInfo.deprecated && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <span className="material-symbols-outlined text-[16px] text-yellow-500 mt-0.5 shrink-0">warning</span>
          <p className="text-xs text-red-600 dark:text-yellow-400 leading-relaxed">{providerInfo.deprecationNotice}</p>
        </div>
      )}

      {providerInfo.notice?.text && !providerInfo.deprecated && (
        <div className="flex flex-col gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 sm:flex-row sm:items-center">
          <span className="material-symbols-outlined text-[16px] text-blue-500 shrink-0">info</span>
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-blue-600 dark:text-blue-400">{providerInfo.notice.text}</p>
          {providerInfo.notice.apiKeyUrl && (
            <a
              href={providerInfo.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex justify-center rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 sm:py-0.5"
            >
              Get API Key →
            </a>
          )}
        </div>
      )}

      {isCompatible && providerNode && (
        <Card>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{isAnthropicCompatible ? "Anthropic Compatible Details" : "OpenAI Compatible Details"}</h2>
              <p className="break-all text-sm text-text-muted">
                {isAnthropicCompatible ? "Messages API" : (providerNode.apiType === "responses" ? "Responses API" : "Chat Completions")} · {(providerNode.baseUrl || "").replace(/\/$/, "")}/
                {isAnthropicCompatible ? "messages" : (providerNode.apiType === "responses" ? "responses" : "chat/completions")}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
              <Button
                size="sm"
                icon="add"
                onClick={() => {
                  setAddConnectionError("");
                  setShowAddApiKeyModal(true);
                }}
                className="w-full sm:w-auto"
              >
                Add API Key
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="edit"
                onClick={() => setShowEditNodeModal(true)}
                className="w-full sm:w-auto"
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="delete"
                onClick={async () => {
                  setConfirmState({
                    title: "Delete Compatible Node",
                    message: `Delete this ${isAnthropicCompatible ? "Anthropic" : "OpenAI"} Compatible node?`,
                    onConfirm: async () => {
                      setConfirmState(null);
                      try {
                        const res = await fetch(`/api/provider-nodes/${providerId}`, { method: "DELETE" });
                        if (res.ok) {
                          router.push("/dashboard/providers");
                        }
                      } catch (error) {
                        console.log("Error deleting provider node:", error);
                      }
                    }
                  });
                }}
                className="w-full sm:w-auto"
              >
                Delete
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Connections */}
      {isFreeNoAuth && !isStoredNoAuth && (
        <NoAuthProxyCard providerId={providerId} />
      )}
      {showConnections && (
        <Card>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Connections</h2>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              {connections.length > 0 && proxyPools.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="lan"
                  onClick={() => setShowBulkProxyModal(true)}
                >
                  Apply Proxy
                </Button>
              )}
              {connections.length > 0 && (
                <>
                  {selectedConnectionIds.length > 0 && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="check_circle"
                        onClick={() => handleBulkSetConnectionStatus(true)}
                        disabled={bulkStatusAction !== null || selectedInactiveCount === 0}
                      >
                        {bulkStatusAction === "on" ? "Turning On..." : `On Selected (${selectedConnectionIds.length})`}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="block"
                        onClick={() => handleBulkSetConnectionStatus(false)}
                        disabled={bulkStatusAction !== null || selectedActiveCount === 0}
                      >
                        {bulkStatusAction === "off" ? "Turning Off..." : `Off Selected (${selectedConnectionIds.length})`}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon="delete"
                        onClick={handleBulkDelete}
                        disabled={bulkStatusAction !== null}
                      >
                        Delete Selected ({selectedConnectionIds.length})
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="sync"
                    onClick={handleRunOneByOneTest}
                    disabled={oneByOneRunning}
                  >
                    {oneByOneRunning ? "Testing Connection One-by-One..." : "Test Connection One-by-One"}
                  </Button>
                  {oneByOneRunning && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="stop"
                      onClick={handleStopOneByOneTest}
                      disabled={oneByOneStopping}
                    >
                      {oneByOneStopping ? "Stopping..." : "Stop"}
                    </Button>
                  )}
                </>
              )}
              {connections.length > 1 && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="swap_vert"
                  onClick={handleReorderByStatus}
                  title="Reorder by availability status"
                >
                  Reorder
                </Button>
              )}
              {/* Round Robin toggle */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-muted font-medium">Round Robin</span>
                <Toggle
                  checked={providerStrategy === "round-robin"}
                  onChange={handleRoundRobinToggle}
                />
                {providerStrategy === "round-robin" && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-text-muted">Sticky:</span>
                    <input
                      type="number"
                      min={1}
                      value={providerStickyLimit}
                      onChange={(e) => handleStickyLimitChange(e.target.value)}
                      placeholder="1"
                      className="w-14 px-2 py-1 text-xs border border-border rounded-md bg-background focus:outline-none focus:border-primary"
                    />
                  </div>
                )}
              </div>
              {/* Per-provider concurrency limit */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted font-medium">Max Concurrent</span>
                <input
                  type="number"
                  min={0}
                  value={concurrencyLimit}
                  onChange={(e) => handleConcurrencyLimitChange(e.target.value)}
                  placeholder="∞"
                  className="w-16 px-2 py-1 text-xs border border-border rounded-md bg-background focus:outline-none focus:border-primary"
                />
              </div>
            </div>
          </div>

          {connections.length === 0 ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary shrink-0">
                  <span className="material-symbols-outlined text-[18px]">{isOAuth ? "lock" : "key"}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-text-muted">No connections yet</p>
                  {hasDualAuthModes && (
                    <p className="text-xs text-text-muted">
                      Choose {oauthConnectionLabel} or {apiKeyConnectionLabel}.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {hasDualAuthModes ? (
                  <>
                    <Button size="sm" icon="lock" variant="secondary" onClick={triggerOAuthConnection}>
                      {oauthConnectionLabel}
                    </Button>
                    <Button size="sm" icon="key" onClick={triggerApiKeyConnection}>
                      {apiKeyConnectionLabel}
                    </Button>
                  </>
                ) : (
                  <>
                    {!isCompatible && providerId === "iflow" && (
                      <Button size="sm" icon="cookie" variant="secondary" onClick={() => setShowIFlowCookieModal(true)}>
                        Cookie
                      </Button>
                    )}
                    {providerId === "codex" && (
                      <Button size="sm" icon="playlist_add" variant="secondary" onClick={() => setShowBulkImportCodex(true)}>
                        {translate("Bulk Add")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      icon="add"
                      onClick={triggerAddConnection}
                    >
                      {isCompatible ? "Add API Key" : (providerId === "iflow" ? "OAuth" : "Add Connection")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {oneByOneSummary && (
                <div className="mb-4 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>Total: {oneByOneSummary.total}</span>
                    <span>Completed: {oneByOneSummary.completed}</span>
                    <span>Passed: {oneByOneSummary.passed}</span>
                    <span>Failed: {oneByOneSummary.failed}</span>
                    {oneByOneSummary.stopped && (
                      <span className="text-amber-600 dark:text-amber-400">Stopped</span>
                    )}
                    {oneByOneRunning && oneByOneCurrentConnectionId && (
                      <span>Running: {connections.find((conn) => conn.id === oneByOneCurrentConnectionId)?.name || oneByOneCurrentConnectionId}</span>
                    )}
                  </div>
                </div>
              )}
              {connections.length > 0 && (
                <div className="mb-3 flex items-center gap-2 border-b border-black/[0.03] pb-2 dark:border-white/[0.03]">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted hover:text-primary">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAllConnections}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    Select All
                  </label>
                </div>
              )}
              {connectionsList}
              {!isCompatible && (
                <div className="mt-4 grid grid-cols-1 gap-2 sm:flex">
                  {providerId === "iflow" && (
                    <Button
                      size="sm"
                      icon="cookie"
                      variant="secondary"
                      onClick={() => setShowIFlowCookieModal(true)}
                      title="Add connection using browser cookie"
                      className="w-full sm:w-auto"
                    >
                      Cookie
                    </Button>
                  )}
                  {providerId === "codex" && (
                    <Button
                      size="sm"
                      icon="playlist_add"
                      variant="secondary"
                      onClick={() => setShowBulkImportCodex(true)}
                      title={translate("Bulk import codex accounts from JSON")}
                      className="w-full sm:w-auto"
                    >
                      {translate("Bulk Add")}
                    </Button>
                  )}
                  {hasDualAuthModes ? (
                    <>
                      <Button
                        size="sm"
                        icon="lock"
                        variant="secondary"
                        onClick={triggerOAuthConnection}
                        className="w-full sm:w-auto"
                      >
                        {oauthConnectionLabel}
                      </Button>
                      <Button
                        size="sm"
                        icon="key"
                        onClick={triggerApiKeyConnection}
                        className="w-full sm:w-auto"
                      >
                        {apiKeyConnectionLabel}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      icon="add"
                      onClick={triggerAddConnection}
                      className="w-full sm:w-auto"
                    >
                      Add
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* Models */}
      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              {"Available Models"}
            </h2>
            {providerThinkingLevels && (
              <select
                value={thinkingMode}
                onChange={(e) => handleThinkingModeChange(e.target.value)}
                title="Appends (level) suffix to copied model names"
                className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
              >
                {providerThinkingLevels.map((opt) => (
                  <option key={opt} value={opt}>{`Thinking: ${opt.charAt(0).toUpperCase() + opt.slice(1)}`}</option>
                ))}
              </select>
            )}
          </div>
          {!isCompatible && (() => {
            const allIds = [
              ...models,
              ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
            ].filter((m) => { const k = getModelKind(m); return !k || k === "llm"; }).map((m) => m.id);
            const activeIds = allIds.filter((id) => !disabledModelIds.includes(id));
            return (
              <div className="flex gap-2">
                {disabledModelIds.length > 0 && (
                  <Button size="sm" variant="secondary" icon="restart_alt" onClick={handleEnableAll}>
                    Active All
                  </Button>
                )}
                {activeIds.length > 0 && (
                  <Button size="sm" variant="secondary" icon="block" onClick={() => handleDisableAll(activeIds)}>
                    Disable All
                  </Button>
                )}
              </div>
            );
          })()}
        </div>
        {!!modelsTestError && (
          <p className="text-xs text-red-500 mb-3 break-words">{modelsTestError}</p>
        )}
        {renderModelsSection()}
      </Card>

      {bulkActionModal}

      {/* Modals */}
      {providerId === "kiro" ? (
        <KiroOAuthWrapper
          isOpen={showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
          proxyPools={proxyPools}
          proxyPoolsReady={proxyPoolsReady}
        />
      ) : providerId === "cursor" ? (
        <CursorAuthModal
          isOpen={showOAuthModal}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : providerId === "gitlab" || providerId === "gitlab-duo" ? (
        <GitLabAuthModal
          isOpen={showOAuthModal}
          provider={providerId}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
          proxyPools={proxyPools}
          proxyPoolsReady={proxyPoolsReady}
        />
      ) : isImportToken ? (
        <ImportTokenModal
          isOpen={showOAuthModal}
          provider={providerId}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : (
        <OAuthModal
          isOpen={showOAuthModal}
          provider={providerId}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => { setShowOAuthModal(false); setReconnectConnectionId(null); }}
          proxyPools={proxyPools}
          proxyPoolsReady={proxyPoolsReady}
          connectionId={reconnectConnectionId}
        />
      )}
      {providerId === "iflow" && (
        <IFlowCookieModal
          isOpen={showIFlowCookieModal}
          onSuccess={handleIFlowCookieSuccess}
          onClose={() => setShowIFlowCookieModal(false)}
        />
      )}
      <Modal
        isOpen={showImportTokenModal}
        title="Import Grok CLI Token"
        size="lg"
        onClose={() => {
          if (importingToken) return;
          setImportTokenError("");
          setShowImportTokenModal(false);
        }}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setImportTokenError("");
                setShowImportTokenModal(false);
              }}
              disabled={importingToken}
            >
              Cancel
            </Button>
            <Button
              icon="upload"
              loading={importingToken}
              onClick={handleImportTokenSubmit}
            >
              Import
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Paste the contents of <code className="rounded bg-surface-2 px-1 py-0.5">~/.grok/auth.json</code>, a raw Grok JWT, or a structured <code className="rounded bg-surface-2 px-1 py-0.5">{"{ accessToken, refreshToken }"}</code> body.
          </p>
          <textarea
            value={importTokenValue}
            onChange={(event) => setImportTokenValue(event.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full rounded-[10px] border border-border bg-background px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary"
            placeholder='{"https://auth.x.ai::client":{"key":"eyJ...","refresh_token":"...","expires_at":"..."}}'
          />
          {!!importTokenError && (
            <p className="text-sm text-red-500">{importTokenError}</p>
          )}
        </div>
      </Modal>
      <AddApiKeyModal
        isOpen={showAddApiKeyModal}
        provider={providerId}
        providerName={providerInfo.name}
        isCompatible={isCompatible}
        isAnthropic={isAnthropicCompatible}
        authType={providerInfo?.authType}
        authHint={providerInfo?.authHint}
        website={providerInfo?.website}
        proxyPools={proxyPools}
        existingConnectionNames={providerApiKeyConnectionNames}
        error={addConnectionError}
        onSave={handleSaveApiKey}
        onBulkDone={fetchConnections}
        onClose={() => {
          setAddConnectionError("");
          setShowAddApiKeyModal(false);
        }}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)}
      />
      {isCompatible && (
        <EditCompatibleNodeModal
          isOpen={showEditNodeModal}
          node={providerNode}
          onSave={handleUpdateNode}
          onClose={() => setShowEditNodeModal(false)}
          isAnthropic={isAnthropicCompatible}
        />
      )}
      {(!isCompatible || editingCustomModel) && (
        <AddCustomModelModal
          isOpen={showAddCustomModel || Boolean(editingCustomModel)}
          providerAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          initialModel={editingCustomModel}
          onSave={async (payload) => {
            if (editingCustomModel) {
              await handleUpdateCustomModel(payload);
            } else {
              await handleAddCustomModel(payload, "llm", providerStorageAlias);
            }
            setShowAddCustomModel(false);
            setEditingCustomModel(null);
          }}
          onClose={() => {
            setShowAddCustomModel(false);
            setEditingCustomModel(null);
          }}
        />
      )}

      {providerId === "codex" && (
        <BulkImportCodexModal
          isOpen={showBulkImportCodex}
          onClose={() => setShowBulkImportCodex(false)}
          onSuccess={fetchConnections}
        />
      )}

      {/* AG Risk Confirmation Modal */}
      <ConfirmModal
        isOpen={showAgRiskModal}
        onClose={() => setShowAgRiskModal(false)}
        onConfirm={handleAgRiskConfirm}
        title="Risk Notice"
        message={providerInfo?.deprecationNotice}
        confirmText="I Understand, Continue"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}
