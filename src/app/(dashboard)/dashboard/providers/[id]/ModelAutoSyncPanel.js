"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import ModelCatalogProvenance from "./ModelCatalogProvenance";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import MotionIcon from "@/shared/ui/v5/motion/MotionIcon.jsx";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import { isBoolean, isRecord } from "@/shared/utils/typeChecks.js";
import "@/shared/ui/v5/providers/providers.css";

/**
 * Model auto-sync controls for one provider: the "Auto-update models" toggle,
 * the last sync result (new and removed models) and "Sync now".
 *
 * Reports the provider's effective synced model list through
 * `onModelsChange` (null = use the registry defaults) so the page lists the
 * same models /v1/models does. Renders nothing for providers without a
 * list-models API. Failed manual refreshes retain the displayed catalog and
 * release the pending controls so discovery can be retried; they do not test inference.
 */
function IncumbentModelAutoSyncPanel({ providerId, hasConnection, onModelsChange }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const operation = useRef(0);
  const loadRequest = useRef(0);

  const load = useCallback(async (generation = operation.current) => {
    const request = ++loadRequest.current;
    try {
      const res = await fetch(`/api/models/auto-sync?provider=${encodeURIComponent(providerId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Catalog refresh failed");
      const data = await res.json();
      if (generation !== operation.current || request !== loadRequest.current) return;
      const next = data?.providers?.[providerId] || null;
      setStatus(next ? { ...next, intervalHours: data.intervalHours } : null);
      onModelsChange(next?.eligible && Array.isArray(next.models) ? next.models : null);
    } catch {
      if (generation !== operation.current || request !== loadRequest.current) return;
      setMessage("Could not refresh the model list. The displayed list is unchanged. Try Sync now again.");
    }
  }, [providerId, onModelsChange]);

  useEffect(() => {
    const generation = ++operation.current;
    load(generation);
    return () => { operation.current += 1; };
  }, [load]);

  if (!status?.eligible) return null;

  const setEnabled = async (value) => {
    const generation = operation.current;
    setBusy(true);
    setMessage("");
    try {
      const settingsResponse = await fetch("/api/settings", { cache: "no-store" });
      if (!settingsResponse.ok) throw new Error("Could not read auto-update settings");
      const current = await settingsResponse.json();
      if (generation !== operation.current) return;
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelAutoSyncProviders: { ...(current.modelAutoSyncProviders || {}), [providerId]: value === true } })
      });
      if (generation !== operation.current) return;
      if (!res.ok) {
        setMessage("Could not save the auto-update setting.");
        return;
      }
      // The accepted setting is authoritative even if refreshing its catalog fails.
      setStatus((previous) => previous ? { ...previous, enabled: value === true } : previous);
      await load(generation);
    } catch {
      if (generation === operation.current) setMessage("Could not save the auto-update setting.");
    } finally {
      if (generation === operation.current) setBusy(false);
    }
  };

  const syncNow = async () => {
    const generation = operation.current;
    setBusy(true);
    setMessage("Syncing models…");
    try {
      const res = await fetch("/api/models/auto-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId })
      });
      const data = await res.json().catch(() => null);
      if (generation !== operation.current) return;
      const result = data?.results?.[0];
      if (!res.ok) setMessage(data?.error || "Sync failed.");
      else if (result?.status === "synced") setMessage(`Synced ${result.modelCount} models.`);
      else setMessage(result?.error ? `Sync failed: ${result.error}. The previous model list is kept.` : "Nothing to sync.");
      await load(generation);
    } catch {
      if (generation === operation.current) setMessage("Could not sync models. The displayed list is unchanged. Try Sync now again.");
    } finally {
      if (generation === operation.current) setBusy(false);
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
      <ModelCatalogProvenance providerId={providerId} status={status} />
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

/**
 * V5 presentation for the same auto-sync contract. Status reads abort on
 * unmount and ignore a response from an older provider. The settings PATCH
 * still merges `modelAutoSyncProviders`.
 */
function V5ModelAutoSyncPanel({ providerId, hasConnection, onModelsChange }) {
  const [status, setStatus] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [message, setMessage] = useState("");
  const [seenProviderId, setSeenProviderId] = useState(providerId);
  const operation = useRef(0);
  const controller = useRef(null);
  const onModelsChangeRef = useRef(onModelsChange);

  if (seenProviderId !== providerId) {
    setSeenProviderId(providerId);
    setStatus(null);
    setPhase("loading");
    setMessage("");
  }

  useEffect(() => {
    onModelsChangeRef.current = onModelsChange;
  }, [onModelsChange]);

  const begin = () => {
    const generation = ++operation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    return { generation, signal: abort.signal };
  };

  const load = useCallback(async (generation, signal, { keepMessage = false, preserveError = false } = {}) => {
    try {
      const res = await fetch(`/api/models/auto-sync?provider=${encodeURIComponent(providerId)}`, { cache: "no-store", signal });
      if (signal?.aborted || generation !== operation.current) return;
      if (!res.ok) throw new Error("Model sync status is unavailable.");
      const data = await res.json();
      const next = data?.providers?.[providerId];
      if (!isRecord(next) || !isBoolean(next.eligible) || !isBoolean(next.enabled)) {
        throw new Error("Model sync status is unavailable.");
      }
      if (signal?.aborted || generation !== operation.current) return;
      setStatus({ ...next, intervalHours: data.intervalHours });
      if (!preserveError) setPhase("ready");
      if (!keepMessage) setMessage("");
      onModelsChangeRef.current?.(next.eligible && Array.isArray(next.models) ? next.models : null);
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted || generation !== operation.current) return;
      setPhase("error");
      setMessage(error.message || "Model sync status is unavailable.");
    }
  }, [providerId]);

  useEffect(() => {
    const { generation, signal } = begin();
    // Status arrives after paint so the loading state is the first render.
    const pending = Promise.resolve().then(() => {
      if (generation === operation.current) load(generation, signal);
    });
    return () => {
      operation.current += 1;
      controller.current?.abort();
      void pending;
    };
  }, [load]);

  const setEnabled = async (value) => {
    const { generation, signal } = begin();
    setPhase("saving");
    setMessage("");
    try {
      const settingsResponse = await fetch("/api/settings", { cache: "no-store" });
      if (!settingsResponse.ok) throw new Error("Could not save the auto-update setting.");
      const current = await settingsResponse.json();
      if (generation !== operation.current) return;
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelAutoSyncProviders: { ...(current.modelAutoSyncProviders || {}), [providerId]: value === true } })
      });
      if (generation !== operation.current) return;
      if (!res.ok) throw new Error("Could not save the auto-update setting.");
      setStatus((previous) => previous ? { ...previous, enabled: value === true } : previous);
      setMessage(value === true ? "Automatic updates enabled." : "Automatic updates paused.");
      await load(generation, signal, { keepMessage: true });
    } catch (error) {
      if (error?.name === "AbortError" || generation !== operation.current) return;
      setMessage(error.message || "Could not save the auto-update setting.");
      setPhase("error");
    }
  };

  const syncNow = async () => {
    const { generation, signal } = begin();
    setPhase("syncing");
    setMessage("Syncing models…");
    try {
      const res = await fetch("/api/models/auto-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId })
      });
      const data = await res.json().catch(() => null);
      if (generation !== operation.current) return;
      const result = data?.results?.[0];
      const failed = !res.ok || result?.status === "failed" || Boolean(result?.error);
      if (!res.ok) setMessage(data?.error || "Sync failed.");
      else if (result?.status === "synced") setMessage(`Synced ${result.modelCount} models.`);
      else setMessage(result?.error ? `Sync failed: ${result.error}. The previous model list is kept.` : "Nothing to sync.");
      if (failed) setPhase("error");
      await load(generation, signal, { keepMessage: true, preserveError: failed });
    } catch (error) {
      if (error?.name === "AbortError" || generation !== operation.current) return;
      setMessage("Could not sync models. The displayed list is unchanged. Try Sync now again.");
      setPhase("error");
    }
  };

  const retry = () => {
    const { generation, signal } = begin();
    setPhase("loading");
    setMessage("");
    load(generation, signal);
  };

  const busy = phase === "loading" || phase === "saving" || phase === "syncing";
  const eligible = status?.eligible === true;
  const unsupported = status?.eligible === false;
  const newIds = status?.newModelIds || [];
  const removedIds = status?.removedModelIds || [];
  const stateLabel = phase === "syncing" ? "Syncing" : phase === "saving" ? "Saving" : phase === "loading" ? "Loading" : unsupported ? "Unavailable" : status?.enabled ? "Enabled" : "Paused";
  const stateIcon = unsupported ? "block" : status?.enabled ? "check" : "pause";
  const intervalHours = Number(status?.intervalHours) > 0 ? status.intervalHours : null;

  return (
    <section className="v5-provider-sync" aria-labelledby="v5-provider-sync-title" aria-busy={busy ? "true" : undefined}>
      <div className="v5-provider-sync-heading">
        <div>
          <h2 id="v5-provider-sync-title"><MotionIcon name="sync" />Model auto-sync</h2>
          <p>Custom models kept</p>
        </div>
        <span className="v5-provider-sync-state"><MotionIcon name={stateIcon} size={16} />{stateLabel}</span>
      </div>
      {phase === "loading" ? <div className="v5-provider-sync-loading" role="status">Loading model sync status…</div> : unsupported ? <p>This provider has no model-list API. Manage its catalog in Available Models.</p> : <>
        {status ? <Toggle label="Auto-update models" checked={status.enabled} onChange={setEnabled} disabled={busy} description={intervalHours ? `Every ${intervalHours} hours. Custom models are always kept.` : "Custom models are always kept."} /> : null}
        {status ? <dl className="v5-provider-sync-metrics">
          <div><dt>Last sync</dt><dd>{status.syncedAt ? new Date(status.syncedAt).toLocaleString() : "Not synced"}</dd></div>
          <div><dt>Models</dt><dd>{status.models?.length || 0}</dd></div>
          <div><dt>Added</dt><dd>{newIds.length}</dd></div>
          <div><dt>Removed</dt><dd>{removedIds.length}</dd></div>
        </dl> : null}
        {eligible ? <ModelCatalogProvenance providerId={providerId} status={status} /> : null}
        {newIds.length || removedIds.length ? <details className="v5-provider-sync-changes"><summary>Catalog changes</summary><div>{newIds.length ? <div><h3>Added</h3><ul>{newIds.map((id) => <li key={id}><MotionIcon name="add" size={16} /><code>{id}</code></li>)}</ul></div> : null}{removedIds.length ? <div><h3>Removed</h3><ul>{removedIds.map((id) => <li key={id}><MotionIcon name="remove" size={16} /><code>{id}</code></li>)}</ul></div> : null}</div></details> : null}
        {status?.error ? <p className="v5-provider-sync-error" role="alert">Last attempt failed: {status.error}</p> : null}
        {!hasConnection && eligible ? <p>Add an active connection to sync this provider’s catalog.</p> : null}
        {message ? <p role={phase === "error" ? "alert" : "status"} className={phase === "error" ? "v5-provider-sync-error" : "v5-provider-sync-message"}>{message}</p> : null}
        <div className="v5-provider-sync-actions">
          {phase === "error" ? <Button variant="secondary" size="sm" onClick={retry}>Retry status</Button> : null}
          <Button size="sm" variant="secondary" icon="sync" onClick={syncNow} disabled={busy || !hasConnection || !status?.enabled || !eligible}>{phase === "syncing" ? "Syncing…" : "Sync now"}</Button>
        </div>
      </>}
    </section>
  );
}

export default function ModelAutoSyncPanel(props) {
  const v5 = useUiV5();
  return v5 ? <V5ModelAutoSyncPanel {...props} /> : <IncumbentModelAutoSyncPanel {...props} />;
}
