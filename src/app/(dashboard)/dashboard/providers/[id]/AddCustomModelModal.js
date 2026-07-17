"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import CapacityBadges from "@/shared/components/CapacityBadges";

const BOOLEAN_CAP_KEYS = [
  { key: "vision", label: "Vision", icon: "visibility" },
  { key: "pdf", label: "PDF", icon: "picture_as_pdf" },
  { key: "audioInput", label: "Audio input", icon: "mic" },
  { key: "videoInput", label: "Video input", icon: "videocam" },
  { key: "imageOutput", label: "Image output", icon: "image" },
  { key: "audioOutput", label: "Audio output", icon: "volume_up" },
  { key: "search", label: "Search", icon: "travel_explore" },
  { key: "reasoning", label: "Reasoning", icon: "psychology" },
  { key: "tools", label: "Tools", icon: "build" },
];

const THINKING_FORMATS = [
  { value: "", label: "Auto (derive from provider)" },
  { value: "openai", label: "OpenAI reasoning" },
  { value: "claude-adaptive", label: "Claude adaptive" },
  { value: "claude-budget", label: "Claude budget" },
  { value: "gemini-level", label: "Gemini level" },
  { value: "gemini-budget", label: "Gemini budget" },
  { value: "zai", label: "Zai / GLM" },
  { value: "qwen", label: "Qwen" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "kimi", label: "Kimi" },
  { value: "minimax", label: "MiniMax" },
  { value: "hunyuan", label: "Hunyuan" },
  { value: "step", label: "Step" },
  { value: "kiro", label: "Kiro" },
];

export default function AddCustomModelModal({ isOpen, providerAlias, providerDisplayAlias, initialModel, onSave, onClose }) {
  const isEdit = Boolean(initialModel);
  const [modelId, setModelId] = useState("");
  const [caps, setCaps] = useState({ tools: true });
  const [contextWindow, setContextWindow] = useState("");
  const [maxOutput, setMaxOutput] = useState("");
  const [thinkingFormat, setThinkingFormat] = useState("");
  const [thinkingCanDisable, setThinkingCanDisable] = useState(true);
  const [thinkingRangeMin, setThinkingRangeMin] = useState("");
  const [thinkingRangeMax, setThinkingRangeMax] = useState("");
  const [testStatus, setTestStatus] = useState(null); // null | "testing" | "ok" | "error"
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const reset = (model = null) => {
    setModelId(model ? model.id : "");
    const existing = model && model.capabilities ? model.capabilities : {};
    setCaps({ tools: true, ...existing });
    setContextWindow(existing.contextWindow?.toString() ?? "");
    setMaxOutput(existing.maxOutput?.toString() ?? "");
    setThinkingFormat(existing.thinkingFormat ?? "");
    setThinkingCanDisable(existing.thinkingCanDisable !== false);
    setThinkingRangeMin(existing.thinkingRange?.min?.toString() ?? "");
    setThinkingRangeMax(existing.thinkingRange?.max?.toString() ?? "");
    setTestStatus(null);
    setTestError("");
    setShowAdvanced(Boolean(existing.thinkingFormat || existing.thinkingRange || existing.contextWindow || existing.maxOutput));
  };

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) { reset(initialModel); }
  }, [isOpen, initialModel]);

  // Strip provider's own alias prefix (e.g. "cc/model" -> "model" for cc provider)
  const stripAlias = (id) => {
    const prefix = `${providerAlias}/`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
  };

  const toggleCap = (key) => {
    setCaps((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const builtCaps = () => {
    const out = { ...caps };
    if (contextWindow.trim() !== "") out.contextWindow = Number(contextWindow);
    if (maxOutput.trim() !== "") out.maxOutput = Number(maxOutput);
    if (thinkingFormat) out.thinkingFormat = thinkingFormat;
    out.thinkingCanDisable = thinkingCanDisable;
    if (thinkingRangeMin.trim() !== "" || thinkingRangeMax.trim() !== "") {
      const range = {};
      if (thinkingRangeMin.trim() !== "") range.min = Number(thinkingRangeMin);
      if (thinkingRangeMax.trim() !== "") range.max = Number(thinkingRangeMax);
      out.thinkingRange = range;
    }
    return out;
  };

  const handleTest = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId) return;
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${cleanId}` }),
      });
      const data = await res.json();
      setTestStatus(data.ok ? "ok" : "error");
      setTestError(data.error || "");
    } catch (err) {
      setTestStatus("error");
      setTestError(err.message);
    }
  };

  const handleSave = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId || saving) return;
    setSaving(true);
    try {
      await onSave({ id: cleanId, capabilities: builtCaps() });
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !isEdit) handleTest();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? "Edit Custom Model" : "Add Custom Model"}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Model ID</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={modelId}
              onChange={(e) => { setModelId(e.target.value); setTestStatus(null); setTestError(""); }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. claude-opus-4-5"
              className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              autoFocus
              disabled={isEdit}
            />
            {!isEdit ? (
              <Button
                variant="secondary"
                icon="science"
                loading={testStatus === "testing"}
                onClick={handleTest}
                disabled={!modelId.trim() || testStatus === "testing"}
              >
                {testStatus === "testing" ? "Testing..." : "Test"}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-text-muted mt-1">
            Sent to provider as: <code className="font-mono bg-sidebar px-1 rounded">{stripAlias(modelId.trim()) || "model-id"}</code>
          </p>
        </div>

        <div>
          <label className="text-sm font-medium mb-1.5 block">Capabilities</label>
          <div className="flex flex-wrap gap-2">
            {BOOLEAN_CAP_KEYS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleCap(key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs border transition-colors ${caps[key] ? "bg-primary/10 border-primary text-primary" : "bg-sidebar border-border text-text-muted"}`}
                title={label}
              >
                <span className="material-symbols-outlined text-sm">{caps[key] ? "check_box" : "check_box_outline_blank"}</span>
                {label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
            Preview: <CapacityBadges caps={caps} size={14} />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-sm text-text-muted hover:text-primary"
        >
          <span className="material-symbols-outlined text-sm">{showAdvanced ? "expand_less" : "expand_more"}</span>
          Advanced
        </button>

        {showAdvanced ? (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Context window</label>
              <input
                type="number"
                min={1}
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder="tokens"
                className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Max output</label>
              <input
                type="number"
                min={1}
                value={maxOutput}
                onChange={(e) => setMaxOutput(e.target.value)}
                placeholder="tokens"
                className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium mb-1 block">Thinking format</label>
              <select
                value={thinkingFormat}
                onChange={(e) => setThinkingFormat(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              >
                {THINKING_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input
                id="thinkingCanDisable"
                type="checkbox"
                checked={thinkingCanDisable}
                onChange={(e) => setThinkingCanDisable(e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="thinkingCanDisable" className="text-xs">Thinking can be disabled</label>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Thinking budget min</label>
              <input
                type="number"
                min={0}
                value={thinkingRangeMin}
                onChange={(e) => setThinkingRangeMin(e.target.value)}
                placeholder="tokens"
                className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Thinking budget max</label>
              <input
                type="number"
                min={0}
                value={thinkingRangeMax}
                onChange={(e) => setThinkingRangeMax(e.target.value)}
                placeholder="tokens"
                className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        ) : null}

        {/* Test result */}
        {testStatus === "ok" && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <span className="material-symbols-outlined text-base">check_circle</span>
            Model is reachable
          </div>
        )}
        {testStatus === "error" && (
          <div className="flex items-start gap-2 text-sm text-red-500">
            <span className="material-symbols-outlined text-base shrink-0">cancel</span>
            <span>{testError || "Model not reachable"}</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
          <Button
            onClick={handleSave}
            fullWidth
            size="sm"
            disabled={!modelId.trim() || saving}
          >
            {saving ? (isEdit ? "Saving..." : "Adding...") : (isEdit ? "Save" : "Add Model")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  initialModel: PropTypes.shape({ id: PropTypes.string, capabilities: PropTypes.object }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
