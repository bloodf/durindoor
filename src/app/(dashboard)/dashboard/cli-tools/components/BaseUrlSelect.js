"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Select from "@/shared/ui/components/Select.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import PromptDialog from "@/shared/ui/components/PromptDialog.jsx";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { formatEndpointPresetLabel, readLastCustomUrl, writeLastCustomUrl } from "./cliEndpointPresets";
import { isBrowser } from "../../../../../shared/utils/typeChecks.js";

const STORAGE_KEY = "durindoor.cliToolEndpointPresets";
const CUSTOM_VALUE = "__custom__";
const SAVE_VALUE = "__save__";
const ensureV1 = (url) => { const trimmed = (url || "").replace(/\/+$/, ""); return !trimmed ? "" : /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`; };
const readSavedPresets = () => { if (!isBrowser()) return []; try { const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(value) ? value.filter((preset) => preset?.name && preset?.baseUrl) : []; } catch { return []; } };
const writeSavedPresets = (presets) => { if (!isBrowser()) return; try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets)); } catch {} };
const buildOptions = ({ requiresExternalUrl, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, cloudEnabled, cloudUrl, savedPresets, withV1 }) => {
  const options = []; const wrap = (url) => withV1 ? ensureV1(url) : (url || "").replace(/\/+$/, "");
  if (!requiresExternalUrl) options.push({ value: "local", label: "Local (127.0.0.1)", url: wrap(`http://127.0.0.1:${UPDATER_CONFIG.appPort}`) });
  if (tunnelEnabled && tunnelPublicUrl) options.push({ value: "tunnel", label: "Public tunnel", url: wrap(tunnelPublicUrl) });
  if (tailscaleEnabled && tailscaleUrl) options.push({ value: "tailscale", label: "Tailscale", url: wrap(tailscaleUrl) });
  if (cloudEnabled && cloudUrl) options.push({ value: "cloud", label: "Cloud", url: wrap(cloudUrl) });
  savedPresets.forEach((preset) => options.push({ value: `saved:${preset.name}`, label: formatEndpointPresetLabel(preset), url: preset.baseUrl }));
  options.push({ value: CUSTOM_VALUE, label: "Custom URL…", url: "" }); return options;
};

export default function BaseUrlSelect({ value, onChange, requiresExternalUrl = false, tunnelEnabled = false, tunnelPublicUrl = "", tailscaleEnabled = false, tailscaleUrl = "", cloudEnabled = false, cloudUrl = "", withV1 = true }) {
  const [savedPresets, setSavedPresets] = useState([]); const [mode, setMode] = useState(""); const [customInput, setCustomInput] = useState(""); const [saveOpen, setSaveOpen] = useState(false); const initializedRef = useRef(false);
  useEffect(() => setSavedPresets(readSavedPresets()), []);
  const options = useMemo(() => buildOptions({ requiresExternalUrl, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, cloudEnabled, cloudUrl, savedPresets, withV1 }), [requiresExternalUrl, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, cloudEnabled, cloudUrl, savedPresets, withV1]);
  useEffect(() => { if (initializedRef.current || !options.length) return; initializedRef.current = true; const first = options.find((option) => option.value !== CUSTOM_VALUE); if (first) { setMode(first.value); onChange(first.url); } else setMode(CUSTOM_VALUE); }, [options, onChange]);
  const savePreset = (name) => { const trimmed = (value || "").trim(); const savedName = name.trim(); const updated = [...savedPresets.filter((preset) => preset.name !== savedName), { name: savedName, baseUrl: trimmed }].sort((a, b) => a.name.localeCompare(b.name)); setSavedPresets(updated); writeSavedPresets(updated); setMode(`saved:${savedName}`); onChange(trimmed); setSaveOpen(false); };
  const handleSelect = (next) => { if (next === SAVE_VALUE) { if ((value || "").trim()) setSaveOpen(true); return; } setMode(next); if (next === CUSTOM_VALUE) { const seed = (value || "").trim() || readLastCustomUrl(); setCustomInput(seed); if (seed) writeLastCustomUrl(seed); onChange(seed); return; } const option = options.find((item) => item.value === next); if (option) onChange(option.url); };
  const isSaved = mode.startsWith("saved:"); const isCustom = mode === CUSTOM_VALUE; const canSave = isCustom && customInput.trim().length > 0;
  const selectOptions = [...options, ...(canSave ? [{ value: SAVE_VALUE, label: "+ Save current as…" }] : [])];
  return <><div className="flex flex-col gap-1.5"><div className="flex items-center gap-2"><Select value={mode} onChange={handleSelect} options={selectOptions} size="sm" aria-label="Endpoint" />{isSaved ? <IconButton icon="delete" label="Delete saved endpoint" size="sm" onClick={() => { const updated = savedPresets.filter((preset) => preset.name !== mode.slice(6)); setSavedPresets(updated); writeSavedPresets(updated); const seed = (value || "").trim() || readLastCustomUrl(); setMode(CUSTOM_VALUE); setCustomInput(seed); onChange(seed); }} /> : null}</div>{isCustom ? <Input size="sm" value={customInput} onChange={(event) => { const next = event.target.value; setCustomInput(next); onChange(next); if (next.trim()) writeLastCustomUrl(next.trim()); }} placeholder={withV1 ? "https://example.com/v1" : "https://example.com"} aria-label="Custom endpoint URL" /> : null}</div><PromptDialog open={saveOpen} title="Save endpoint" label="Endpoint name" defaultValue={(() => { try { return new URL((value || "").trim()).host; } catch { return (value || "").trim(); } })()} submitLabel="Save" onSubmit={savePreset} onCancel={() => setSaveOpen(false)} /></>;
}
