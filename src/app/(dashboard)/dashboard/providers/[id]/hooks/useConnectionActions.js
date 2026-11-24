"use client";

import { buildImportTokenPayload } from "@/shared/utils/importTokenProviders";

import { sortConnectionsByAvailability, persistConnectionOrder } from "@/shared/utils/connectionReorder";

import { replaceUpdatedConnections } from "@/shared/utils/connectionStatus";

import { deleteConnection, deleteConnections, bulkDeleteFailureMessage } from "../connectionDelete";

import { sanitizeErrorMessage } from "open-sse/utils/error.js";

/** Keeps ConnectionActions requests and handlers together. */
export default function useConnectionActions({ clearingCooldownId, connectionFilter, connections, fetchConnections, importTokenValue, notify, openOAuthConnection, providerGenerationRef, providerId, selectedConnection, selectedConnectionIds, setAddConnectionError, setBulkFailures, setBulkStatusAction, setClearingCooldownId, setConfirmState, setConnections, setImportTokenError, setImportTokenValue, setImportingToken, setReconnectConnectionId, setSelectedConnectionIds, setShowAddApiKeyModal, setShowEditModal, setShowIFlowCookieModal, setShowImportTokenModal, setShowOAuthModal }) {
  const handleDelete = async (id) => {
    setConfirmState({
      title: "Delete Connection",
      message: "Delete this connection?",
      onConfirm: async () => {
        setConfirmState(null);
        const result = await deleteConnection(id);
        if (result.ok) {
          setConnections((prev) => prev.filter((c) => c.id !== id));
          setSelectedConnectionIds((prev) => prev.filter((selectedId) => selectedId !== id));
        } else notify.error(result.error, "Connection not deleted");
      }
    });
  };

  const runBulkDelete = async (ids) => {
    if (ids.length === 0) return;
    const generation = providerGenerationRef.current;
    setBulkFailures([]);
    const result = await deleteConnections([...ids]);
    if (generation !== providerGenerationRef.current) return;
    setBulkFailures(result.failures.map(({ id, error }) => ({ id, name: connections.find((c) => c.id === id)?.name || id, reason: sanitizeErrorMessage(error) })));
    const deleted = new Set(result.deletedIds);
    setConnections((prev) => prev.filter((c) => !deleted.has(c.id)));
    // Failed rows stay listed and selected so the operator can fix and retry them.
    setSelectedConnectionIds((prev) => prev.filter((id) => !deleted.has(id)));
    if (result.failures.length > 0) notify.error(bulkDeleteFailureMessage(result), "Some connections were not deleted");
  };

  const handleOAuthSuccess = () => {
    fetchConnections();
    setShowOAuthModal(false);
    setReconnectConnectionId(null);
  };

  // Reconnect an expired OAuth account: re-run the same OAuth flow but stamp the
  // target connection id so completion replaces the failed row in place.
  const handleReconnect = (conn) => {
    setReconnectConnectionId(conn.id);
    openOAuthConnection();
  };

  const handleIFlowCookieSuccess = () => {
    fetchConnections();
    setShowIFlowCookieModal(false);
  };

  const handleImportTokenSubmit = async () => {
    setImportTokenError("");
    const payload = buildImportTokenPayload(importTokenValue);
    if (!payload) {
      setImportTokenError("Paste a Grok CLI auth.json file, raw JWT, or structured token body.");
      return;
    }

    setImportingToken(true);
    try {
      const res = await fetch(`/api/oauth/${providerId}/import-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Import failed (${res.status})`);
      }
      setImportTokenValue("");
      setShowImportTokenModal(false);
      await fetchConnections();
    } catch (error) {
      setImportTokenError(error.message || "Failed to import token");
    } finally {
      setImportingToken(false);
    }
  };

  const handleSaveApiKey = async (formData) => {
    setAddConnectionError("");
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, ...formData })
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (res.ok) {
        await fetchConnections();
        setShowAddApiKeyModal(false);
        return;
      }

      setAddConnectionError(data?.error || "Failed to save connection");
    } catch (error) {
      console.log("Error saving connection:", error);
      setAddConnectionError("Failed to save connection");
    }
  };

  const handleUpdateConnection = async (formData) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
      // Reject failures so the edit modal can preserve the draft and offer retry.
      if (!res.ok) throw new Error("Failed to save connection");
      if (res.ok) {
        await fetchConnections();
        setShowEditModal(false);
      }
    } catch (error) {
      throw error;
    }
  };

  const handleUpdateConnectionStatus = async (id, isActive) => {
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive })
      });
      if (res.ok) {
        const { connection } = await res.json();
        if (connection) setConnections((prev) => replaceUpdatedConnections(prev, [connection]));
      }
    } catch (error) {
      console.log("Error updating connection status:", error);
    }
  };

  // Manually lift a persisted 429 cooldown (port of OmniRoute #12224). The
  // bench is DurinDoor's own lesson, not upstream truth: a quota can refresh
  // upstream (daily/weekly reset, provider-side fix) well before our timer
  // does, and the only automatic clear paths (a successful retest, an
  // Edit-modal key re-validation) require another upstream round-trip first.
  const handleClearCooldown = async (id) => {
    if (!id || clearingCooldownId) return;
    setClearingCooldownId(id);
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rateLimitedUntil: null })
      });
      if (res.ok) {
        const { connection } = await res.json();
        if (connection) setConnections((prev) => replaceUpdatedConnections(prev, [connection]));
      }
    } catch (error) {
      console.log("Error clearing cooldown:", error);
    } finally {
      setClearingCooldownId(null);
    }
  };

  const handleBulkSetConnectionStatus = async (isActive, ids = selectedConnectionIds) => {
    const idsToUpdate = [...ids];
    if (idsToUpdate.length === 0) return;
    const generation = providerGenerationRef.current;

    setBulkFailures([]);
    setBulkStatusAction(isActive ? "on" : "off");
    try {
      const results = await Promise.all(
        idsToUpdate.map(async (id) => {
          try {
            const res = await fetch(`/api/providers/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isActive })
            });
            if (!res.ok) return { id, ok: false, reason: `HTTP ${res.status}` };
            const { connection } = await res.json();
            return { id, ok: true, connection };
          } catch (error) {
            console.log("Error updating connection status:", error);
            return { id, ok: false, reason: "Network error" };
          }
        })
      );

      if (generation !== providerGenerationRef.current) return;
      const successfulConnections = results.
      filter((result) => result.ok && result.connection).
      map((result) => result.connection);
      const failures = results.filter((result) => !result.ok);

      if (successfulConnections.length > 0) {
        setConnections((prev) => replaceUpdatedConnections(prev, successfulConnections));
      }

      setBulkFailures(failures.map(({ id, reason }) => ({ id, name: connections.find((c) => c.id === id)?.name || id, reason })));
      const succeeded = new Set(results.filter((result) => result.ok).map(({ id }) => id));
      setSelectedConnectionIds((prev) => prev.filter((id) => !succeeded.has(id)));
    } finally {
      if (generation === providerGenerationRef.current) setBulkStatusAction(null);
    }
  };

  // Per-connection PUTs (one per swapped row) raced under `reorderInTx`
  // normalization: two parallel writes each retarget only their own row, so
  // the server's most-recently-updated tiebreak could resolve the pair in
  // either order, and an untouched row's stale priority could collide with
  // one of the writes. Reuse the atomic reorder endpoint that
  // handleReorderByStatus already relies on instead of duplicating that bug.
  const handleSwapPriority = async (index1, index2) => {
    if (connectionFilter.length > 0) return;
    const newConnections = [...connections];
    [newConnections[index1], newConnections[index2]] = [newConnections[index2], newConnections[index1]];
    setConnections(newConnections);

    try {
      await persistConnectionOrder(providerId, newConnections);
    } catch (error) {
      console.log("Error swapping priority:", error);
      await fetchConnections();
    }
  };

  const handleReorderByStatus = async () => {
    if (connectionFilter.length > 0) return;
    const sorted = sortConnectionsByAvailability(connections);
    setConnections(sorted);

    try {
      await persistConnectionOrder(providerId, sorted);
    } catch (error) {
      console.log("Error reordering by status:", error);
      await fetchConnections();
    }
  };

  return { handleBulkSetConnectionStatus, handleClearCooldown, handleDelete, handleIFlowCookieSuccess, handleImportTokenSubmit, handleOAuthSuccess, handleReconnect, handleReorderByStatus, handleSaveApiKey, handleSwapPriority, handleUpdateConnection, handleUpdateConnectionStatus, runBulkDelete };
}
