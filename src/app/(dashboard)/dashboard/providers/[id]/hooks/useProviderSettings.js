"use client";

import { dashboardRequest } from "../dashboardRequest";

import { requestSettings } from "@/store/settingsStore";

import { MAX_PROVIDER_RPM } from "@/shared/constants/providers";

const AUTO_PING_SETTINGS_KEYS = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing"
};

/** Keeps ProviderSettings requests and handlers together. */
export default function useProviderSettings({ autoPingQueue, providerId, providerStickyLimit, setAutoPing, setConcurrencyLimit, setEgressBucketed, setErrorRules, setProviderStickyLimit, setProviderStrategy, setRetryDelay, setThinkingMode }) {
  const saveProviderStrategy = async (strategy, stickyLimit) => {
    try {
      const settingsRes = await requestSettings({ cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerStrategies || {};

      // Build override: null strategy means remove override, use global
      const override = {};
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") {
        const limit = Number(stickyLimit);
        override.stickyRoundRobinLimit = limit >= 0 ? limit : 3;
      }

      const updated = { ...current };
      if (Object.keys(override).length === 0) {
        delete updated[providerId];
      } else {
        updated[providerId] = override;
      }

      await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated })
      });
    } catch (error) {
      console.log("Error saving provider strategy:", error);
    }
  };

  const handleRoundRobinToggle = (enabled) => {
    const strategy = enabled ? "round-robin" : null;
    const sticky = enabled ? providerStickyLimit || "1" : providerStickyLimit;
    if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
    setProviderStrategy(strategy);
    saveProviderStrategy(strategy, sticky);
  };

  const handleStickyLimitChange = (value) => {
    setProviderStickyLimit(value);
    saveProviderStrategy("round-robin", value);
  };

  const handleCacheAffinityToggle = (enabled) => {
    const strategy = enabled ? "cache-affinity" : null;
    setProviderStrategy(strategy);
    saveProviderStrategy(strategy, providerStickyLimit);
  };

  const handleEarliestResetToggle = (enabled) => {
    const strategy = enabled ? "earliest-reset" : null;
    setProviderStrategy(strategy);
    saveProviderStrategy(strategy, providerStickyLimit);
  };

  const saveThinkingConfig = async (mode) => {
    try {
      const settingsRes = await requestSettings({ cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerThinking || {};
      const updated = { ...current };
      if (!mode || mode === "auto") {
        delete updated[providerId];
      } else {
        updated[providerId] = { mode };
      }
      await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerThinking: updated })
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
      const settingsRes = await requestSettings({ cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerConcurrencyLimits || {};
      const updated = { ...current };
      const numVal = parseInt(value, 10);
      if (value && Number.isFinite(numVal) && numVal > 0) {
        updated[providerId] = numVal;
      } else {
        delete updated[providerId];
      }
      await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerConcurrencyLimits: updated })
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
      const settingsRes = await requestSettings({ cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const updated = { ...(settingsData.retryDelayByProvider || {}) };
      if (value === "auto") delete updated[providerId];else
      updated[providerId] = Number(value);
      await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryDelayByProvider: updated })
      });
    } catch (error) {
      console.log("Error saving retry delay:", error);
    }
  };

  const handleRetryDelayChange = (value) => {
    setRetryDelay(value);
    saveRetryDelay(value);
  };

  /** Persist decolua/9router#3203 per-account RPM; blank restores provider default, zero disables. */
  const saveRpmLimit = async (value) => {
    try {
      const settingsRes = await requestSettings({ cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const updated = { ...(settingsData.rpmByProvider || {}) };
      const trimmed = String(value ?? "").trim();
      if (!trimmed) delete updated[providerId];else
      updated[providerId] = Math.min(MAX_PROVIDER_RPM, Math.max(0, Number.parseInt(trimmed, 10) || 0));
      await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rpmByProvider: updated })
      });
    } catch (error) {
      console.log("Error saving RPM limit:", error);
    }
  };

  /** OmniRoute #10920, adapted: opt this provider into egress-IP-bucketed 429 cooldown. */
  const saveEgressBucketed = async (checked) => {
    try {
      const settingsRes = await requestSettings({ cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = new Set(settingsData.egressBucketedProviders || []);
      if (checked) current.add(providerId);else current.delete(providerId);
      await requestSettings({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ egressBucketedProviders: Array.from(current) })
      });
    } catch (error) {
      console.log("Error saving egress-bucketed cooldown:", error);
    }
  };

  const handleEgressBucketedChange = (checked) => {
    setEgressBucketed(checked);
    saveEgressBucketed(checked);
  };

  /**
   * OmniRoute #11104, adapted: persist this provider's operator error rules.
   * Throws on a non-ok response so the modal can surface the server's
   * validation message instead of silently discarding the edit.
   */
  const saveErrorRules = async (rules) => {
    const settingsRes = await requestSettings({ cache: "no-store" });
    const settingsData = settingsRes.ok ? await settingsRes.json() : {};
    const updated = { ...(settingsData.providerErrorRules || {}) };
    if (rules.length > 0) updated[providerId] = rules;else delete updated[providerId];
    const res = await requestSettings({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerErrorRules: updated })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to save error rules");
    }
    setErrorRules(rules);
  };

  const handleAutoPingConnection = (connectionId, on) => {
    if (!AUTO_PING_SETTINGS_KEYS[providerId]) return;
    autoPingQueue.enqueue(`${providerId}:${connectionId}`, on, { connectionId });
  };

  // Schedule-only write: omits `enabled` so the reactive toggle queue keeps
  // sole ownership of that flag.
  const handleSaveAutoPingSchedule = async (connectionId, schedule) => {
    const response = await dashboardRequest(`/api/providers/${encodeURIComponent(connectionId)}/auto-ping`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schedule })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Auto-ping schedule update failed (${response.status})`);
    setAutoPing((current) => ({ ...current, schedules: { ...current.schedules, [connectionId]: data.schedule || undefined } }));
  };

  return { handleAutoPingConnection, handleCacheAffinityToggle, handleConcurrencyLimitChange, handleEarliestResetToggle, handleEgressBucketedChange, handleRetryDelayChange, handleRoundRobinToggle, handleSaveAutoPingSchedule, handleStickyLimitChange, handleThinkingModeChange, saveErrorRules, saveRpmLimit };
}
