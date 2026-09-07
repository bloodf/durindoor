"use client";

import { useParams, notFound, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import { ModelSelectModal } from "@/shared/components";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import { AI_PROVIDERS, MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { filterActiveConnections } from "@/shared/utils/connectionStatus";

// Parse "providerId/model" or just "providerId" → { providerId, model }
import { isObject, isString } from "../../../../../../shared/utils/typeChecks.js";
function parseModelEntry(entry) {
  if (!isString(entry)) return { providerId: "", model: "" };
  const idx = entry.indexOf("/");
  if (idx < 0) return { providerId: entry, model: "" };
  return { providerId: entry.slice(0, idx), model: entry.slice(idx + 1) };
}

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

const KIND_LABELS = {
  webSearch: "Web Search",
  webFetch: "Web Fetch",
  image: "Text to Image",
  tts: "Text To Speech"
};

const EXAMPLE_PATHS = {
  webSearch: "/v1/search",
  webFetch: "/v1/web/fetch",
  image: "/v1/images/generations",
  tts: "/v1/audio/speech"
};

const EXAMPLE_BODIES = {
  webSearch: (n) => ({ model: n, query: "What is the latest news about AI?", search_type: "web", max_results: 5 }),
  webFetch: (n) => ({ model: n, url: "https://example.com", format: "markdown" }),
  image: (n) => ({ model: n, prompt: "A cute cat playing piano", n: 1, size: "1024x1024" }),
  tts: (n) => ({ model: n, input: "Hello, this is a test.", voice: "alloy" })
};

// Map combo.kind → listing route to go back to
function getListingHref(kind) {
  if (kind === "webSearch" || kind === "webFetch") return "/dashboard/media-providers/web";
  return `/dashboard/media-providers/${kind}`;
}

export default function ComboDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [combo, setCombo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [providers, setProviders] = useState([]);
  const [roundRobin, setRoundRobin] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [logs, setLogs] = useState([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [connections, setConnections] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [saveError, setSaveError] = useState("");

  const fetchAll = async () => {
    try {
      const [comboRes, settingsRes, logsRes, connsRes, aliasesRes] = await Promise.all([
      fetch(`/api/combos/${id}`, { cache: "no-store" }),
      fetch("/api/settings", { cache: "no-store" }),
      fetch("/api/usage/logs", { cache: "no-store" }),
      fetch("/api/providers", { cache: "no-store" }),
      fetch("/api/models/alias", { cache: "no-store" })]
      );
      if (aliasesRes.ok) setModelAliases((await aliasesRes.json()).aliases || {});
      if (connsRes.ok) setConnections(filterActiveConnections((await connsRes.json()).connections));
      if (!comboRes.ok) {setCombo(null);setLoading(false);return;}
      const c = await comboRes.json();
      setCombo(c);
      setName(c.name);
      setProviders(c.models || []);
      const s = settingsRes.ok ? await settingsRes.json() : {};
      setRoundRobin(s.comboStrategies?.[c.name]?.fallbackStrategy === "round-robin");
      const allLogs = logsRes.ok ? await logsRes.json() : [];
      setLogs(allLogs.filter((l) => isString(l) && l.includes(c.name)).slice(0, 50));
    } catch {/* noop */}
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {fetchAll();}, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const validateName = (v) => {
    if (!v.trim()) {setNameError("Name is required");return false;}
    if (!VALID_NAME_REGEX.test(v)) {setNameError("Only letters, numbers, -, _ and .");return false;}
    setNameError("");
    return true;
  };

  const saveCombo = async (patch) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSaveError(err?.error || "Failed to save");
        return false;
      }
      setSaveError("");
      return true;
    } catch (err) {
      setSaveError(err.message || "Failed to save");
      return false;
    }
  };

  const handleSaveName = async () => {
    if (!validateName(name)) return;
    if (name === combo.name) return;
    const ok = await saveCombo({ name });
    if (ok) await fetchAll();
  };

  const handleAddModel = async (model) => {
    const value = model?.value || model;
    if (!value || providers.includes(value)) return;
    const next = [...providers, value];
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleDeselectModel = async (model) => {
    const value = model?.value || model;
    if (!value || !providers.includes(value)) return;
    const next = providers.filter((p) => p !== value);
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleRemoveProvider = async (idx) => {
    const next = providers.filter((_, i) => i !== idx);
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleMove = async (idx, dir) => {
    const next = [...providers];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setProviders(next);
    await saveCombo({ models: next });
  };

  const handleToggleRoundRobin = async (enabled) => {
    setRoundRobin(enabled);
    const settingsRes = await fetch("/api/settings", { cache: "no-store" });
    const s = settingsRes.ok ? await settingsRes.json() : {};
    const updated = { ...(s.comboStrategies || {}) };
    if (enabled) updated[combo.name] = { fallbackStrategy: "round-robin" };else
    delete updated[combo.name];
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comboStrategies: updated })
    });
  };

  const handleDelete = async () => {
    setDeleteError("");
    try {
      const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
      if (res.ok) router.push(getListingHref(combo.kind));
      else {
        const error = await res.json().catch(() => ({}));
        setDeleteError(error?.error || "Failed to delete combo");
      }
    } catch (error) {
      setDeleteError(error.message || "Failed to delete combo");
    } finally {
      setShowDeleteConfirm(false);
    }
  };
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError("");
    if (testResult?.audioUrl) {try {URL.revokeObjectURL(testResult.audioUrl);} catch {}}
    if (testResult?.imageUrl?.startsWith("blob:")) {try {URL.revokeObjectURL(testResult.imageUrl);} catch {}}
    const start = Date.now();
    try {
      const path = EXAMPLE_PATHS[combo.kind];
      const body = EXAMPLE_BODIES[combo.kind](combo.name);
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`/api${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setTestError(d?.error?.message || d?.error || `HTTP ${res.status}`);
        setTestResult({ json: JSON.stringify(d, null, 2), latencyMs });
        return;
      }
      const ctype = res.headers.get("content-type") || "";
      // Binary image
      if (ctype.startsWith("image/")) {
        const blob = await res.blob();
        setTestResult({ imageUrl: URL.createObjectURL(blob), latencyMs });
        return;
      }
      // Binary audio
      if (ctype.startsWith("audio/") || ctype === "application/octet-stream") {
        const blob = await res.blob();
        setTestResult({ audioUrl: URL.createObjectURL(blob), latencyMs });
        return;
      }
      // JSON — could be image (data[0].b64_json/url) or generic
      const data = await res.json();
      const first = data?.data?.[0];
      const imageUrl = first?.b64_json ?
      `data:image/png;base64,${first.b64_json}` :
      first?.url || "";
      setTestResult({ json: JSON.stringify(maskB64(data), null, 2), imageUrl, latencyMs });
    } catch (e) {
      setTestError(e.message || "Network error");
    }
    setTesting(false);
  };

  // Mask large b64_json strings to keep JSON view readable
  function maskB64(obj) {
    if (!obj || !isObject(obj)) return obj;
    if (Array.isArray(obj)) return obj.map(maskB64);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = k === "b64_json" && isString(v) && v.length > 100 ?
      `<${v.length} chars base64>` :
      maskB64(v);
    }
    return out;
  }

  if (loading) return <div className="py-12 text-center text-sm text-dd-muted">Loading...</div>;
  if (!combo) return notFound();

  const kindLabel = KIND_LABELS[combo.kind] || MEDIA_PROVIDER_KINDS.find((k) => k.id === combo.kind)?.label || "Combo";
  const examplePath = EXAMPLE_PATHS[combo.kind];
  const exampleBody = combo.kind && EXAMPLE_BODIES[combo.kind] ? EXAMPLE_BODIES[combo.kind](combo.name) : null;
  const curlExample = examplePath ?
  `curl -X POST http://localhost:20128${examplePath} \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}" \\\n  -d '${JSON.stringify(exampleBody)}'` :
  "";
  const backHref = getListingHref(combo.kind);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      {deleteError && <p role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-4 py-3 text-[13px] text-dd-danger">{deleteError}</p>}
      {saveError && <p role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-4 py-3 text-[13px] text-dd-danger">{saveError}</p>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={backHref} aria-label={`Back to ${kindLabel} providers`} className="rounded-dd text-dd-muted outline-none hover:text-dd-accent focus-visible:shadow-dd-focus"><span aria-hidden="true" className="material-symbols-outlined">arrow_back</span></Link>
          <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent"><span aria-hidden="true" className="material-symbols-outlined">layers</span></span>
          <div className="min-w-0"><p className="text-xs text-dd-muted">{kindLabel} Combo</p><code className="block truncate text-lg font-semibold text-dd-text">{combo.name}</code></div>
        </div>
        <Button variant="danger" icon="delete" onClick={() => setShowDeleteConfirm(true)}>Delete</Button>
      </div>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-dd-text">Settings</h2>
        <div className="flex flex-col gap-4">
          <div>
            <Input label="Combo Name" value={name} onChange={(e) => {setName(e.target.value);validateName(e.target.value);}} onBlur={handleSaveName} error={nameError} />
            <p className="mt-1 text-[11px] text-dd-subtle">Only letters, numbers, -, _ and .</p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-dd-text">Round Robin</p>
              <p className="text-xs text-dd-muted">Rotate providers across requests instead of strict fallback order.</p>
            </div>
            <Toggle aria-label="Round Robin" checked={roundRobin} onChange={handleToggleRoundRobin} />
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-dd-text">Providers</h2>
            <p className="text-xs text-dd-muted">Tried in order (top-down) or rotated when round-robin is on.</p>
          </div>
          <Button size="sm" variant="primary" icon="add" onClick={() => setShowPicker(true)}>Add Provider</Button>
        </div>
        {providers.length === 0 ? (
          <EmptyState icon="layers" title="No providers yet" message="Add a provider to build this combo." />
        ) : (
          <div className="flex flex-col gap-2">
            {providers.map((entry, idx) => {
              const { providerId, model } = parseModelEntry(entry);
              const p = AI_PROVIDERS[providerId];
              return (
                <div key={`${entry}-${idx}`} className="flex items-center gap-3 rounded-dd bg-dd-surface-2 p-2">
                  <span className="w-5 shrink-0 text-center text-xs text-dd-muted">{idx + 1}</span>
                  <ProviderLogo provider={providerId} size={24} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-dd-text">{p?.name || providerId}</div>
                    {model && <code className="block truncate text-[11px] text-dd-muted">{model}</code>}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <IconButton size="sm" icon="arrow_upward" label="Move up" onClick={() => handleMove(idx, -1)} disabled={idx === 0} />
                    <IconButton size="sm" icon="arrow_downward" label="Move down" onClick={() => handleMove(idx, 1)} disabled={idx === providers.length - 1} />
                    <IconButton size="sm" icon="close" label="Remove provider" onClick={() => handleRemoveProvider(idx)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {combo.kind && examplePath && (
        <Card>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-dd-text">Test Example</h2>
            <Button size="sm" variant="primary" icon="play_arrow" onClick={handleTest} disabled={testing || providers.length === 0}>
              {testing ? "Running..." : "Run"}
            </Button>
          </div>
          <Input type="password" label="API key secret" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" placeholder="Paste a saved API key secret" className="font-mono" />
          <pre tabIndex={0} aria-label="API request example" className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text" role="region">{curlExample}</pre>
          {testError && <p role="alert" className="mt-3 break-words text-xs text-dd-danger">{testError}</p>}
          {testResult && (
            <div className="mt-3 flex flex-col gap-3">
              {testResult.latencyMs != null && <span className="text-[11px] text-dd-muted">⚡ {testResult.latencyMs}ms</span>}
              {testResult.imageUrl && (
                <div>
                  <div className="mb-1.5 flex items-center justify-end">
                    <a href={testResult.imageUrl} download="image.png" className="inline-flex items-center gap-1 text-xs text-dd-muted outline-none transition-colors hover:text-dd-accent focus-visible:shadow-dd-focus">
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">download</span>Download
                    </a>
                  </div>
                  <img src={testResult.imageUrl} alt="Generated" className="max-w-full rounded-dd border border-dd-border" />
                </div>
              )}
              {testResult.audioUrl && (
                <div>
                  <div className="mb-1.5 flex items-center justify-end">
                    <a href={testResult.audioUrl} download="speech.mp3" className="inline-flex items-center gap-1 text-xs text-dd-muted outline-none transition-colors hover:text-dd-accent focus-visible:shadow-dd-focus">
                      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">download</span>Download
                    </a>
                  </div>
                  <audio controls src={testResult.audioUrl} className="w-full" />
                </div>
              )}
              {testResult.json && <pre tabIndex={0} aria-label="API response output" className="max-h-[300px] overflow-auto whitespace-pre-wrap break-all rounded-dd bg-dd-surface-2 p-3 text-xs text-dd-text" role="region">{testResult.json}</pre>}
            </div>
          )}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-dd-text">Usage Logs</h2>
        {logs.length === 0 ? (
          <p className="text-xs italic text-dd-muted">No usage yet.</p>
        ) : (
          <pre tabIndex={0} aria-label="Connection logs" className="max-h-[400px] overflow-auto whitespace-pre-wrap rounded-dd bg-dd-surface-2 p-3 text-[11px] text-dd-text" role="region">{logs.join("\n")}</pre>
        )}
      </Card>

      <ModelSelectModal
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handleAddModel}
        onDeselect={handleDeselectModel}
        activeProviders={connections}
        modelAliases={modelAliases}
        title={`Add ${kindLabel} Model`}
        kindFilter={combo.kind}
        addedModelValues={providers}
        closeOnSelect={false} />
      <ConfirmDialog
        open={showDeleteConfirm}
        title={`Delete combo "${combo.name}"?`}
        message="This removes the combo and cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
      
    </div>);

}