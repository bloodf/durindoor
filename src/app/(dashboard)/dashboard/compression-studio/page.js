"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import ModelSelectModal from "@/shared/components/ModelSelectModal";
import { filterActiveConnections } from "@/shared/utils/connectionStatus";
import { ENGINE_IDS, isEngineAvailable, engineMeta } from "open-sse/services/compression/engineCatalog.js";
import { isObject, isString } from "../../../../shared/utils/typeChecks.js";

const PRESETS = [
  { label: "Simple chat", icon: "chat_bubble", value: { model: "openai/gpt-4o", messages: [{ role: "user", content: "hello" }] } },
  { label: "Multi-turn conversation", icon: "forum", value: { model: "openai/gpt-4o", messages: [{ role: "system", content: "You are a helpful assistant." }, { role: "user", content: "What is token compression?" }, { role: "assistant", content: "It reduces the number of tokens sent to the model." }, { role: "user", content: "Why does that matter?" }] } },
  { label: "Repeated code block", icon: "code_blocks", value: { model: "openai/gpt-4o", messages: [{ role: "system", content: "You review code snippets." }, { role: "user", content: "Fix this function:\n\n```js\nfunction add(a, b) { return a + b; }\n```\n\n```js\nfunction add(a, b) { return a + b; }\n```" }] } },
  { label: "Long system prompt", icon: "notes", value: { model: "anthropic/claude-3-5-sonnet-20240620", messages: [{ role: "system", content: "You are a senior software engineer. You write concise, well-tested code. You prefer TypeScript, React hooks, and small pure functions. You never emit comments that restate the code." }, { role: "user", content: "Write a useDebounce hook." }] } },
];

function buildPayload(useAdvanced, model, inputText, parsedJSON) {
  if (useAdvanced) return parsedJSON || null;
  if (model || inputText) return { model: model || "openai/gpt-4o", messages: [{ role: "user", content: inputText || "" }] };
  return null;
}
function RawOutput({ id, raw }) {
  return <section aria-label={`${id} raw output`} className="rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-3"><h3 className="mb-1 text-xs font-semibold text-dd-muted">{id} raw output</h3><pre tabIndex={0} aria-label={`${id} raw output`} className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 text-dd-text" role="region">{isString(raw) ? raw : JSON.stringify(raw, null, 2)}</pre></section>;
}

export default function CompressionStudioPage() {
  const [model, setModel] = useState("");
  const [inputText, setInputText] = useState("");
  const [advancedJSON, setAdvancedJSON] = useState("");
  const [useAdvanced, setUseAdvanced] = useState(false);
  const [engineId, setEngineId] = useState("all");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [results, setResults] = useState(null);
  const [engines, setEngines] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rawOpen, setRawOpen] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [activeProviders, setActiveProviders] = useState([]);
  const [activeProvidersError, setActiveProvidersError] = useState(false);

  const engineOptions = useMemo(() => [{ value: "all", label: "All engines" }, ...ENGINE_IDS.map((id) => { const meta = engineMeta(id); const available = isEngineAvailable(id); return { value: id, label: available ? meta.label : `${meta.label} (unavailable)`, disabled: !available }; })], []);
  const presetOptions = useMemo(() => [{ value: "", label: "Choose an example…" }, ...PRESETS.map((preset) => ({ value: preset.label, label: preset.label, icon: preset.icon }))], []);
  const parsedJSON = useMemo(() => { if (!useAdvanced || !advancedJSON.trim()) return null; try { return JSON.parse(advancedJSON); } catch { return null; } }, [useAdvanced, advancedJSON]);
  const isPayloadValid = useMemo(() => useAdvanced ? parsedJSON !== null && isObject(parsedJSON) && !Array.isArray(parsedJSON) : model.trim() !== "" || inputText.trim() !== "", [useAdvanced, parsedJSON, model, inputText]);

  useEffect(() => { fetch("/api/providers").then((response) => response.ok ? response.json() : Promise.reject(new Error("failed"))).then((data) => { setActiveProviders(filterActiveConnections(data.connections)); setActiveProvidersError(false); }).catch(() => setActiveProvidersError(true)); }, []);
  useEffect(() => { if (!useAdvanced) return; try { const parsed = JSON.parse(advancedJSON || "{}"); setModel(isString(parsed.model) ? parsed.model : ""); } catch { /* Keep model while JSON is invalid. */ } }, [advancedJSON, useAdvanced]);

  const handlePresetChange = (label) => { setSelectedPreset(label); const preset = PRESETS.find((item) => item.label === label); if (!preset) return; setAdvancedJSON(JSON.stringify(preset.value, null, 2)); setUseAdvanced(true); };
  const handleModelSelect = (selected) => { const nextModel = selected?.value || ""; setModel(nextModel); if (useAdvanced) { try { const parsed = JSON.parse(advancedJSON || "{}"); parsed.model = nextModel; setAdvancedJSON(JSON.stringify(parsed, null, 2)); } catch { /* Invalid JSON remains untouched. */ } } };
  const handleRun = async () => {
    setLoading(true); setError(""); setResults(null);
    let payload;
    if (useAdvanced) {
      if (parsedJSON === null) { setLoading(false); setError("Please enter valid JSON payload."); return; }
      if (!isObject(parsedJSON) || Array.isArray(parsedJSON)) { setLoading(false); setError("Advanced payload must be a JSON object (not an array or scalar)."); return; }
      payload = parsedJSON;
    } else {
      payload = buildPayload(false, model, inputText, null);
      if (!payload) { setLoading(false); setError("Please enter a model or input text."); return; }
    }
    const { engine: ignoredEngine, ...cleanPayload } = payload;
    const body = engineId === "all" ? cleanPayload : { engine: engineId, ...cleanPayload };
    try {
      const response = await fetch("/api/compression/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error?.message || `Preview failed (${response.status})`); }
      const data = await response.json(); setEngines(Array.isArray(data.engines) ? data.engines : []); setResults(data.results || {});
    } catch (caught) { setError(caught?.message || String(caught)); } finally { setLoading(false); }
  };

  const columns = [
    { key: "id", label: "Engine", mono: true },
    { key: "compressed", label: "Compressed", render: (row) => <Badge tone={row.unavailable || row.errored ? "warning" : row.compressed ? "success" : "neutral"} size="sm">{row.unavailable ? "unavailable" : row.errored ? "error" : row.compressed ? "yes" : "no"}</Badge> },
    { key: "savings", label: "Est. savings", align: "right", mono: true, render: (row) => <span className="dd-tnum text-[13px] text-dd-muted">{row.unavailable || row.errored ? "—" : `${Number(row.savingsPercent || 0).toFixed(2)}%`}</span> },
    { key: "raw", label: "Output", align: "right", render: (row) => row.raw === undefined || row.unavailable || row.errored ? null : <Button variant="ghost" size="sm" onClick={() => setRawOpen((current) => ({ ...current, [row.id]: !current[row.id] }))} icon={rawOpen[row.id] ? "visibility_off" : "visibility"}>{rawOpen[row.id] ? "Hide raw JSON" : "Show raw JSON"}</Button> },
  ];
  const rows = engines.map((id) => { const result = results?.[id] || {}; return { id, compressed: result.compressed, savingsPercent: result.savingsPercent, unavailable: result.status === "unavailable", errored: result.status === "error", raw: result.raw ?? result.compressedBody }; });

  return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
    <PageHeader icon="science" title="Test Savers" subtitle="Preview how each compression engine would transform a request body." />
    <div className="grid gap-6 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
      <Card padding={false} className="self-start"><CardHeader icon="tune" title="Preview request" subtitle="No request is sent to a provider." /><CardContent className="space-y-4">
        <Field label="Engine" hint="Choose one engine or run all available engines."><Select aria-label="Engine" value={engineId} onChange={setEngineId} options={engineOptions} /></Field>
        <Field label="Example preset" hint="Pick a sample request to prefill the form."><Select aria-label="Example preset" value={selectedPreset} onChange={handlePresetChange} options={presetOptions} placeholder="Select a preset" /></Field>
        <div className="flex flex-wrap items-center gap-2"><Button variant="secondary" size="sm" onClick={() => setModalOpen(true)} icon="swap_horiz">{model ? `Model: ${model}` : "Select model"}</Button>{activeProvidersError ? <span className="text-xs text-dd-danger" role="alert">Could not load providers</span> : null}</div>
        <Toggle checked={useAdvanced} onChange={setUseAdvanced} label="Advanced JSON mode" description="Edit the raw request JSON directly." />
        {useAdvanced ? <Textarea label="Request body (JSON)" value={advancedJSON} onChange={(event) => setAdvancedJSON(event.target.value)} rows={12} className="font-mono" spellCheck={false} error={advancedJSON.trim() && !parsedJSON ? "Input is not valid JSON." : undefined} /> : <><Input label="Model" placeholder="openai/gpt-4o" value={model} onChange={(event) => setModel(event.target.value)} hint="The model ID sent in the request body." className="font-mono" /><Textarea label="Input text" value={inputText} onChange={(event) => setInputText(event.target.value)} rows={9} placeholder="Type a user message..." className="font-mono" spellCheck={false} /></>}
        <div className="space-y-2"><Button variant="primary" className="w-full" onClick={handleRun} loading={loading} disabled={!isPayloadValid} icon="play_arrow">{loading ? "Running…" : "Run preview"}</Button>{!isPayloadValid ? <p className="text-xs text-dd-subtle">Fill the form or switch to advanced JSON to run.</p> : null}</div>
        {error ? <p className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-3 py-2 text-[13px] text-dd-danger" role="alert">{error}</p> : null}
      </CardContent></Card>
      <div className="min-w-0">{results ? <section className="space-y-3" aria-labelledby="compression-results"><h2 id="compression-results" className="text-sm font-semibold text-dd-text">Results</h2>{rows.length ? <><DataTable caption="Compression engine preview results" ariaLabel="Compression results" columns={columns} rows={rows} keyFn={(row) => row.id} getRowLabel={(row) => row.id} density="compact" /><div className="space-y-3">{rows.filter((row) => rawOpen[row.id] && row.raw !== undefined).map((row) => <RawOutput key={row.id} id={row.id} raw={row.raw} />)}</div></> : <EmptyState icon="inbox" title="No engines reported" message="The preview response did not include compression engines." />}</section> : <EmptyState icon="compare_arrows" title="No preview yet" message="Select a model, add input, then run a preview to compare token usage." />}</div>
    </div>
    <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={model || ""} activeProviders={activeProviders} title="Select model" />
  </div>;
}
