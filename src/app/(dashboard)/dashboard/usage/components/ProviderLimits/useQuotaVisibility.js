import { useState, useEffect, useCallback, useRef } from "react";
import { requestSettings } from "@/store/settingsStore";
import { getQuotaVisibilityKey, updateQuotaVisibility } from "./utils";

/** Hidden quota rows, written to settings through one ordered queue with rollback. */
export function useQuotaVisibility() {
  const [quotaVisibility, setQuotaVisibility] = useState({});
  const pendingWrites = useRef([]);
  const isProcessingWrites = useRef(false);
  const quotaVisibilityRef = useRef(quotaVisibility);
  useEffect(() => {
    quotaVisibilityRef.current = quotaVisibility;
  }, [quotaVisibility]);

  const processQueue = useCallback(async () => {
    if (isProcessingWrites.current) return;
    isProcessingWrites.current = true;
    try {
      while (pendingWrites.current.length > 0) {
        const batch = pendingWrites.current.splice(0);
        const startState = quotaVisibilityRef.current;
        const nextState = batch.reduce((state, mutate) => mutate(state), startState);
        setQuotaVisibility(nextState);
        quotaVisibilityRef.current = nextState;
        try {
          const response = await requestSettings({
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quotaVisibility: nextState })
          });
          if (!response.ok) throw new Error("Failed to update quota visibility");
        } catch (error) {
          console.error("Error updating quota visibility:", error);
          setQuotaVisibility(startState);
          quotaVisibilityRef.current = startState;
        }
      }
    } finally {
      isProcessingWrites.current = false;
    }
  }, []);

  const handleHideQuota = useCallback((connectionId, provider, quota) => {
    const key = getQuotaVisibilityKey(quota, quota.visibilityIndex);
    if (!connectionId || !key) return;

    // Family-key pruning for Antigravity ("gemini"/"claude") lives inside
    // updateQuotaVisibility (utils.js), which each queued mutation applies.
    pendingWrites.current.push((state) =>
    updateQuotaVisibility(state, connectionId, provider, key, true)
    );
    processQueue();
  }, [processQueue]);
  const handleShowQuota = useCallback((connectionId, provider, quota) => {
    const key = getQuotaVisibilityKey(quota, quota.visibilityIndex);
    if (!connectionId || !key) return;

    pendingWrites.current.push((state) =>
    updateQuotaVisibility(state, connectionId, provider, key, false)
    );
    processQueue();
  }, [processQueue]);

  return { quotaVisibility, setQuotaVisibility, handleHideQuota, handleShowQuota };
}
