"use client";

import api from "@/shared/utils/api";

import { useEffect, useState } from "react";
import { Button, Modal } from "@/shared/components";
import { isString } from "@/shared/utils/typeChecks.js";

/** Discover models from one connection and keep selections across refreshes. */
export default function SyncProviderModelsModal({ connections, existingIds, providerAlias, passthrough, onClose, onSaved }) {
  const [connectionId, setConnectionId] = useState(connections[0]?.id || "");
  const [models, setModels] = useState([]);
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!connectionId) return;
    const controller = new AbortController();
    setLoading(true);
    setMessage("");
    api.get(`/api/providers/${encodeURIComponent(connectionId)}/models`, { cache: "no-store", signal: controller.signal, defaultHeaders: false })
      .catch((error) => { if (error.status) throw new Error(error.body?.error || "Model discovery failed"); throw error; })
      .then((data) => {
        const unique = new Map();
        for (const item of Array.isArray(data.models) ? data.models : []) {
          const id = isString(item) ? item : item?.id || item?.modelId || item?.model;
          if (isString(id) && id.trim() && !unique.has(id)) unique.set(id, { id, name: item?.name || item?.modelName || id });
        }
        setModels([...unique.values()]);
        setMessage(data.warning || (unique.size ? "" : "No models returned by this connection."));
      })
      .catch((error) => { if (!controller.signal.aborted) setMessage(error.message || "Model discovery failed"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [connectionId, refresh]);

  const visible = models.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(query.toLowerCase()));
  const available = selected.filter((id) => !existingIds.includes(id));
  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      await api.post("/api/models/discovered", { providerAlias, ids: available, passthrough }).catch((error) => { if (error.status) throw new Error(error.body?.error || "Could not add selected models"); throw error; });
      await onSaved();
      onClose();
    } catch (error) {
      setMessage(`${error.message || "Could not add selected models"}. Your selection is kept; retry.`);
    } finally { setSaving(false); }
  };

  return <Modal isOpen onClose={saving ? () => {} : onClose} title="Sync upstream models" size="full">
    <div className="flex max-h-[70vh] flex-col gap-3">
      <label className="text-sm">Connection
        <select className="block w-full rounded-dd border border-dd-border bg-dd-surface p-2" value={connectionId} onChange={(event) => { setConnectionId(event.target.value); setModels([]); setSelected([]); }}>
          {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name || connection.email || connection.id}</option>)}
        </select>
      </label>
      <Button size="sm" variant="secondary" disabled={loading || saving} onClick={() => setRefresh((value) => value + 1)}>Refresh models</Button>
      <label className="text-sm">Search models
        <input className="block w-full rounded-dd border border-dd-border bg-dd-surface p-2" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setSelected((previous) => [...new Set([...previous, ...visible.filter((model) => !existingIds.includes(model.id)).map((model) => model.id)])])}>Select visible</Button><Button size="sm" variant="secondary" onClick={() => setSelected([])}>Clear</Button></div>
      <p role="status" className="break-words text-sm text-dd-muted">{loading ? "Loading models…" : message}</p>
      <div className="min-h-32 overflow-y-auto rounded-dd border border-dd-border p-2">
        {!loading && visible.length === 0 && <p className="text-sm text-dd-muted">No matching models.</p>}
        {visible.map((model) => <label className="flex min-h-11 items-center gap-2 break-all text-sm" key={model.id}><input type="checkbox" disabled={existingIds.includes(model.id)} checked={selected.includes(model.id) && !existingIds.includes(model.id)} onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, model.id] : previous.filter((id) => id !== model.id))} /><span>{model.id}{existingIds.includes(model.id) ? " (added)" : ""}</span></label>)}
      </div>
      <div className="flex flex-wrap justify-end gap-2"><span className="text-sm text-dd-muted">{available.length} selected</span><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving || !available.length}>{saving ? "Adding…" : "Add selected"}</Button></div>
    </div>
  </Modal>;
}
