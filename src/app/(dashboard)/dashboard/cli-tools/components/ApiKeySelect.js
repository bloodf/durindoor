"use client";

import { useEffect, useMemo, useState } from "react";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import PromptDialog from "@/shared/ui/components/PromptDialog.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import {
  readKeyPresets,
  upsertKeyPreset,
  deleteKeyPreset,
  subscribeKeyPresets,
  formatKeyPresetLabel,
  maskApiKey,
} from "./cliEndpointPresets";

const CUSTOM_VALUE = "__custom__";
const SAVE_VALUE = "__save_key__";

// API key field with browser-local saved presets (upstream c24a8542 behavior),
// rebuilt on Durin DS primitives (Select/PromptDialog/ConfirmDialog/IconButton).
// The fork never receives server key material (managed keys are masked and
// irretrievable), so presets store the raw secret in this browser only.
export default function ApiKeySelect({ value, onChange, apiKeys = [], cloudEnabled = false, className = "", label = "API key" }) {
  const [savedKeys, setSavedKeys] = useState([]);
  // Custom mode is sticky once the user picks it, so the input doesn't jump back to a saved option
  const [customMode, setCustomMode] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const sync = () => setSavedKeys(readKeyPresets());
    sync();
    return subscribeKeyPresets(sync);
  }, []);

  const options = useMemo(
    () => [
      ...savedKeys.map((preset) => ({ value: `saved:${preset.name}`, label: formatKeyPresetLabel(preset), key: preset.key })),
      { value: CUSTOM_VALUE, label: "Custom…", key: "" },
    ],
    [savedKeys]
  );

  // Derive the active option from value — no sync effects needed when the parent updates it
  const matched = value ? options.find((option) => option.key && option.key === value) : null;
  const mode = matched && !customMode ? matched.value : CUSTOM_VALUE;
  const isSaved = mode.startsWith("saved:");
  const canSave = !isSaved && (value || "").trim().length > 0;
  const selectOptions = [...options, ...(canSave ? [{ value: SAVE_VALUE, label: "+ Save current as…" }] : [])];

  const handleSelect = (next) => {
    if (next === SAVE_VALUE) {
      if ((value || "").trim()) setSaveOpen(true);
      return;
    }
    if (next === CUSTOM_VALUE) {
      setCustomMode(true);
      onChange("");
      return;
    }
    setCustomMode(false);
    const option = options.find((item) => item.value === next);
    if (option) onChange(option.key);
  };

  const savePreset = (name) => {
    upsertKeyPreset((value || "").trim(), name);
    setSaveOpen(false);
    setCustomMode(false);
  };

  const handleDelete = () => {
    if (!isSaved) return;
    deleteKeyPreset(mode.slice(6));
    setConfirmDelete(false);
    // The deleted preset's key stays in the input as a custom value
    setCustomMode(true);
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-center gap-2">
        <Select value={mode} onChange={handleSelect} options={selectOptions} size="sm" aria-label="API key preset" className="flex-1" />
        {isSaved ? <IconButton icon="delete" label="Delete saved key" size="sm" onClick={() => setConfirmDelete(true)} /> : null}
      </div>
      {!isSaved ? (
        <Input
          label={label}
          type="password"
          value={value || ""}
          onChange={(event) => { setCustomMode(true); onChange(event.target.value); }}
          autoComplete="off"
          placeholder={cloudEnabled ? "Paste the API key secret" : "sk_durindoor or a saved secret"}
          size="sm"
        />
      ) : null}
      {apiKeys.length > 0 ? (
        <p className="text-[11px] text-dd-muted">
          Managed keys: {apiKeys.map((key) => `${key.name || "Key"} (${key.maskedKey || "***"})`).join(", ")}. Stored secrets cannot be retrieved.
        </p>
      ) : null}
      <PromptDialog
        open={saveOpen}
        title="Save API key"
        label="Preset name"
        defaultValue={maskApiKey((value || "").trim())}
        submitLabel="Save"
        onSubmit={savePreset}
        onCancel={() => setSaveOpen(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete saved key "${mode.slice(6)}"?`}
        message="This removes the saved key from this browser."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
