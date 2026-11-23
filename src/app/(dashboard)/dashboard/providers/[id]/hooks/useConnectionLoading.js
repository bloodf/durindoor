"use client";

import { requestSettings } from "@/store/settingsStore";

import { useCallback } from "react";

import { toCodexPlanEntry, buildCodexPlanMap } from "@/shared/utils/codexPlanLabel";

import { apiKeyConnectionNames } from "../apiKeyConnectionName";

import { loadProviderTestResults } from "../components/providerTestStore";

const FETCH_CONNECTIONS_TIMEOUT_MS = 20000;

const CODEX_USAGE_FETCH_TIMEOUT_MS = 20000;

const AUTO_PING_SETTINGS_KEYS = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing"
};

/** Keeps ConnectionLoading requests and handlers together. */
export default function useConnectionLoading({ autoPingQueue, currentProviderIdRef, fetchConnectionsGenerationRef, isCompatible, providerId, setAutoPing, setCodexPlans, setConcurrencyLimit, setConnections, setEgressBucketed, setErrorRules, setLoading, setPersistedTests, setProviderApiKeyConnectionNames, setProviderNode, setProviderStickyLimit, setProviderStrategy, setProxyPools, setProxyPoolsReadyForProvider, setRetryDelay, setRpmLimit, setSelectedConnectionIds, setThinkingMode }) {
  const fetchConnections = useCallback(() => {
    const requestProviderId = providerId;
    const requestGeneration = ++fetchConnectionsGenerationRef.current;
    const isCurrentRequest = () =>
    fetchConnectionsGenerationRef.current === requestGeneration &&
    currentProviderIdRef.current === requestProviderId;
    return Promise.all([
      fetch("/api/providers", { cache: "no-store", signal: AbortSignal.timeout(FETCH_CONNECTIONS_TIMEOUT_MS) }),
      fetch("/api/provider-nodes", { cache: "no-store", signal: AbortSignal.timeout(FETCH_CONNECTIONS_TIMEOUT_MS) }),
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store", signal: AbortSignal.timeout(FETCH_CONNECTIONS_TIMEOUT_MS) }),
      requestSettings({ cache: "no-store", signal: AbortSignal.timeout(FETCH_CONNECTIONS_TIMEOUT_MS) })]
      ).then(async ([connectionsRes, nodesRes, proxyPoolsRes, settingsRes]) => {
      const connectionsData = await connectionsRes.json();
      const nodesData = await nodesRes.json();
      const proxyPoolsData = await proxyPoolsRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      if (!isCurrentRequest()) return;
      if (connectionsRes.ok) {
        const allConnections = connectionsData.connections || [];
        const filtered = allConnections.filter((c) => c.provider === providerId);

        // Codex plan badges prefer the live usage plan; the connection's stored
        // OAuth metadata is only written at authorization time, so it goes stale
        // after an upgrade. Fails open per connection — a failed read leaves the
        // stored value to serve as the fallback (decolua/9router#3210).
        //
        // Computed BEFORE any setState so the whole group lands atomically after
        // one staleness check: setting rows first and bailing afterwards would
        // leave a switched-away provider's connections rendered.
        // Each connection's usage read is independently timed out so a stuck
        // credential refresh on ONE account (durindoor#951 — refresh can hang
        // past the server's own 15s budget when the usage fetch that follows
        // it has no bound of its own) cannot hold the whole page's spinner.
        let plans = {};
        if (providerId === "codex" && filtered.length > 0) {
          const entries = await Promise.all(filtered.map(async (connection) => {
            try {
              const usageRes = await fetch(`/api/usage/${connection.id}`, {
                signal: AbortSignal.timeout(CODEX_USAGE_FETCH_TIMEOUT_MS)
              });
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
        setPersistedTests(loadProviderTestResults(filtered.map((conn) => conn.id)));
        // Prune selection with the authoritative response, in the same batch.
        setSelectedConnectionIds((prev) => prev.filter((id) => filtered.some((conn) => conn.id === id)));
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
      const selectedRpm = (settingsData.rpmByProvider || {})[providerId];
      setRpmLimit(selectedRpm != null ? String(selectedRpm) : "");
      // OmniRoute #10920 / #11104, adapted: egress-bucketed cooldown opt-in and
      // operator error rules for this provider.
      setEgressBucketed((settingsData.egressBucketedProviders || []).includes(providerId));
      setErrorRules((settingsData.providerErrorRules || {})[providerId] || []);
      const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
      const apCfg = autoPingSettingsKey ? settingsData[autoPingSettingsKey] || {} : {};
      autoPingQueue.hydrate(
        Object.entries(apCfg.connections || {}).map(([id, enabled]) => [`${providerId}:${id}`, enabled])
      );
      setAutoPing({ enabled: apCfg.enabled === true, connections: apCfg.connections || {}, schedules: apCfg.schedules || {} });
      if (nodesRes.ok) {
        let node = (nodesData.nodes || []).find((entry) => entry.id === providerId) || null;

        // Newly created compatible nodes can be briefly unavailable on one worker.
        // Retry a few times before showing "Provider not found".
        if (!node && isCompatible) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            if (!isCurrentRequest()) return;
            const retryRes = await fetch("/api/provider-nodes", {
              cache: "no-store",
              signal: AbortSignal.timeout(FETCH_CONNECTIONS_TIMEOUT_MS)
            });
            if (!retryRes.ok) continue;
            const retryData = await retryRes.json();
            node = (retryData.nodes || []).find((entry) => entry.id === providerId) || null;
            if (node) break;
          }
        }

        if (isCurrentRequest()) setProviderNode(node);
      }
    }).catch((error) => {
      if (isCurrentRequest()) console.log("Error fetching connections:", error);
    }).finally(() => {
      // OAuth defaults to an explicit direct route, but must not start before
      // the selectable strict pools have either loaded or definitively failed.
      if (isCurrentRequest()) {
        setProxyPoolsReadyForProvider(requestProviderId);
        setLoading(false);
      }
    });
  }, [providerId, isCompatible, autoPingQueue]);

  return { fetchConnections };
}
