"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";

/**
 * Model auto-sync controls for one provider: the "Auto-update models" toggle,
 * the last sync result (new and removed models) and "Sync now".
 *
 * Reports the provider's effective synced model list through
 * `onModelsChange` (null = use the registry defaults) so the page lists the
 * same models /v1/models does. Renders nothing for providers without a
 * list-models API.
 */
export default function ModelAutoSyncPanel({ providerId, hasConnection, onModelsChange }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/models/auto-sync?provider=${encodeURIComponent(providerId)}`, { cache: "no-store" });
      const data = res.ok ? await res.json() : null;
      const next = data?.providers?.[providerId] || null;
      setStatus(next);
      onModelsChange(next?.eligible && Array.isArray(next.models) ? next.models : null);
    } catch {
      setStatus(null);
      onModelsChange(null);
    }
  }, [providerId, onModelsChange]);

  useEffect(() => {
    load();
  }, [load]);

  if (!status?.eligible) return null;

  const setEnabled = async (value) => {
    setBusy(true);
    setMessage("");
    try {
      const current = await fetch("/api/settings", { cache: "no-store" }).then((r) => r.ok ? r.json() : {});
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelAutoSyncProviders: { ...(current.modelAutoSyncProviders || {}), [providerId]: value === true } })
      });
      if (!res.ok) setMessage("Could not save the auto-update setting.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setMessage("Syncing models…");
    try {
      const res = await fetch("/api/models/auto-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId })
      });
      const data = await res.json().catch(() => null);
      const result = data?.results?.[0];
      if (!res.ok) setMessage(data?.error || "Sync failed.");
      else if (result?.status === "synced") setMessage(`Synced ${result.modelCount} models.`);
      else setMessage(result?.error ? `Sync failed: ${result.error}. The previous model list is kept.` : "Nothing to sync.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const syncedAt = status.syncedAt ? new Date(status.syncedAt).toLocaleString() : null;
  const summary = syncedAt ?
  `Last synced ${syncedAt} · ${status.newModelIds.length} new, ${status.removedModelIds.length} removed` :
  "Not synced yet. The built-in model list is used until the first successful sync.";

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-dd-lg border border-dd-border-subtle bg-dd-surface-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Toggle
          size="sm"
          label="Auto-update models"
          description="Fetch this provider's model list from its API and publish exactly what it returns. Custom models are always kept."
          checked={status.enabled}
          onChange={setEnabled}
          disabled={busy} />
        <Button size="sm" variant="secondary" icon="sync" onClick={syncNow} disabled={busy || !hasConnection || !status.enabled}>
          {busy ? "Syncing…" : "Sync now"}
        </Button>
      </div>
      <p className="text-[11px] text-dd-muted">{summary}</p>
      {status.newModelIds.length > 0 &&
      <p className="break-words text-[11px] text-dd-success">New: {status.newModelIds.join(", ")}</p>
      }
      {status.removedModelIds.length > 0 &&
      <p className="break-words text-[11px] text-dd-warning">Removed in last sync: {status.removedModelIds.join(", ")}</p>
      }
      {status.error &&
      <p className="break-words text-[11px] text-dd-danger">Last attempt failed: {status.error}</p>
      }
      {message ? <p role="status" className="text-[11px] text-dd-muted">{message}</p> : null}
    </div>);

}
