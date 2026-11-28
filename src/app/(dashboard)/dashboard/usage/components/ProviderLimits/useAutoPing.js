import { useState, useEffect, useCallback } from "react";
import { requestSettings } from "@/store/settingsStore";
import { createLatestIntentQueue } from "@/shared/utils/latestIntentQueue";
import { AUTO_PING_SETTINGS_KEYS } from "./connectionDisplay";

/** Per-connection auto-ping toggles; the settings load also hydrates quota visibility. */
export function useAutoPing(setQuotaVisibility) {
  const [autoPingMaps, setAutoPingMaps] = useState({ claude: {}, codex: {} });
  const [autoPingQueue] = useState(() => createLatestIntentQueue({
    write: async (_key, enabled, { connectionId }) => {
      const response = await fetch(`/api/providers/${encodeURIComponent(connectionId)}/auto-ping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      if (!response.ok) throw new Error(`Auto-ping update failed (${response.status})`);
      return response.json();
    },
    onOptimistic: (_key, enabled, { connectionId, provider }) => setAutoPingMaps((current) => ({
      ...current,
      [provider]: { ...(current[provider] || {}), [connectionId]: enabled }
    })),
    onConfirmed: (_key, enabled, { connectionId, provider }) => setAutoPingMaps((current) => ({
      ...current,
      [provider]: { ...(current[provider] || {}), [connectionId]: enabled }
    })),
    onRollback: (_key, enabled, { connectionId, provider }) => setAutoPingMaps((current) => ({
      ...current,
      [provider]: { ...(current[provider] || {}), [connectionId]: enabled }
    }))
  }));

  // Load auto-ping per-connection maps
  useEffect(() => {
    requestSettings({ cache: "no-store" }).
    then((r) => r.ok ? r.json() : {}).
    then((s) => {
      const maps = {
        claude: s?.claudeAutoPing?.connections || {},
        codex: s?.codexAutoPing?.connections || {}
      };
      autoPingQueue.hydrate(Object.entries(maps).flatMap(([provider, connectionsMap]) =>
      Object.entries(connectionsMap).map(([id, enabled]) => [`${provider}:${id}`, enabled])
      ));
      setAutoPingMaps(maps);
      setQuotaVisibility(s?.quotaVisibility || {});
    }).
    catch(() => {});
  }, [autoPingQueue, setQuotaVisibility]);

  const toggleAutoPing = useCallback(async (connectionId, provider, on) => {
    const settingsKey = AUTO_PING_SETTINGS_KEYS[provider];
    if (!settingsKey) return;
    await autoPingQueue.enqueue(`${provider}:${connectionId}`, on, { connectionId, provider });
  }, [autoPingQueue]);

  return { autoPingMaps, toggleAutoPing };
}
