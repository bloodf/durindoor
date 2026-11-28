import { useState, useCallback } from "react";
import { parseQuotaData, setQuotaCache, withCachedQuotaFallback } from "./utils";

/** Per-connection quota rows, loading flags and errors, plus the fetchers that fill them. */
export function useQuotaData(uiV5) {
  const [quotaData, setQuotaData] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchQuota = useCallback(async (connectionId, provider, { force = false, refresh = false } = {}) => {
    setLoading((prev) => ({ ...prev, [connectionId]: true }));
    setErrors((prev) => ({ ...prev, [connectionId]: null }));

    try {
      console.log(
        `[ProviderLimits] Fetching quota for ${provider} (${connectionId})${force ? " (force)" : ""}`
      );
      const url = `/api/usage/${connectionId}${refresh ? "?refresh=1" : force ? "?force=1" : ""}`;
      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || response.statusText;

        // Handle different error types gracefully
        if (response.status === 404) {
          // Connection not found - skip silently
          console.warn(
            `[ProviderLimits] Connection not found for ${provider}, skipping`
          );
          return;
        }

        if (response.status === 401) {
          // Auth error - show message instead of throwing
          console.warn(
            `[ProviderLimits] Auth error for ${provider}:`,
            errorMsg
          );
          const quotaEntry = {
            quotas: [],
            message: errorMsg
          };
          setQuotaData((prev) => ({
            ...prev,
            [connectionId]: quotaEntry
          }));
          setQuotaCache(connectionId, quotaEntry);
          return;
        }

        throw new Error(`HTTP ${response.status}: ${errorMsg}`);
      }

      const data = await response.json();
      console.log(`[ProviderLimits] Got quota for ${provider}:`, data);

      // Parse quota data using provider-specific parser
      const parsedQuotas = parseQuotaData(provider, data);
      // A rate-limited response with no rows (in-process cache lost to a server
      // restart) falls back to this connection's saved rows. `staleReason`
      // carries the reason forward; `message` is cleared so the renderer shows
      // the table instead of replacing it with a notice.
      const { quotas, staleReason } = withCachedQuotaFallback(connectionId, parsedQuotas, data);

      const quotaEntry = {
        quotas,
        plan: data.plan || null,
        notice: data.notice || null,
        message: staleReason ? null : data.message || null,
        staleReason: staleReason || data.staleReason || null,
        raw: data
      };

      setQuotaData((prev) => ({
        ...prev,
        [connectionId]: quotaEntry
      }));
      setQuotaCache(connectionId, quotaEntry);
    } catch (error) {
      if (!uiV5) console.error(
        `[ProviderLimits] Error fetching quota for ${provider} (${connectionId}):`,
        error
      );
      setErrors((prev) => ({
        ...prev,
        [connectionId]: error.message || "Failed to fetch quota"
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [connectionId]: false }));
    }
  }, [uiV5]);

  // Manual refresh bypasses the provider's valid in-process quota cache.
  const refreshProvider = useCallback(
    async (connectionId, provider) => {
      await fetchQuota(connectionId, provider, { force: true, refresh: true });
      setLastUpdated(new Date());
    },
    [fetchQuota]
  );

  return {
    quotaData,
    setQuotaData,
    loading,
    setLoading,
    errors,
    setErrors,
    lastUpdated,
    setLastUpdated,
    fetchQuota,
    refreshProvider
  };
}
