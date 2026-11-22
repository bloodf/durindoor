"use client";

import { useEffect, useMemo, useState } from "react";
import CliOptionSelect from "./CliOptionSelect.js";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import PromptDialog from "@/shared/ui/components/PromptDialog.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import {
  buildEndpointPreset,
  knownKeysForSecretMatch,
  readEndpointPresets,
  resolveEndpointPresetSecret,
  writeEndpointPresets,
} from "./cliEndpointPresets";

function presetKeyLabel(preset) {
  return preset?.maskedLabel || (preset?.apiKeyId ? "DurinDoor key" : "No API key");
}

function defaultPresetName(baseUrl) {
  try { return new URL(baseUrl).host; } catch { return baseUrl; }
}

/**
 * Browser-local endpoint presets. Stores base URL + DurinDoor key id (and a
 * masked label) only — never a raw API secret in localStorage (#2252).
 */
export default function EndpointPresetControl({
  baseUrl,
  apiKey,
  apiKeys = [],
  onBaseUrlChange,
  onApiKeyChange,
}) {
  const [presets, setPresets] = useState([]);
  const [selectedName, setSelectedName] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { setPresets(readEndpointPresets()); }, []);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.name === selectedName) || null,
    [presets, selectedName],
  );
  const options = useMemo(
    () => [
      { value: "", label: "Manual / current endpoint" },
      ...presets.map((preset) => ({
        value: preset.name,
        label: `${preset.name} — ${preset.baseUrl} (${presetKeyLabel(preset)})`,
      })),
    ],
    [presets],
  );

  const handleSelect = async (name) => {
    setSelectedName(name);
    const preset = presets.find((item) => item.name === name);
    if (!preset) return;
    onBaseUrlChange(preset.baseUrl);
    const secret = await resolveEndpointPresetSecret(preset);
    onApiKeyChange(secret);
  };

  const handleSaveSubmit = async (name) => {
    const trimmedBaseUrl = (baseUrl || "").trim();
    const trimmedApiKey = (apiKey || "").trim();
    if (!trimmedBaseUrl || !trimmedApiKey) { setSaveOpen(false); return; }
    const knownKeys = await knownKeysForSecretMatch(trimmedApiKey, apiKeys);
    const nextPreset = buildEndpointPreset(
      { name: name.trim(), baseUrl: trimmedBaseUrl, apiKey: trimmedApiKey },
      knownKeys,
    );
    if (!nextPreset) { setSaveOpen(false); return; }
    const nextPresets = [...presets.filter((preset) => preset.name !== nextPreset.name), nextPreset]
      .sort((a, b) => a.name.localeCompare(b.name));
    setPresets(nextPresets);
    setSelectedName(nextPreset.name);
    writeEndpointPresets(nextPresets);
    setSaveOpen(false);
  };

  const handleDelete = () => {
    if (!selectedPreset) return;
    const nextPresets = presets.filter((preset) => preset.name !== selectedPreset.name);
    setPresets(nextPresets);
    setSelectedName("");
    writeEndpointPresets(nextPresets);
    setConfirmDelete(false);
  };

  const canSave = Boolean(baseUrl && apiKey);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="w-full shrink-0 text-left text-sm font-semibold text-dd-text sm:w-32 sm:text-right">Preset</span>
      <span className="material-symbols-outlined text-dd-muted text-[14px]" aria-hidden="true">arrow_forward</span>
      <CliOptionSelect aria-label="Endpoint preset" value={selectedName} onChange={handleSelect} options={options} size="sm" className="min-w-0 flex-1 basis-40" />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setSaveOpen(true)}
        disabled={!canSave}
        title="Save current Base URL and API key reference as a browser-local preset"
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
