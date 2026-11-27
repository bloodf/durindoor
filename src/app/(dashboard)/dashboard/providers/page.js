"use client";

import Link from "next/link";
import { requestSettings } from "@/store/settingsStore";

import { useState, useEffect, useCallback, useRef } from "react";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import {
  CardSkeleton,
  Button,
  Select } from
"@/shared/components";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  WEB_COOKIE_PROVIDERS } from
"@/shared/constants/providers";
import { FREE_NO_AUTH_PROVIDER_IDS } from "@/shared/constants/freeNoAuthProviders";
import { getErrorCode, getRelativeTime } from "@/shared/utils";
import { useNotificationStore } from "@/store/notificationStore";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { getModelsByProviderId } from "@/shared/constants/models";
import ModelAvailabilityBadge from "./components/ModelAvailabilityBadge";
import AddCompatibleModal from "./components/AddCompatibleModal";
import LanDiscoveryPanel from "./components/LanDiscoveryPanel";
import ProviderCard from "./components/ProviderCard";
import ApiKeyProviderCard from "./components/ApiKeyProviderCard";
import ProviderTestResultsView from "./components/ProviderTestResultsView";
import { getProviderStatus, getFreeAuthTypes, matchesProviderSearch, matchesProviderStatus, OAUTH_AUTH_TYPES, OAUTH_STATUS_AUTH_TYPES } from "./providerFilters";
import { testSummaryToast } from "./testSummaryToast";
import { resolveProviderNodeIcon } from "@/shared/utils/providerNodeIcon.js";

import { requestJSON, requestCollection, updateProviderConnections } from "./workflowRequests.js";

function getConnectionErrorTag(connection) {
  if (!connection) return null;

  const explicitType = connection.lastErrorType;
  if (explicitType === "runtime_error") return "RUNTIME";
  if (
  explicitType === "upstream_auth_error" ||
  explicitType === "auth_missing" ||
  explicitType === "token_refresh_failed" ||
  explicitType === "token_expired")

  return "AUTH";
  if (explicitType === "upstream_rate_limited") return "429";
  if (explicitType === "upstream_unavailable") return "5XX";
  if (explicitType === "network_error") return "NET";

  const numericCode = Number(connection.errorCode);
  if (Number.isFinite(numericCode) && numericCode >= 400)
  return String(numericCode);

  const fromMessage = getErrorCode(connection.lastError);
  if (fromMessage === "401" || fromMessage === "403") return "AUTH";
  if (fromMessage && fromMessage !== "ERR") return fromMessage;

  const msg = (connection.lastError || "").toLowerCase();
  if (
  msg.includes("runtime") ||
  msg.includes("not runnable") ||
  msg.includes("not installed"))

  return "RUNTIME";
  if (
  msg.includes("invalid api key") ||
  msg.includes("token invalid") ||
  msg.includes("revoked") ||
  msg.includes("unauthorized"))

  return "AUTH";

  return "ERR";
}

const APIKEY_INITIAL_VISIBLE = 20;

export default function ProvidersPage() {
  // V5 uses the root presentation tokens while retaining the provider workflows.
  const v5 = useUiV5();
  const [loadError, setLoadError] = useState("");
  const [toggleError, setToggleError] = useState(null);
  const pendingProviders = useRef(new Set());
  const [savingProviders, setSavingProviders] = useState([]);
  const [connections, setConnections] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [disabledFreeProviders, setDisabledFreeProviders] = useState([]);
  const [savingFreeProviders, setSavingFreeProviders] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAllApikey, setShowAllApikey] = useState(false);
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] =
  useState(false);
  const [testingMode, setTestingMode] = useState(null);
  const [testResults, setTestResults] = useState(null);
  const [providerFilter, setProviderFilter] = useState("active");
  const notify = useNotificationStore();
  const searchQuery = useHeaderSearchStore((s) => s.query);
  const registerSearch = useHeaderSearchStore((s) => s.register);
  const unregisterSearch = useHeaderSearchStore((s) => s.unregister);

  useEffect(() => {
    registerSearch("Search providers...");
    return () => unregisterSearch();
  }, [registerSearch, unregisterSearch]);

  const matchSearch = (name, providerId) =>
  matchesProviderSearch(name, searchQuery, providerId, providerId ? getModelsByProviderId(providerId) : []);

  const sortByPriority = (entries, authType) =>
  [...entries].sort(([ka, a], [kb, b]) => {
    const pa = a.priority ?? 999;
    const pb = b.priority ?? 999;
    if (pa !== pb) return pa - pb;
    const sa = getProviderStats(ka, authType);
    const sb = getProviderStats(kb, authType);
    const ca = sa.connected > 0 ? 1 : 0;
    const cb = sb.connected > 0 ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return (a.name || "").localeCompare(b.name || "");
  });

  const sortItemsByPriority = (items, authType) =>
  [...items].sort((a, b) => {
    const pa = a.priority ?? 999;
    const pb = b.priority ?? 999;
    if (pa !== pb) return pa - pb;
    const sa = getProviderStats(a.id, authType);
    const sb = getProviderStats(b.id, authType);
    const ca = sa.connected > 0 ? 1 : 0;
    const cb = sb.connected > 0 ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return (a.name || "").localeCompare(b.name || "");
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedConnections, nodes, settings] = await Promise.all([
        requestCollection("/api/providers", "connections"),
        requestCollection("/api/provider-nodes", "nodes"),
        requestSettings().then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Failed to load settings"); return body; }),
      ]);
      setConnections(loadedConnections);
      setProviderNodes(nodes);
      setDisabledFreeProviders(Array.isArray(settings.disabledFreeProviders) ? settings.disabledFreeProviders : []);
      setLoadError(""); setToggleError(null);
    } catch (error) { setLoadError(error.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { Promise.resolve().then(fetchData); }, [fetchData]);

  const getProviderStats = (providerId, authType) => {
    const authTypes = Array.isArray(authType) ? authType : [authType];
    const providerConnections = connections.filter(
      (c) => c.provider === providerId && authTypes.includes(c.authType)
    );

    const getEffectiveStatus = (conn) => {
      const isCooldown = Object.entries(conn).some(
        ([k, v]) =>
        k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now()
      );
      return conn.testStatus === "unavailable" && !isCooldown ?
      "active" :
      conn.testStatus;
    };

    const connected = providerConnections.filter((c) => {
      const status = getEffectiveStatus(c);
      return status === "active" || status === "success";
    }).length;

    const errorConns = providerConnections.filter((c) => {
      const status = getEffectiveStatus(c);
      return (
        status === "error" || status === "expired" || status === "unavailable");

    });

    const error = errorConns.length;
    const total = providerConnections.length;
    const allDisabled =
    total > 0 && providerConnections.every((c) => c.isActive === false);

    const latestError = errorConns.sort(
      (a, b) => new Date(b.lastErrorAt || 0) - new Date(a.lastErrorAt || 0)
    )[0];
    const errorCode = latestError ? getConnectionErrorTag(latestError) : null;
    const errorTime = latestError?.lastErrorAt ?
    getRelativeTime(latestError.lastErrorAt) :
    null;

    return { connected, error, total, errorCode, errorTime, allDisabled };
  };

  // Toggle all connections for a provider on/off. authType may be a single
  // string or an array (kiro counts oauth + api_key/apikey together).
  const handleToggleProvider = async (providerId, authType, newActive) => {
    if (pendingProviders.current.has(providerId)) return;
    pendingProviders.current.add(providerId);
    setSavingProviders([...pendingProviders.current]);
    const authTypes = Array.isArray(authType) ? authType : [authType];
    const matches = (c) => c.provider === providerId && authTypes.includes(c.authType);
    const providerConns = connections.filter(matches);
    try {
      const { accepted, failed } = await updateProviderConnections(providerConns, newActive);
      setConnections((prev) => prev.map((c) => accepted.includes(c.id) ? { ...c, isActive: newActive } : c));
      if (failed.length) setToggleError({ message: `${failed.length} of ${providerConns.length} connections could not be ${newActive ? "enabled" : "disabled"}. Their previous state is retained.`, retry: () => handleToggleProvider(providerId, authType, newActive) });
      else setToggleError(null);
      try { setConnections(await requestCollection("/api/providers", "connections")); }
      catch (error) { setToggleError({ message: `Connection state could not be verified after the write. ${error.message}`, retry: fetchData }); }
    } finally {
      pendingProviders.current.delete(providerId);
      setSavingProviders([...pendingProviders.current]);
    }
  };

  const handleToggleFreeNoAuth = async (providerId, enabled) => {
    if (savingFreeProviders) return;
    setSavingFreeProviders(true);
    const previous = disabledFreeProviders;
    const next = enabled ?
    previous.filter((id) => id !== providerId) :
    Array.from(new Set([...previous, providerId]));

    setDisabledFreeProviders(next);
    try {
      const res = await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabledFreeProviders: next })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setDisabledFreeProviders(
        Array.isArray(data.disabledFreeProviders) ?
        data.disabledFreeProviders :
        next
      );
      notify.success(`${enabled ? "Enabled" : "Disabled"} ${providerId}`);
    } catch (error) {
      setDisabledFreeProviders(previous);
      console.error("Error saving free provider toggle:", error);
      notify.error(error.message || "Failed to save provider toggle");
    } finally {
      setSavingFreeProviders(false);
    }
  };

  const isFreeNoAuthEnabled = (providerId) => {
    return !disabledFreeProviders.includes(providerId);
  };

  const handleBatchTest = async (mode, providerId = null) => {
    if (testingMode) return;
    setTestingMode(mode === "provider" ? providerId : mode);
    setTestResults(null);
    try {
      const res = await fetch("/api/providers/test-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, providerId })
      });
      const data = await res.json();
      setTestResults(data);
      if (data.summary) {
        const { level, message } = testSummaryToast(data.summary);
        notify[level](message);
      }
    } catch (error) {
      setTestResults({ error: "Test request failed" });
      notify.error("Provider test failed");
    } finally {
      setTestingMode(null);
    }
  };

  const matchStatus = (key, authTypes, noAuth = false) =>
  providerFilter === "all" ||
  matchesProviderStatus(
    providerFilter,
    getProviderStatus(
      connections,
      key,
      authTypes,
      noAuth,
      disabledFreeProviders
    )
  );

  const compatibleProviders = providerNodes.
  filter((node) => node.type === "openai-compatible").
  map((node) => ({
    id: node.id,
    name: node.name || "OpenAI Compatible",
    ...resolveProviderNodeIcon(node),
    apiType: node.apiType,
    ...(node.iconUrl ? { iconUrl: node.iconUrl } : null)
  })).
  filter((p) => matchSearch(p.name, p.id) && matchStatus(p.id, "apikey"));

  const anthropicCompatibleProviders = providerNodes.
  filter((node) => node.type === "anthropic-compatible").
  map((node) => ({
    id: node.id,
    name: node.name || "Anthropic Compatible",
    ...resolveProviderNodeIcon(node),
    ...(node.iconUrl ? { iconUrl: node.iconUrl } : null)
  })).
  filter((p) => matchSearch(p.name, p.id) && matchStatus(p.id, "apikey"));

  const oauthEntries = sortByPriority(
    Object.entries(OAUTH_PROVIDERS).filter(
      ([key, info]) =>
      !info.hidden &&
      matchSearch(info.name, key) &&
      matchStatus(key, OAUTH_STATUS_AUTH_TYPES, info.noAuth)
    ),
    "oauth"
  );
  const freeEntries = Object.entries(FREE_PROVIDERS).
  filter(
    ([key, info]) =>
    !info.hidden &&
    matchSearch(info.name, key) &&
    matchStatus(key, getFreeAuthTypes(key, info), info.noAuth)
  ).
  sort(([, a], [, b]) => (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0));
  const freeTierEntries = sortByPriority(
    Object.entries(FREE_TIER_PROVIDERS).filter(
      ([key, info]) =>
      !info.hidden &&
      matchSearch(info.name, key) &&
      (info.serviceKinds ?? ["llm"]).includes("llm") &&
      matchStatus(key, info.authType ?? "apikey", info.noAuth)
    ),
    "freeTier"
  ).sort(([, a], [, b]) => (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0));
  // Web Cookie Providers: filter with search and sort by priority
  const webCookieEntries = sortByPriority(
    Object.entries(WEB_COOKIE_PROVIDERS).filter(
      ([key, info]) => !info.hidden && matchSearch(info.name, key) && matchStatus(key, "cookie", info.noAuth)
    ),
    "cookie"
  );
  // API Key: connected providers first, then alphabetical by name.
  // Agent-only providers (e.g. Devin) are shown once an account is connected
  // even though they are not LLM chat providers.
  // NOTE: pass noAuth=false here on purpose. Local no-auth infra in the apikey
  // category (lm-studio, llama-cpp, docker-model-runner, 9router, ...) must NOT
  // be reported as "active" until it actually has a connection — otherwise the
  // default "Active only" view lists a wall of unconnected local providers.
  // Genuine free no-auth CLOUD providers live in the free/freeTier categories,
  // which keep their own noAuth-active behavior above.
  const browserEntries = Object.entries(APIKEY_PROVIDERS).filter(([key, info]) => key === "adobe-firefly-web" && matchSearch(info.name, key) && matchStatus(key, "none"));
  const apikeyEntries = Object.entries(APIKEY_PROVIDERS).
  filter(
    ([key, info]) =>
    !info.hidden && key !== "adobe-firefly-web" && (
    (info.serviceKinds ?? ["llm"]).includes("llm") ||
    getProviderStats(key, "apikey").total > 0) &&
    matchSearch(info.name, key) &&
    matchStatus(key, "apikey")
  ).
  sort(([ka, a], [kb, b]) => {
    const ca = getProviderStats(ka, "apikey").total > 0 ? 0 : 1;
    const cb = getProviderStats(kb, "apikey").total > 0 ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return (a.name || "").localeCompare(b.name || "");
  });
  const isApikeySearching = !!searchQuery.trim();
  const visibleApikeyEntries =
  isApikeySearching || showAllApikey ?
  apikeyEntries :
  apikeyEntries.slice(0, APIKEY_INITIAL_VISIBLE);
  const hiddenApikeyCount = apikeyEntries.length - APIKEY_INITIAL_VISIBLE;

  if (loadError && connections.length === 0) return <div role="alert" className="flex flex-col gap-3 rounded-dd-lg border border-dd-danger/30 p-5"><p>Provider configuration could not be loaded. {loadError}</p><Button icon="refresh" onClick={fetchData}>Retry</Button></div>;
  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>);

  }

  const hasAnyResult =
  oauthEntries.length > 0 ||
  freeEntries.length > 0 ||
  freeTierEntries.length > 0 ||
  apikeyEntries.length > 0 ||
  compatibleProviders.length > 0 ||
  anthropicCompatibleProviders.length > 0 ||
  webCookieEntries.length > 0 || browserEntries.length > 0;

  return (
    <div className={`flex min-w-0 flex-col gap-6 px-1 sm:px-0${v5 ? " text-dd-text" : ""}`}>
      {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-4 py-3 text-[13px] text-dd-danger">Showing last confirmed configuration. {loadError}<Button icon="refresh" onClick={fetchData}>Retry</Button></div>}
      {toggleError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-4 py-3 text-[13px] text-dd-danger">{toggleError.message}<Button icon="refresh" onClick={toggleError.retry}>Retry</Button></div>}
      <PageHeader icon="dns" title="Providers" subtitle="Manage provider connections and routing availability." />
      <p className="text-sm text-dd-muted">Connection status and catalog listings do not establish live inference. Open a provider for local readiness evidence and modality limits.</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Select
          label="Provider status"
          aria-label="Provider status"
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          options={[
          { value: "all", label: "All" },
          { value: "active", label: "Active only" },
          { value: "deactivated", label: "Deactivated" },
          { value: "not-configured", label: "Not configured" }]
          }
          className="w-full sm:w-56" />
        
      </div>

      {!hasAnyResult &&
      <div className="text-center py-8 border border-dashed border-dd-border rounded-dd-lg">
          <span className="material-symbols-outlined text-[32px] text-dd-muted mb-2">
            search_off
          </span>
          <p className="text-dd-muted text-sm">No providers match current filters</p>
        </div>
      }

      {/* Custom Providers (OpenAI/Anthropic Compatible) — dynamic */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            Custom Providers (OpenAI/Anthropic Compatible){" "}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:w-auto">
            <Button
              size="sm"
              icon="add"
              onClick={() => setShowAddAnthropicCompatibleModal(true)}
              className="w-full sm:w-auto">
              
              Add Anthropic Compatible
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={() => setShowAddCompatibleModal(true)}
              className="w-full bg-dd-accent-2 text-dd-on-accent hover:bg-dd-accent-2-hover sm:w-auto">
              
              Add OpenAI Compatible
            </Button>
          </div>
        </div>
        {compatibleProviders.length === 0 &&
        anthropicCompatibleProviders.length === 0 ?
        <div className="flex items-center justify-center gap-2 py-2 border border-dashed border-dd-border rounded-dd-lg text-dd-muted text-sm">
            <span className="material-symbols-outlined text-[18px]">extension</span>
            <span>No custom providers — use buttons above to add OpenAI/Anthropic compatible endpoints</span>
          </div> :

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {[...compatibleProviders, ...anthropicCompatibleProviders].map(
            (info) =>
            <ApiKeyProviderCard
              key={info.id}
              providerId={info.id}
              saving={savingProviders.includes(info.id)}
              provider={info}
              stats={getProviderStats(info.id, "apikey")}
              authType="compatible"
              onToggle={(active) =>
              handleToggleProvider(info.id, "apikey", active)
              } />


          )}
          </div>
        }
      </div>

      <LanDiscoveryPanel onAdded={fetchData} />

      {/* OAuth Providers */}
      {oauthEntries.length > 0 &&
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            OAuth Providers
          </h2>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <ModelAvailabilityBadge />
            <button
              onClick={() => handleBatchTest("oauth")}
              disabled={!!testingMode}
              className={`flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:w-auto ${
              testingMode === "oauth" ?
              "bg-dd-accent-soft border-dd-accent/40 text-dd-accent animate-pulse" :
              "bg-dd-bg-alt border-dd-border text-dd-muted hover:text-dd-text hover:border-dd-accent/40"}`
              }
              title="Test all OAuth connections"
              aria-label="Test all OAuth connections">
              
              <span
                className={`material-symbols-outlined text-[14px]${testingMode === "oauth" ? " animate-spin" : ""}`}>
                
                play_arrow
              </span>
              {testingMode === "oauth" ? "Testing..." : "Test All"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {oauthEntries.map(([key, info]) =>
          <ProviderCard
            key={key}
            providerId={key}
            saving={savingProviders.includes(key)}
            provider={info}
            stats={getProviderStats(key, OAUTH_STATUS_AUTH_TYPES)}
            authType="oauth"
            onToggle={(active) => handleToggleProvider(key, OAUTH_STATUS_AUTH_TYPES, active)} />

          )}
        </div>
      </div>
      }

      {/* Free Tier Providers */}
      {(freeEntries.length > 0 || freeTierEntries.length > 0) &&
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            Free Tier Providers
          </h2>
          <button
            onClick={() => handleBatchTest("free")}
            disabled={!!testingMode}
            className={`flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:w-auto ${
            testingMode === "free" ?
            "bg-dd-accent-soft border-dd-accent/40 text-dd-accent animate-pulse" :
            "bg-dd-bg-alt border-dd-border text-dd-muted hover:text-dd-text hover:border-dd-accent/40"}`
            }
            title="Test all Free connections"
            aria-label="Test all Free provider connections">
            
            <span
              className={`material-symbols-outlined text-[14px]${testingMode === "free" ? " animate-spin" : ""}`}>
              
              play_arrow
            </span>
            {testingMode === "free" ? "Testing..." : "Test All"}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {freeEntries.map(([key, info]) => {
            const freeAuthTypes = getFreeAuthTypes(key, info);
            return (
              <ProviderCard
                key={key}
                providerId={key}
            saving={savingProviders.includes(key)}
                provider={info}
                stats={getProviderStats(key, freeAuthTypes)}
                authType="free"
                noAuthEnabled={isFreeNoAuthEnabled(key)}
                savingNoAuth={savingFreeProviders}
                onToggle={(active) =>
                handleToggleProvider(key, freeAuthTypes, active)
                }
                onToggleNoAuth={(enabled) => handleToggleFreeNoAuth(key, enabled)} />);


          })}
          {freeTierEntries.map(([key, info]) =>
          <ApiKeyProviderCard
            key={key}
            providerId={key}
            saving={savingProviders.includes(key)}
            provider={info}
            stats={getProviderStats(key, "apikey")}
            authType="apikey"
            onToggle={(active) => handleToggleProvider(key, "apikey", active)} />

          )}
        </div>
      </div>
      }

      {/* API Key Providers — fixed list */}
      {apikeyEntries.length > 0 &&
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            API Key Providers{" "}
          </h2>
          <button
            onClick={() => handleBatchTest("apikey")}
            disabled={!!testingMode}
            className={`flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:w-auto ${
            testingMode === "apikey" ?
            "bg-dd-accent-soft border-dd-accent/40 text-dd-accent animate-pulse" :
            "bg-dd-bg-alt border-dd-border text-dd-muted hover:text-dd-text hover:border-dd-accent/40"}`
            }
            title="Test all API Key connections"
            aria-label="Test all API Key connections">
            
            <span
              className={`material-symbols-outlined text-[14px]${testingMode === "apikey" ? " animate-spin" : ""}`}>
              
              play_arrow
            </span>
            {testingMode === "apikey" ? "Testing..." : "Test All"}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {visibleApikeyEntries.map(([key, info]) =>
          <ApiKeyProviderCard
            key={key}
            providerId={key}
            saving={savingProviders.includes(key)}
            provider={info}
            stats={getProviderStats(key, "apikey")}
            authType="apikey"
            onToggle={(active) => handleToggleProvider(key, "apikey", active)} />

          )}
        </div>
        {!isApikeySearching && !showAllApikey && hiddenApikeyCount > 0 &&
        <button
          onClick={() => setShowAllApikey(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-dd-accent/40 px-3 py-2.5 text-sm font-medium text-dd-accent transition-colors hover:border-dd-accent hover:bg-dd-accent-soft">
          
            <span className="material-symbols-outlined text-[16px]">expand_more</span>
            Show all {apikeyEntries.length} providers
          </button>
        }
      </div>
      }

      {browserEntries.length > 0 && <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Operator browser profiles</h2>
        {browserEntries.map(([key, info]) => <Link key={key} href={`/dashboard/providers/${key}`} className="rounded-dd border border-dd-border p-4">
          <h3>{info.name}</h3>
          <p>Experimental, operator-mapped image/video. Disabled until explicitly enabled on a private connection. Setup opens on this host and requires a display. Live compatibility and entitlement are unknown.</p>
        </Link>)}
      </section>}

      {/* Web Cookie Providers — use browser subscription cookie instead of API key */}
      {webCookieEntries.length > 0 &&
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            Web Cookie Providers{" "}
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {webCookieEntries.map(([key, info]) =>
          <ApiKeyProviderCard
            key={key}
            providerId={key}
            saving={savingProviders.includes(key)}
            provider={info}
            stats={getProviderStats(key, "cookie")}
            authType="cookie"
            onToggle={(active) => handleToggleProvider(key, "cookie", active)} />

          )}
        </div>
      </div>
      }

      <AddCompatibleModal
        variant="openai"
        isOpen={showAddCompatibleModal}
        onClose={() => setShowAddCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddCompatibleModal(false);
        }} />
      
      <AddCompatibleModal
        variant="anthropic"
        isOpen={showAddAnthropicCompatibleModal}
        onClose={() => setShowAddAnthropicCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddAnthropicCompatibleModal(false);
        }} />
      

      {/* Test Results Modal */}
      {testResults &&
      <div
        className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[6vh] sm:pt-[10vh]"
        onClick={() => setTestResults(null)}>
        
          <div className="absolute inset-0 bg-dd-backdrop backdrop-blur-sm" />
          <div
          tabIndex={0}
          aria-label="Provider connection test results"
          className="relative bg-dd-surface border border-dd-border rounded-dd-lg w-full max-w-[600px] max-h-[86vh] sm:max-h-[80vh] overflow-y-auto shadow-dd-elevated"
          role="region"
          onClick={(e) => e.stopPropagation()}>
          
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-dd-border bg-dd-surface/95 backdrop-blur-sm rounded-t-xl">
              <h3 className="font-semibold">Test Results</h3>
              <button
              onClick={() => setTestResults(null)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg p-1 text-dd-muted transition-colors hover:bg-dd-bg-alt hover:text-dd-text"
              aria-label="Close test results">
              
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            <div className="p-5">
              <ProviderTestResultsView results={testResults} />
            </div>
          </div>
        </div>
      }
    </div>);

}
