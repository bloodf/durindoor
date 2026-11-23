"use client";

import { translate } from "@/i18n/runtime";

import { isBrowser, isObject, isString } from "../../../../../../shared/utils/typeChecks.js";

/** Keeps CustomModels requests and handlers together. */
export default function useCustomModels({ connections, fetchAliases, fetchCustomModels, importingQoderModels, providerAlias, providerStorageAlias, setImportingQoderModels }) {
  const handleSetAlias = async (modelId, alias, providerAliasOverride = providerAlias) => {
    const fullModel = `${providerAliasOverride}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias })
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
        method: "DELETE"
      });
      if (res.ok) {
        await fetchAliases();
      }
    } catch (error) {
      console.log("Error deleting alias:", error);
    }
  };

  const handleAddCustomModel = async (payload, type = "llm", providerAliasOverride = providerStorageAlias) => {
    const modelId = isString(payload) ? payload : payload.id;
    const capabilities = isObject(payload) && payload !== null && !Array.isArray(payload) ? payload.capabilities : undefined;
    try {
      const res = await fetch("/api/models/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerAliasOverride, id: modelId, type, capabilities })
      });
      if (res.ok) {
        await fetchCustomModels();
        if (isBrowser()) window.dispatchEvent(new CustomEvent("customModelChanged"));
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
        body: JSON.stringify({ providerAlias: providerStorageAlias, id, type: "llm", capabilities })
      });
      if (res.ok) {
        await fetchCustomModels();
        if (isBrowser()) window.dispatchEvent(new CustomEvent("customModelChanged"));
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
        if (isBrowser()) window.dispatchEvent(new CustomEvent("customModelChanged"));
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

      for (const model of models) {
        if (!model.id) continue;
        const id = model.id.replace(/^(qoder-cn|qoder)\//, "");
        const name = model.name || id;
        const payload = { providerAlias: providerStorageAlias, id, type: "llm", name };
        const headers = { "Content-Type": "application/json" };
        const body = JSON.stringify(payload);
        let saved = await fetch("/api/models/custom", { method: "POST", headers, body });
        if (saved.status === 409) {
          saved = await fetch("/api/models/custom", { method: "PATCH", headers, body });
        }
        if (!saved.ok) {
          const error = await saved.json().catch(() => ({}));
          throw new Error(error.error || translate("Failed to save model"));
        }
      }
      await fetchCustomModels();
      window.dispatchEvent(new CustomEvent("customModelChanged"));
      alert(translate("Successfully updated") + ` ${models.length} ` + translate("models"));
    } catch (error) {
      console.log("Error importing Qoder models:", error);
      alert(translate("Error fetching models") + ": " + error.message);
    } finally {
      setImportingQoderModels(false);
    }
  };

  // Persist only the safe status and fixed guidance, never the upstream text.

  return { handleAddCustomModel, handleDeleteAlias, handleDeleteCustomModel, handleImportQoderModels, handleSetAlias, handleUpdateCustomModel };
}
