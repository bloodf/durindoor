"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { isString, isObject } from "@/shared/utils/typeChecks.js";

export default function AddSystemoneCompatibleModal({ isOpen, onClose, onCreated, onSaved, node }) {
  const isEdit = !!node;
  const [form, setForm] = useState({ name: "", prefix: "", baseUrl: "http://localhost:3000/v1" });
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [registering, setRegistering] = useState("");
  const [error, setError] = useState("");
  const [discovery, setDiscovery] = useState("");
  const [models, setModels] = useState([]);

  useEffect(() => {
    if (!isOpen) return;
    setForm({ name: node?.name || "", prefix: node?.prefix || "", baseUrl: node?.baseUrl || "http://localhost:3000/v1" });
    setApiKey("");
    setError("");
    setDiscovery("");
    setModels([]);
  }, [isOpen, node]);

  const discover = async () => {
    setChecking(true);
    setError("");
    setDiscovery("");
    setModels([]);
    try {
      const res = await fetch("/api/provider-nodes/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "systemone-compatible", baseUrl: form.baseUrl, apiKey }) });
      const data = await res.json().catch(() => ({}));
      if (data.valid) {
        const ids = [...new Map((data.models || []).map((model) => isString(model) ? [model.trim(), { id: model.trim() }] : [model?.id?.trim(), { id: model?.id?.trim(), name: model?.name }]).filter(([id]) => id)).values()];
        setModels(ids);
        setDiscovery(ids.length ? "Choose discovered native model IDs to register." : "No models returned. Register native model ID manually after saving.");
      } else if (data.skipped || data.unsupported) setDiscovery(data.error);
      else setError(data.error || `Check failed (${res.status})`);
    } catch { setError("Network error while checking endpoint"); } finally { setChecking(false); }
  };

  const register = async (model) => {
    if (!node || form.prefix.trim() !== node.prefix) { setError("Save prefix changes before registering models"); return; }
    const id = model.id;
    setRegistering(id);
    setError("");
    try {
      const res = await fetch("/api/models/custom", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerAlias: node.prefix, id, name: model.name, type: "systemone" }) });
      if (!res.ok && res.status !== 409) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Could not register ${id}`);
        return;
      }
      setModels((current) => current.filter((candidate) => candidate.id !== id));
      setDiscovery(res.status === 409 ? `${id} already registered.` : `Registered ${id}.`);
    } catch { setError(`Network error while registering ${id}`); } finally { setRegistering(""); }
  };

  const save = async (event) => {
    event?.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch(isEdit ? `/api/provider-nodes/${node.id}` : "/api/provider-nodes", { method: isEdit ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isEdit ? form : { ...form, type: "systemone-compatible" }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || `Save failed (${res.status})`); return; }
      if (isEdit) onSaved?.(data.node); else onCreated?.(data.node);
    } catch { setError("Network error while saving node"); } finally { setSaving(false); }
  };

  return <Modal open={isOpen} title={isEdit ? "Edit Custom System One" : "Add Custom System One"} subtitle="Native System One endpoint. Connections use saved URL only." onClose={onClose} size="md" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="systemone-node-form" variant="primary" loading={saving} disabled={!form.name.trim() || !form.prefix.trim() || !form.baseUrl.trim()}>Save</Button></>}><form id="systemone-node-form" onSubmit={save} className="flex flex-col gap-4">{error && <p role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-3 py-2 text-sm text-dd-danger">{error}</p>}<Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Local System One" autoFocus /><Input label="Prefix" value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} placeholder="systemone-local" /><Input label="Base URL" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="http://localhost:3000/v1" /><div className="flex gap-2"><Input label="API Key (optional)" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Only used for discovery" className="flex-1" /><div className="pt-6"><Button type="button" variant="secondary" onClick={discover} loading={checking} disabled={!form.baseUrl.trim()}>Check</Button></div></div>{discovery && <p role="status" className="text-xs text-dd-muted">{discovery}</p>}{models.length > 0 && (isEdit ? <>{form.prefix.trim() !== node.prefix && <p className="text-xs text-dd-warning">Save prefix change before registering models.</p>}<div className="flex flex-wrap gap-2">{models.map((model) => <Button key={model.id} type="button" size="sm" variant="secondary" onClick={() => register(model)} loading={registering === model.id} disabled={form.prefix.trim() !== node.prefix}>{model.name || model.id}</Button>)}</div></> : <p className="text-xs text-dd-muted">Save node, reopen Edit, then register discovered model IDs.</p>)}<p className="text-xs text-dd-muted">Use base URL or full <code>/systemone</code> endpoint. Manual registration remains available in Models.</p></form></Modal>;
}

AddSystemoneCompatibleModal.propTypes = { isOpen: PropTypes.bool.isRequired, onClose: PropTypes.func.isRequired, onCreated: PropTypes.func, onSaved: PropTypes.func, node: PropTypes.object };
