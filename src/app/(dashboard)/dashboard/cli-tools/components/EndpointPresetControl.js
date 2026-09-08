"use client";

import { useEffect, useMemo, useState } from "react";
import Select from "@/shared/ui/components/Select.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import PromptDialog from "@/shared/ui/components/PromptDialog.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import { isBrowser } from "../../../../../shared/utils/typeChecks.js";

const STORAGE_KEY = "durindoor.cliToolEndpointPresets";

function maskApiKey(apiKey) {
  if (!apiKey) return "No API key";
  if (apiKey.length <= 12) return `${apiKey.slice(0, 4)}…`;
  return `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`;
}

function normalizePresets(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((preset) => preset?.name && preset?.baseUrl && preset?.apiKey);
}

function readPresets() {
  if (!isBrowser()) return [];
  try { return normalizePresets(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]")); } catch { return []; }
}

function writePresets(presets) {
  if (!isBrowser()) return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePresets(presets))); } catch { /* storage unavailable */ }
}

function defaultPresetName(baseUrl) {
  try { return new URL(baseUrl).host; } catch { return baseUrl; }
}

export default function EndpointPresetControl({ baseUrl, apiKey, onBaseUrlChange, onApiKeyChange }) {
  const [presets, setPresets] = useState([]);
  const [selectedName, setSelectedName] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { setPresets(readPresets()); }, []);

  const selectedPreset = useMemo(() => presets.find((preset) => preset.name === selectedName) || null, [presets, selectedName]);
  const options = useMemo(() => [{ value: "", label: "Manual / current endpoint" }, ...presets.map((preset) => ({ value: preset.name, label: `${preset.name} — ${preset.baseUrl} (${maskApiKey(preset.apiKey)})` }))], [presets]);

  const handleSelect = (name) => {
    setSelectedName(name);
    const preset = presets.find((item) => item.name === name);
    if (!preset) return;
    onBaseUrlChange(preset.baseUrl);
    onApiKeyChange(preset.apiKey);
  };

  const handleSaveSubmit = (name) => {
    const trimmedBaseUrl = (baseUrl || "").trim();
    const trimmedApiKey = (apiKey || "").trim();
    if (!trimmedBaseUrl || !trimmedApiKey) { setSaveOpen(false); return; }
    const nextPreset = { name: name.trim(), baseUrl: trimmedBaseUrl, apiKey: trimmedApiKey };
    const nextPresets = [...presets.filter((preset) => preset.name !== nextPreset.name), nextPreset].sort((a, b) => a.name.localeCompare(b.name));
    setPresets(nextPresets);
    setSelectedName(nextPreset.name);
    writePresets(nextPresets);
    setSaveOpen(false);
  };

  const handleDelete = () => {
    if (!selectedPreset) return;
    const nextPresets = presets.filter((preset) => preset.name !== selectedPreset.name);
    setPresets(nextPresets);
    setSelectedName("");
    writePresets(nextPresets);
    setConfirmDelete(false);
  };

  const canSave = Boolean(baseUrl && apiKey);

  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-sm font-semibold text-dd-text text-right">Preset</span>
      <span className="material-symbols-outlined text-dd-muted text-[14px]" aria-hidden="true">arrow_forward</span>
      <Select aria-label="Endpoint preset" value={selectedName} onChange={handleSelect} options={options} size="sm" className="flex-1" />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setSaveOpen(true)}
        disabled={!canSave}
        title="Save current Base URL and API key as a browser-local preset"
      >Save</Button>
      {selectedPreset ? (
        <IconButton icon="delete" label={`Delete preset ${selectedPreset.name}`} size="sm" onClick={() => setConfirmDelete(true)} />
      ) : null}
      <PromptDialog
        open={saveOpen}
        title="Save preset"
        label="Preset name"
        defaultValue={selectedPreset?.name || defaultPresetName((baseUrl || "").trim())}
        submitLabel="Save preset"
        onSubmit={handleSaveSubmit}
        onCancel={() => setSaveOpen(false)}
      />
      <ConfirmDialog open={confirmDelete} title={`Delete preset "${selectedPreset?.name || ""}"?`} message="This removes the saved endpoint from this browser." confirmLabel="Delete" tone="danger" onConfirm={handleDelete} onCancel={() => setConfirmDelete(false)} />
    </div>
  );
}
