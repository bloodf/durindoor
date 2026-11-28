import { useState, useCallback } from "react";
import { isBrowser } from "../../../../../../shared/utils/typeChecks.js";
import { getQuotaCache, QUOTA_CACHE_KEY, reconcileConnectionsPage } from "./utils";

/** Row actions: limit resets, reset-credit details, delete, enable/disable, credential refresh and Ultrafast. */
export function useConnectionActions({
  fetchConnections,
  fetchQuota,
  refreshProvider,
  page,
  setQuotaData,
  setLoading,
  setErrors,
  setLastUpdated,
  setConnectionsError
}) {
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [resettingLimitId, setResettingLimitId] = useState(null);
  const [refreshingTokenId, setRefreshingTokenId] = useState(null);
  const [resetCreditsState, setResetCreditsState] = useState(null);

  const handleResetLimit = useCallback(
    async (connectionId, provider, grantId) => {
      if ((provider !== "codex" && provider !== "claude") || resettingLimitId) return;

      setResettingLimitId(connectionId);
      setErrors((prev) => ({ ...prev, [connectionId]: null }));

      try {
        const response = provider === "claude" ?
        await fetch(`/api/usage/${connectionId}/claude-reset`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grantId })
        }) :
        await fetch(`/api/usage/${connectionId}/codex-reset-credits`, { method: "POST" });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.message || result.error || result.code || "Failed to reset limit");
        }

        await fetchQuota(connectionId, provider, { force: true });
        setLastUpdated(new Date());
      } catch (error) {
        setErrors((prev) => ({ ...prev, [connectionId]: error.message || "Failed to reset limit" }));
      } finally {
        setResettingLimitId(null);
      }
    },
    [fetchQuota, resettingLimitId, setErrors, setLastUpdated]
  );

  const handleViewCodexResetCredits = useCallback(async (connection) => {
    setResetCreditsState({ connection, loading: true, error: null, data: null });
    try {
      const response = await fetch(`/api/usage/${connection.id}/codex-reset-credits`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || result.message || "Failed to load Codex reset credits");
      }
      const credits = Array.isArray(result.credits) ? [...result.credits] : [];
      credits.sort((a, b) => {
        const aTime = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      });
      setResetCreditsState({ connection, loading: false, error: null, data: { kind: "codex", ...result, credits } });
    } catch (error) {
      setResetCreditsState({ connection, loading: false, error: error.message || "Failed to load Codex reset credits", data: null });
    }
  }, []);

  // Claude grants arrive already parsed with the usage poll; no extra fetch needed.
  const handleViewClaudeResets = useCallback((connection, resetCredits) => {
    setResetCreditsState({ connection, loading: false, error: null, data: { kind: "claude", ...resetCredits } });
  }, []);

  const handleDeleteConnection = useCallback(
    async (id) => {
      setDeletingId(id);
      try {
        const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
        if (res.ok) {
          setQuotaData((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setLoading((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setErrors((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });

          if (isBrowser()) {
            try {
              const cache = getQuotaCache();
              if (cache[id]) {
                delete cache[id];
                window.localStorage.setItem(
                  QUOTA_CACHE_KEY,
                  JSON.stringify(cache)
                );
              }
            } catch (e) {
              console.error("Error deleting cache entry:", e);
            }
          }

          await reconcileConnectionsPage(fetchConnections, page);
        }
      } catch (error) {
        console.error("Error deleting connection:", error);
      } finally {
        setDeletingId(null);
      }
    },
    [fetchConnections, page, setErrors, setLoading, setQuotaData]
  );

  const handleToggleConnectionActive = useCallback(
    async (id, isActive) => {
      setTogglingId(id);
      try {
        const res = await fetch(`/api/providers/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive })
        });
        if (res.ok) {
          setQuotaData((prev) => {
            const next = { ...prev };
            return next;
          });
          await reconcileConnectionsPage(fetchConnections, page);
        }
      } catch (error) {
        console.error("Error updating connection status:", error);
      } finally {
        setTogglingId(null);
      }
    },
    [fetchConnections, page, setQuotaData]
  );

  const handleRefreshToken = useCallback(async (conn) => {
    setRefreshingTokenId(conn.id);
    setErrors((prev) => ({ ...prev, [conn.id]: null }));
    try {
      const response = await fetch(`/api/providers/${encodeURIComponent(conn.id)}/refresh-token`, { method: "POST" });
      if (!response.ok) throw new Error("Could not refresh the Codex credential.");
      await refreshProvider(conn.id, conn.provider);
    } catch (error) {
      setErrors((prev) => ({ ...prev, [conn.id]: error.message }));
    } finally {
      setRefreshingTokenId(null);
    }
  }, [refreshProvider, setErrors]);

  const handleUltrafast = useCallback(async (conn) => {
    setTogglingId(conn.id);
    try {
      const enabled = conn.providerSpecificData?.codexUltrafastMode !== true;
      const response = await fetch(`/api/providers/${conn.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerSpecificData: { codexUltrafastMode: enabled } })
      });
      if (!response.ok) throw new Error("Could not save Ultrafast setting");
      await reconcileConnectionsPage(fetchConnections, page);
    } catch (error) {
      setConnectionsError(error.message || "Could not save Ultrafast setting");
    } finally {
      setTogglingId(null);
    }
  }, [fetchConnections, page, setConnectionsError]);

  return {
    deletingId,
    togglingId,
    resettingLimitId,
    refreshingTokenId,
    resetCreditsState,
    setResetCreditsState,
    handleResetLimit,
    handleViewCodexResetCredits,
    handleViewClaudeResets,
    handleDeleteConnection,
    handleToggleConnectionActive,
    handleRefreshToken,
    handleUltrafast
  };
}
