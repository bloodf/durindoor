"use client";

import { useCallback } from "react";
import { loadModelAliases } from "@/shared/utils/modelAliases";

/** Keeps ModelVisibility requests and handlers together. */
export default function useModelVisibility({ currentProviderIdRef, providerId, providerStorageAlias, setConfirmState, setCustomModels, setDisabledModelIds, setEnabledModelIds, setModelAliases }) {
  const fetchDisabledModels = useCallback(() => {
    return fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { cache: "no-store" }).then(async (res) => {
      const data = await res.json();
      if (res.ok) setDisabledModelIds(data.ids || []);
    }).catch((error) => {
      console.log("Error fetching disabled models:", error);
    });
  }, [providerStorageAlias]);

  // Visible-model allowlist for this provider (empty = no restriction).
  const fetchEnabledModels = useCallback(() => {
    const requestProviderId = providerId;
    return fetch(`/api/models/enabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { cache: "no-store" }).then(async (res) => {
      const data = await res.json();
      // A response for a provider the page has since switched away from must
      // not overwrite the current provider's banner.
      if (currentProviderIdRef.current !== requestProviderId) return;
      if (res.ok) setEnabledModelIds(data.ids || []);
    }).catch((error) => {
      console.log("Error fetching enabled models:", error);
    });
  }, [providerId, providerStorageAlias]);

  const handleDisableModel = async (modelId) => {
    try {
      const res = await fetch("/api/models/disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, ids: [modelId] })
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
            body: JSON.stringify({ providerAlias: providerStorageAlias, ids })
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
  const fetchAliases = useCallback(() => {
    return loadModelAliases(setModelAliases, "Error fetching aliases:");
  }, []);

  const fetchCustomModels = useCallback(() => {
    return fetch("/api/models/custom", { cache: "no-store" }).then(async (res) => {
      const data = await res.json();
      if (res.ok) {
        setCustomModels(data.models || []);
      }
    }).catch((error) => {
      console.log("Error fetching custom models:", error);
    });
  }, []);

  return { fetchAliases, fetchCustomModels, fetchDisabledModels, fetchEnabledModels, handleDisableAll, handleDisableModel, handleEnableAll, handleEnableModel };
}
