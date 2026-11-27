"use client";

import { dashboardRequest } from "../dashboardRequest";

import { useState, useEffect, useRef } from "react";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import { useRouter } from "next/navigation";

import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { probeOutcome } from "@/lib/providers/conversationProbe.js";
import { testAndDisableFailedModels, bulkDisableMessage } from "@/shared/utils/providerModelBulkActions.js";
import { useModelCaps } from "@/shared/hooks/useModelCaps";

import { shouldShowProviderConnections } from "@/shared/utils/providerAuthMode";
import { isImportTokenOAuthProvider } from "@/shared/utils/importTokenProviders";
import { createLatestIntentQueue } from "@/shared/utils/latestIntentQueue";

import { loadLiveAntigravityModels } from "../liveAntigravityModels";

import { updateCompatibleProviderNode } from "../updateCompatibleProviderNode";

import { getProviderThinkingLevels } from "../providerThinkingLevels";
import { getCustomModelCapabilities } from "../customModelCapabilities";

import { getThinkingLevelsFromCapabilities } from "open-sse/providers/thinkingLevels.js";

import { useNotificationStore } from "@/store/notificationStore";

import { connectionPage, togglePageSelection } from "../connectionPagination";

import { buildBulkReview, reviewedTargets } from "../components/bulkReview";
import { saveProviderTestResult } from "../components/providerTestStore";

import { resolveProviderNodeIcon } from "@/shared/utils/providerNodeIcon.js";
import { isBrowser } from "../../../../../../shared/utils/typeChecks.js";
const ONE_BY_ONE_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import useModelVisibility from "./useModelVisibility.js";

import useConnectionLoading from "./useConnectionLoading.js";

import useProviderSettings from "./useProviderSettings.js";

import useProviderAutoSync from "./useProviderAutoSync.js";

import useCustomModels from "./useCustomModels.js";

import useConnectionActions from "./useConnectionActions.js";

/** Owns the provider detail page state and requests. */
export default function useProviderDetail(providerId) {
  const uiV5 = useUiV5();
  const router = useRouter();
  const notify = useNotificationStore();
  const currentProviderIdRef = useRef(providerId);
  const providerGenerationRef = useRef(0);
  const fetchConnectionsGenerationRef = useRef(0);
  const { getCaps } = useModelCaps();
  const [connections, setConnections] = useState([]);
  /** connectionId → live Codex plan from the usage API (decolua/9router#3210). */
  const [codexPlans, setCodexPlans] = useState({});
  const [providerApiKeyConnectionNames, setProviderApiKeyConnectionNames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [enabledModelIds, setEnabledModelIds] = useState([]);
  const [showVisibleModels, setShowVisibleModels] = useState(false);

  const [providerNode, setProviderNode] = useState(null);
  const [proxyPools, setProxyPools] = useState([]);
  const [proxyPoolsReadyForProvider, setProxyPoolsReadyForProvider] = useState(null);
  const proxyPoolsReady = proxyPoolsReadyForProvider === providerId;
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [devinDesktopBrowserSignIn, setDevinDesktopBrowserSignIn] = useState(false);
  const [selectedOrcaModel, setSelectedOrcaModel] = useState("");
  // When set, the open OAuth modal replaces this existing connection in place
  // (the Reconnect flow) instead of creating a new row. Cleared on close/success.
  const [reconnectConnectionId, setReconnectConnectionId] = useState(null);
  const [clearingCooldownId, setClearingCooldownId] = useState(null);
  const [showIFlowCookieModal, setShowIFlowCookieModal] = useState(false);
  // Microsoft 365 Copilot native sign-in, beside its pasted-session connection form.
  const [showM365SignInModal, setShowM365SignInModal] = useState(false);
  const [showCookieImportModal, setShowCookieImportModal] = useState(false);
  const [showImportTokenModal, setShowImportTokenModal] = useState(false);
  const [importTokenValue, setImportTokenValue] = useState("");
  const [importTokenError, setImportTokenError] = useState("");
  const [importingToken, setImportingToken] = useState(false);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
  const [apiKeyModalAuthType, setApiKeyModalAuthType] = useState(null);
  const [addConnectionError, setAddConnectionError] = useState("");
  const [showBulkImportCodex, setShowBulkImportCodex] = useState(false);
  const [showBulkImportGrokCli, setShowBulkImportGrokCli] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState(false);
  const [showBulkProxyModal, setShowBulkProxyModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [modelAliases, setModelAliases] = useState({});
  const [customModels, setCustomModels] = useState([]);
  const [modelTestResults, setModelTestResults] = useState({});
  const [modelsTestError, setModelsTestError] = useState("");
  const [modelsTestMessage, setModelsTestMessage] = useState("");
  const [bulkTestingModels, setBulkTestingModels] = useState(false);
  const [testingModelIds, setTestingModelIds] = useState(() => new Set());
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const [showSyncProviderModels, setShowSyncProviderModels] = useState(false);
  const [editingCustomModel, setEditingCustomModel] = useState(null);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState([]);
  const [connectionFilter, setConnectionFilter] = useState("");
  const [connectionPageNumber, setConnectionPageNumber] = useState(1);
  const [connectionPageSize, setConnectionPageSize] = useState(25);
  const [bulkFailures, setBulkFailures] = useState([]);
  const [bulkProxyPoolId, setBulkProxyPoolId] = useState("__none__");
  const [bulkUpdatingProxy, setBulkUpdatingProxy] = useState(false);
  const [bulkStatusAction, setBulkStatusAction] = useState(null);
  const [providerStrategy, setProviderStrategy] = useState(null);
  const [providerStickyLimit, setProviderStickyLimit] = useState("");
  const [thinkingMode, setThinkingMode] = useState("auto");
  const [concurrencyLimit, setConcurrencyLimit] = useState("");
  const [retryDelay, setRetryDelay] = useState("auto");
  const [rpmLimit, setRpmLimit] = useState("");
  const [egressBucketed, setEgressBucketed] = useState(false);
  const [errorRules, setErrorRules] = useState([]);
  const [showErrorRulesModal, setShowErrorRulesModal] = useState(false);
  const [autoPing, setAutoPing] = useState({ enabled: false, connections: {}, schedules: {} });
  const [scheduleConnection, setScheduleConnection] = useState(null);
  const [autoPingQueue] = useState(() => createLatestIntentQueue({
    write: async (_key, enabled, { connectionId }) => {
      const response = await dashboardRequest(`/api/providers/${encodeURIComponent(connectionId)}/auto-ping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      if (!response.ok) throw new Error(`Auto-ping update failed (${response.status})`);
      return response.json();
    },
    onOptimistic: (_key, enabled, { connectionId }) => setAutoPing((current) => ({
      ...current,
      connections: { ...current.connections, [connectionId]: enabled }
    })),
    onConfirmed: (_key, enabled, { connectionId }) => setAutoPing((current) => ({
      ...current,
      connections: { ...current.connections, [connectionId]: enabled }
    })),
    onRollback: (_key, enabled, { connectionId }, error) => {
      console.log("Error saving auto-ping config:", error);
      setAutoPing((current) => ({
        ...current,
        connections: { ...current.connections, [connectionId]: enabled }
      }));
    }
  }));
  const [suggestedModels, setSuggestedModels] = useState([]);
  const [chutesCatalog, setChutesCatalog] = useState({ provider: "", status: "idle", models: [] });
  const [catalogEvidence, setCatalogEvidence] = useState(null);
  const [syncingModels, setSyncingModels] = useState(false);
  const [modelsFetchedAt, setModelsFetchedAt] = useState(null);
  const [kiloFreeModels, setKiloFreeModels] = useState([]);
  // Effective auto-synced model list (ModelAutoSyncPanel); null = registry defaults.
  const [syncedModels, setSyncedModels] = useState(null);
  const [liveAntigravityModels, setLiveAntigravityModels] = useState(null);
  const [disabledModelIds, setDisabledModelIds] = useState([]);
  const [modelFilter, setModelFilter] = useState("");
  const [modelGroup, setModelGroup] = useState("all");
  const [modelOperator, setModelOperator] = useState("contains");
  const [modelSort, setModelSort] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [modelBulkBusy, setModelBulkBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [showAgRiskModal, setShowAgRiskModal] = useState(false);
  const [refreshingProfiles, setRefreshingProfiles] = useState(false);
  const [profileRefreshStatus, setProfileRefreshStatus] = useState("");
  const [oneByOneRunning, setOneByOneRunning] = useState(false);
  const [oneByOneStopping, setOneByOneStopping] = useState(false);
  const [oneByOneCurrentConnectionId, setOneByOneCurrentConnectionId] = useState(null);
  const [oneByOneResults, setOneByOneResults] = useState({});
  const [persistedTests, setPersistedTests] = useState({});
  const [bulkReview, setBulkReview] = useState(null);
  const [oneByOneSummary, setOneByOneSummary] = useState(null);
  const stopOneByOneRef = useRef(false);
  const oneByOneRunRef = useRef(null);
  const [importingQoderModels, setImportingQoderModels] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    currentProviderIdRef.current = providerId;
    setSelectedModels([]);
    providerGenerationRef.current += 1;
    return () => {
      currentProviderIdRef.current = null;
      providerGenerationRef.current += 1;
      fetchConnectionsGenerationRef.current += 1;
      oneByOneRunRef.current?.abort();
      oneByOneRunRef.current = null;
    };
  }, [providerId]);

  useEffect(() => {
    if (providerId !== "antigravity") return;
    const controller = new AbortController();
    loadLiveAntigravityModels(connections, { signal: controller.signal }).then((models) => {
      if (!controller.signal.aborted) setLiveAntigravityModels(models);
    });
    return () => controller.abort();
  }, [providerId, connections]);

  const AG_RISK_STORAGE_KEY = "ag_risk_confirmed";

  const openOAuthConnection = () => {
    if (isImportTokenOAuthProvider(providerId)) {
      setImportTokenError("");
      setShowImportTokenModal(true);
      return;
    }
    setDevinDesktopBrowserSignIn(false);
    setShowOAuthModal(true);
  };

  const triggerOAuthConnection = () => {
    if (providerId === "antigravity" && isBrowser()) {
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

  const triggerApiKeyConnection = (mode = null) => {
    setAddConnectionError("");
    setApiKeyModalAuthType(mode);
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
    if (isBrowser()) {
      window.localStorage.setItem(AG_RISK_STORAGE_KEY, "true");
    }
    setShowAgRiskModal(false);
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    triggerApiKeyConnection();
  };

  const providerInfo = providerNode ?
  {
    id: providerNode.id,
    name: providerNode.name || (providerNode.type === "anthropic-compatible" ? "Anthropic Compatible" : "OpenAI Compatible"),
    ...resolveProviderNodeIcon(providerNode),
    apiType: providerNode.apiType,
    baseUrl: providerNode.baseUrl,
    type: providerNode.type,
    ...(providerNode.iconUrl ? { iconUrl: providerNode.iconUrl } : null)
  } :
  OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId] || WEB_COOKIE_PROVIDERS[providerId];
  const authModes = providerInfo?.authModes || [];
  const isImportToken = providerInfo?.flowType === "import_token";
  const isOAuth = !!OAUTH_PROVIDERS[providerId] || authModes.includes("oauth") || FREE_PROVIDERS[providerId]?.oauth;
  const supportsApiKeyAuth = !!APIKEY_PROVIDERS[providerId] || authModes.includes("apikey");
  const supportsAuthTokenAuth = authModes.includes("auth_token");
  const isFreeNoAuth = !!FREE_PROVIDERS[providerId]?.noAuth;
  const isDevinAgentic = providerId === "devin-cli-agentic";
  const isStoredNoAuth = isFreeNoAuth && (providerId === "mimocode" || isDevinAgentic);
  const showConnections = shouldShowProviderConnections(providerInfo, { storedNoAuth: isStoredNoAuth });
  // Only a provider with an exact HTTPS origin and an explicit cookie allowlist
  // can be imported into; the import modal stays hidden for the others.
  const cookieImportContract = providerInfo?.cookieImport;
  const models = liveAntigravityModels || syncedModels || getModelsByProviderId(providerId);
  const providerAlias = getProviderAlias(providerId);

  const isOpenAICompatible = isOpenAICompatibleProvider(providerId);
  const isAnthropicCompatible = isAnthropicCompatibleProvider(providerId);
  const isCompatible = isOpenAICompatible || isAnthropicCompatible;
  const hasDualAuthModes = !isCompatible && (
    (isOAuth && (supportsApiKeyAuth || supportsAuthTokenAuth)) ||
    (supportsApiKeyAuth && supportsAuthTokenAuth)
  );
  const oauthConnectionLabel =
  providerId === "xai" ?
  "Grok Build OAuth" :
  providerId === "grok-cli" ?
  "Grok CLI Device Login" :
  providerId === "orcarouter" ?
  "OrcaRouter - Auth" :
  "OAuth";
  const apiKeyConnectionLabel =
  providerId === "xai" ?
  "xAI API Key" :
  providerId === "orcarouter" ?
  "OrcaRouter - API" :
  "API Key";
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
    providerStorageAlias
  });

  const providerDisplayAlias = isCompatible ?
  providerNode?.prefix || providerId :
  providerAlias;

  const { fetchAliases, fetchCustomModels, fetchDisabledModels, fetchEnabledModels, handleDisableAll, handleDisableModel, handleEnableAll, handleEnableModel } = useModelVisibility({ currentProviderIdRef, providerId, providerStorageAlias, setConfirmState, setCustomModels, setDisabledModelIds, setEnabledModelIds, setModelAliases });

  // Fetch free models from Kilo API for kilocode provider
  useEffect(() => {
    if (providerId !== "kilocode") return;
    dashboardRequest("/api/providers/kilo/free-models").
    then((res) => res.json()).
    then((data) => {if (data.models?.length) setKiloFreeModels(data.models);}).
    catch(() => {});
  }, [providerId]);

  const { fetchConnections } = useConnectionLoading({ autoPingQueue, currentProviderIdRef, fetchConnectionsGenerationRef, isCompatible, providerId, setAutoPing, setCodexPlans, setConcurrencyLimit, setConnections, setEgressBucketed, setErrorRules, setLoading, setPersistedTests, setProviderApiKeyConnectionNames, setProviderNode, setProviderStickyLimit, setProviderStrategy, setProxyPools, setProxyPoolsReadyForProvider, setRetryDelay, setRpmLimit, setSelectedConnectionIds, setThinkingMode });

  const handleUpdateNode = async (formData) => {
    await updateCompatibleProviderNode({
      providerId,
      formData,
      onSuccess: async (node) => {
        setProviderNode(node);
        await fetchConnections();
        setShowEditNodeModal(false);
      }
    });
  };

  const { handleAutoPingConnection, handleCacheAffinityToggle, handleConcurrencyLimitChange, handleEarliestResetToggle, handleEgressBucketedChange, handleRetryDelayChange, handleRoundRobinToggle, handleSaveAutoPingSchedule, handleStickyLimitChange, handleThinkingModeChange, saveErrorRules, saveRpmLimit } = useProviderSettings({ autoPingQueue, providerId, providerStickyLimit, setAutoPing, setConcurrencyLimit, setEgressBucketed, setErrorRules, setProviderStickyLimit, setProviderStrategy, setRetryDelay, setThinkingMode });

  useEffect(() => {
    fetchConnections();
    fetchAliases();
    fetchCustomModels();
    fetchDisabledModels();
    fetchEnabledModels();
  }, [fetchConnections, fetchAliases, fetchCustomModels, fetchDisabledModels, fetchEnabledModels]);

  useEffect(() => {
    if (providerId !== "chutes") return;
    let active = true;
    setChutesCatalog({ provider: providerId, status: "loading", models: [] });
    const params = new URLSearchParams({ url: "https://llm.chutes.ai/v1/models", type: "chutes-all" });
    dashboardRequest(`/api/providers/suggested-models?${params}`).then(async (response) => {
      const data = await response.json();
      if (!response.ok || data.error) throw new Error("Catalog unavailable");
      if (active) setChutesCatalog({ provider: providerId, status: data.data?.length ? "loaded" : "empty", models: data.data || [] });
    }).catch(() => {
      if (active) setChutesCatalog({ provider: providerId, status: "error", models: [] });
    });
    return () => { active = false; };
  }, [providerId]);

  const { handleSyncModels } = useProviderAutoSync({ connections, providerGenerationRef, setCatalogEvidence, setModelsFetchedAt, setSuggestedModels, setSyncingModels });

  const { handleAddCustomModel, handleDeleteAlias, handleDeleteCustomModel, handleImportQoderModels, handleSetAlias, handleUpdateCustomModel } = useCustomModels({ connections, fetchAliases, fetchCustomModels, importingQoderModels, providerAlias, providerStorageAlias, setImportingQoderModels });

  const rememberTestResult = (connectionId, outcome) => {
    const record = saveProviderTestResult(connectionId, outcome);
    if (record) setPersistedTests((prev) => ({ ...prev, [connectionId]: record }));
  };

  const handleRunOneByOneTest = async (targets = connections) => {
    if (oneByOneRunning || targets.length === 0 || oneByOneRunRef.current) return;
    const run = new AbortController();
    oneByOneRunRef.current = run;
    const isCurrent = () => oneByOneRunRef.current === run;

    const queuedState = Object.fromEntries(
      targets.map((connection) => [connection.id, { state: "queued", error: null }])
    );

    stopOneByOneRef.current = false;
    setOneByOneRunning(true);
    setOneByOneStopping(false);
    setOneByOneCurrentConnectionId(null);
    setOneByOneResults(queuedState);
    setOneByOneSummary({ total: targets.length, completed: 0, passed: 0, failed: 0, stopped: false });

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let unavailable = 0;

    try {
      for (let index = 0; index < targets.length; index += 1) {
        if (!isCurrent()) return;
        if (stopOneByOneRef.current) {
          setOneByOneSummary({
            total: targets.length,
            completed: index,
            passed,
            failed,
            skipped,
            unavailable,
            stopped: true
          });
          break;
        }

        const connection = targets[index];
        setOneByOneCurrentConnectionId(connection.id);
        setOneByOneResults((prev) => ({
          ...prev,
          [connection.id]: { state: "testing", error: null }
        }));

        try {
          const res = await dashboardRequest(`/api/providers/${connection.id}/test`, { method: "POST", signal: run.signal });
          const data = await res.json();
          if (!isCurrent()) return;
          const wasSkipped = !!data.skipped;
          const wasUnavailable = data.unavailable === true;
          const valid = !!data.valid;

          if (wasUnavailable) {
            unavailable += 1;
          } else if (wasSkipped) {
            skipped += 1;
          } else if (valid) {
            passed += 1;
          } else {
            failed += 1;
          }

          const outcome = {
            state: wasUnavailable ? "unavailable" : wasSkipped ? "skipped" : valid ? "success" : "failed",
            error: valid ? null : data.error || null
          };
          setOneByOneResults((prev) => ({ ...prev, [connection.id]: outcome }));
          rememberTestResult(connection.id, outcome);
        } catch (error) {
          if (!isCurrent()) return;
          failed += 1;
          const outcome = { state: "failed", error: error.message || "Test failed" };
          setOneByOneResults((prev) => ({ ...prev, [connection.id]: outcome }));
          rememberTestResult(connection.id, outcome);
        }

        setOneByOneSummary({
          total: targets.length,
          completed: index + 1,
          passed,
          failed,
          skipped,
          unavailable,
          stopped: false
        });

        if (index < targets.length - 1) {
          await sleep(ONE_BY_ONE_DELAY_MS);
        }
      }
    } finally {
      if (isCurrent()) {
        oneByOneRunRef.current = null;
        setOneByOneCurrentConnectionId(null);
        setOneByOneRunning(false);
        setOneByOneStopping(false);
        stopOneByOneRef.current = false;
      }
    }
  };

  const handleStopOneByOneTest = () => {
    if (!oneByOneRunning) return;
    stopOneByOneRef.current = true;
    setOneByOneStopping(true);
  };

  const { handleBulkSetConnectionStatus, handleClearCooldown, handleDelete, handleIFlowCookieSuccess, handleImportTokenSubmit, handleOAuthSuccess, handleReconnect, handleReorderByStatus, handleSaveApiKey, handleSwapPriority, handleUpdateConnection, handleUpdateConnectionStatus, runBulkDelete } = useConnectionActions({ clearingCooldownId, connectionFilter, connections, fetchConnections, importTokenValue, notify, openOAuthConnection, providerGenerationRef, providerId, selectedConnection, selectedConnectionIds, setAddConnectionError, setBulkFailures, setBulkStatusAction, setClearingCooldownId, setConfirmState, setConnections, setImportTokenError, setImportTokenValue, setImportingToken, setReconnectConnectionId, setSelectedConnectionIds, setShowAddApiKeyModal, setShowEditModal, setShowIFlowCookieModal, setShowImportTokenModal, setShowOAuthModal });

  const selectedConnections = connections.filter((conn) => selectedConnectionIds.includes(conn.id));
  const selectedActiveCount = selectedConnections.filter((conn) => conn.isActive !== false).length;
  const selectedInactiveCount = selectedConnections.length - selectedActiveCount;
  const visibleConnections = connections.filter((conn) => `${conn.name || ""} ${conn.email || ""}`.toLowerCase().includes(connectionFilter.trim().toLowerCase()));
  const { page, pageCount, items: pageConnections } = connectionPage(visibleConnections, connectionPageNumber, connectionPageSize);
  const allSelected = pageConnections.length > 0 && pageConnections.every((conn) => selectedConnectionIds.includes(conn.id));
  const hiddenTestResultCount = connections.filter((conn) => !visibleConnections.includes(conn) && ["success", "failed", "skipped", "unavailable"].includes(oneByOneResults[conn.id]?.state)).length;

  const toggleSelectConnection = (connectionId) => {
    setSelectedConnectionIds((prev) =>
    prev.includes(connectionId) ?
    prev.filter((id) => id !== connectionId) :
    [...prev, connectionId]
    );
  };

  const toggleSelectAllConnections = () => {
    setSelectedConnectionIds((prev) => togglePageSelection(prev, pageConnections));
  };

  const clearSelection = () => {
    setSelectedConnectionIds([]);
    setBulkProxyPoolId("__none__");
  };

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
    const generation = providerGenerationRef.current;
    setBulkUpdatingProxy(true);
    setBulkFailures([]);
    try {
      const failures = [];
      for (const { connectionId, proxyPoolId } of assignments) {
        if (generation !== providerGenerationRef.current) return;
        try {
          const res = await dashboardRequest(`/api/providers/${connectionId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ proxyPoolId })
          });
          if (!res.ok) failures.push({ id: connectionId, reason: `HTTP ${res.status}` });
        } catch (e) {
          console.log("Error applying proxy for", connectionId, e);
          failures.push({ id: connectionId, reason: "Network error" });
        }
      }
      if (generation !== providerGenerationRef.current) return;
      setBulkFailures(failures.map((failure) => ({ ...failure, name: connections.find((c) => c.id === failure.id)?.name || failure.id })));
      await fetchConnections();
      if (generation === providerGenerationRef.current) setShowBulkProxyModal(false);
    } finally {
      if (generation === providerGenerationRef.current) setBulkUpdatingProxy(false);
    }
  };

  // Every bulk change goes through a review step first. The reviewed ids are
  // frozen in the summary, so Confirm applies only to what was shown.
  const requestBulkReview = (action, targets, detail, run) => {
    if (targets.length === 0) return;
    const generation = providerGenerationRef.current;
    setBulkReview({
      review: buildBulkReview({ action, detail, targets, visibleConnections: pageConnections }),
      run: (reviewed) => {
        if (generation === providerGenerationRef.current) return run(reviewed);
      },
    });
  };

  const cancelBulkReview = () => setBulkReview(null);

  const confirmBulkReview = async () => {
    if (!bulkReview) return;
    const { review, run } = bulkReview;
    setBulkReview(null);
    await run(reviewedTargets(review, connections));
  };

  const requestBulkStatusReview = (isActive) => {
    const targets = selectedConnections.filter((conn) => (conn.isActive !== false) !== isActive);
    requestBulkReview(isActive ? "enable" : "disable", targets, "", (reviewed) => handleBulkSetConnectionStatus(isActive, reviewed.map((conn) => conn.id)));
  };

  const requestBulkDeleteReview = () => {
    requestBulkReview("delete", selectedConnections, "this cannot be undone", (reviewed) => runBulkDelete(reviewed.map((conn) => conn.id)));
  };

  // Proxy changes apply to the selection; with nothing selected they apply to every connection.
  const requestProxyReview = (detail, buildAssignments) => {
    const targets = selectedConnections.length > 0 ? selectedConnections : connections;
    setShowBulkProxyModal(false);
    requestBulkReview("proxy", targets, detail, (reviewed) => applyProxyAssignments(buildAssignments(reviewed)));
  };

  const handleApplySinglePool = (proxyPoolId) => {
    const poolName = proxyPools.find((p) => p.id === proxyPoolId)?.name;
    const detail = proxyPoolId ? `bind to ${poolName || proxyPoolId}` : "unbind proxy";
    requestProxyReview(detail, (reviewed) => reviewed.map((c) => ({ connectionId: c.id, proxyPoolId })));
  };

  const handleApplyOneToOne = () => {
    const activePools = proxyPools.filter((p) => p.isActive === true);
    if (activePools.length === 0) {
      alert("No active proxy pools available.");
      return;
    }
    requestProxyReview("rotate across active proxy pools", (reviewed) => reviewed.map((c, i) => ({
      connectionId: c.id,
      proxyPoolId: activePools[i % activePools.length].id
    })));
  };

  const isSelected = (connectionId) => selectedConnectionIds.includes(connectionId);

  const runModelTest = async (modelId) => {
    const requestGeneration = providerGenerationRef.current;
    setTestingModelIds((prev) => new Set(prev).add(modelId));
    try {
      const connectionId = connections.find((connection) => connection.isActive !== false)?.id;
      const res = await dashboardRequest("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `${providerStorageAlias}/${modelId}`,
          connectionId,
        })
      });
      const data = await res.json();
      if (providerGenerationRef.current !== requestGeneration) return null;
      const outcome = probeOutcome(data);
      setModelTestResults((prev) => ({ ...prev, [modelId]: outcome }));
      setModelsTestError(outcome === "error" ? data.error || "Model not reachable" : "");
      return outcome;
    } catch {
      if (providerGenerationRef.current !== requestGeneration) return null;
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setModelsTestError("Network error");
      return "error";
    } finally {
      if (providerGenerationRef.current === requestGeneration) {
        setTestingModelIds((prev) => {const n = new Set(prev);n.delete(modelId);return n;});
      }
    }
  };

  const handleTestModel = async (modelId) => {
    if (testingModelIds.has(modelId) || bulkTestingModels) return;
    setModelsTestMessage("");
    await runModelTest(modelId);
  };

  // Probe every active model, then disable the ones that fail.
  const handleDisableFailedModels = async (modelIds) => {
    if (bulkTestingModels || testingModelIds.size > 0 || modelIds.length === 0) return;
    const requestGeneration = providerGenerationRef.current;
    setBulkTestingModels(true);
    setModelsTestError("");
    setModelsTestMessage("");
    try {
      const { failedIds } = await testAndDisableFailedModels({
        modelIds,
        testModel: async (modelId) => {
          if (providerGenerationRef.current !== requestGeneration) throw new Error("Provider changed");
          return runModelTest(modelId);
        },
        disableModels: async (ids) => {
          const res = await dashboardRequest("/api/models/disabled", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerAlias: providerStorageAlias, ids })
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to disable error models");
          }
          await fetchDisabledModels();
        },
      });
      setModelsTestMessage(bulkDisableMessage(failedIds.length));
    } catch (error) {
      if (providerGenerationRef.current === requestGeneration) {
        setModelsTestError(error.message || "Failed to disable error models");
      }
    } finally {
      setBulkTestingModels(false);
    }
  };

  return { addConnectionError, allSelected, apiKeyConnectionLabel, apiKeyModalAuthType, autoPing, bulkFailures, bulkReview, bulkStatusAction, bulkTestingModels, bulkUpdatingProxy, cancelBulkReview, catalogEvidence, chutesCatalog, clearingCooldownId, closeBulkProxyModal, codexPlans, concurrencyLimit, confirmBulkReview, confirmState, connectionFilter, connectionPageSize, connections, cookieImportContract, copied, copy, currentProviderIdRef, customModels, devinDesktopBrowserSignIn, disabledModelIds, editingCustomModel, egressBucketed, enabledModelIds, errorRules, fetchAliases, fetchConnections, fetchCustomModels, fetchDisabledModels, getCaps, handleAddCustomModel, handleAgRiskConfirm, handleApplyOneToOne, handleApplySinglePool, handleAutoPingConnection, handleCacheAffinityToggle, handleClearCooldown, handleConcurrencyLimitChange, handleDelete, handleDeleteAlias, handleDeleteCustomModel, handleDisableAll, handleDisableFailedModels, handleDisableModel, handleEarliestResetToggle, handleEgressBucketedChange, handleEnableAll, handleEnableModel, handleIFlowCookieSuccess, handleImportQoderModels, handleImportTokenSubmit, handleOAuthSuccess, handleReconnect, handleReorderByStatus, handleRetryDelayChange, handleRoundRobinToggle, handleRunOneByOneTest, handleSaveApiKey, handleSaveAutoPingSchedule, handleSetAlias, handleStickyLimitChange, handleStopOneByOneTest, handleSwapPriority, handleSyncModels, handleTestModel, handleThinkingModeChange, handleUpdateConnection, handleUpdateConnectionStatus, handleUpdateCustomModel, handleUpdateNode, hasDualAuthModes, hiddenTestResultCount, importTokenError, importTokenValue, importingQoderModels, importingToken, isAnthropicCompatible, isCompatible, isDevinAgentic, isFreeNoAuth, isImportToken, isOAuth, isSelected, isStoredNoAuth, kiloFreeModels, loading, modelAliases, modelBulkBusy, modelFilter, modelGroup, modelOperator, modelSort, modelTestResults, models, modelsFetchedAt, modelsTestError, modelsTestMessage, oauthConnectionLabel, oneByOneCurrentConnectionId, oneByOneResults, oneByOneRunning, oneByOneStopping, oneByOneSummary, page, pageConnections, pageCount, persistedTests, profileRefreshStatus, providerApiKeyConnectionNames, providerDisplayAlias, providerGenerationRef, providerId, providerInfo, providerNode, providerStickyLimit, providerStorageAlias, providerStrategy, providerThinkingLevels, proxyPools, proxyPoolsReady, reconnectConnectionId, refreshingProfiles, requestBulkDeleteReview, requestBulkStatusReview, resolveThinkingSuffix, retryDelay, router, rpmLimit, saveErrorRules, saveRpmLimit, scheduleConnection, selectedActiveCount, selectedConnection, selectedConnectionIds, selectedConnections, selectedInactiveCount, selectedModels, selectedOrcaModel, setAddConnectionError, setApiKeyModalAuthType, setConfirmState, setConnectionFilter, setConnectionPageNumber, setConnectionPageSize, setConnections, setDevinDesktopBrowserSignIn, setEditingCustomModel, setEnabledModelIds, setImportTokenError, setImportTokenValue, setModelBulkBusy, setModelFilter, setModelGroup, setModelOperator, setModelSort, setModelsTestError, setModelsTestMessage, setProfileRefreshStatus, setReconnectConnectionId, setRefreshingProfiles, setRpmLimit, setScheduleConnection, setSelectedConnection, setSelectedConnectionIds, setSelectedModels, setSelectedOrcaModel, setShowAddApiKeyModal, setShowAddCustomModel, setShowAgRiskModal, setShowBulkImportCodex, setShowBulkImportGrokCli, setShowBulkProxyModal, setShowCookieImportModal, setShowEditModal, setShowEditNodeModal, setShowErrorRulesModal, setShowIFlowCookieModal, setShowImportTokenModal, setShowM365SignInModal, setShowOAuthModal, setShowSyncProviderModels, setShowVisibleModels, setSyncedModels, showAddApiKeyModal, showAddCustomModel, showAgRiskModal, showBulkImportCodex, showBulkImportGrokCli, showBulkProxyModal, showConnections, showCookieImportModal, showEditModal, showEditNodeModal, showErrorRulesModal, showIFlowCookieModal, showImportTokenModal, showM365SignInModal, showOAuthModal, showSyncProviderModels, showVisibleModels, suggestedModels, supportsApiKeyAuth, supportsAuthTokenAuth, syncingModels, testingModelIds, thinkingMode, toggleSelectAllConnections, toggleSelectConnection, triggerAddConnection, triggerApiKeyConnection, triggerOAuthConnection, uiV5, visibleConnections };
}
