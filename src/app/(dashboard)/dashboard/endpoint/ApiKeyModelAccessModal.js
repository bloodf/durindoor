"use client";

import { useEffect, useId, useState } from "react";
import PropTypes from "prop-types";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import SecurityWarning from "./components/SecurityWarning";

const ACCESS_OPTIONS = [
  { value: "all", label: "All models" },
  { value: "allow", label: "Allow only" },
  { value: "deny", label: "Block" },
];
const MAX_PATTERNS = 200;

/**
 * Edit a key's `policy.modelAccess` rule: allow or block models by glob
 * pattern (`openai/*`, `cx/gpt-5.6-sol`). `catalog` is the Keys page policy
 * catalog, offered as suggestions.
 */
export default function ApiKeyModelAccessModal({ apiKey, catalog = [], onClose, onSave }) {
  const current = apiKey?.policy?.modelAccess;
  const [mode, setMode] = useState(() => (ACCESS_OPTIONS.some((o) => o.value === current?.mode) ? current.mode : "all"));
  const [patterns, setPatterns] = useState(() => (Array.isArray(current?.patterns) ? current.patterns : []));
  const [newPattern, setNewPattern] = useState("");
  const [requireApiKey, setRequireApiKey] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const suggestionsId = useId();

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setRequireApiKey(data.settings?.requireApiKey === true))
      .catch(() => {});
  }, []);

  const addPattern = () => {
    const pattern = newPattern.trim();
    if (!pattern) return;
    if (patterns.some((p) => p.toLowerCase() === pattern.toLowerCase())) {
      setError("That rule is already in the list.");
      return;
    }
    if (patterns.length >= MAX_PATTERNS) {
      setError(`You can add up to ${MAX_PATTERNS} rules.`);
      return;
    }
    setPatterns((prev) => [...prev, pattern]);
    setNewPattern("");
    setError("");
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/keys/${apiKey.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelAccess: { mode, patterns } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save model access rules.");
      onSave(data.key);
      onClose();
    } catch (e) {
      setError(e.message || "Failed to save model access rules.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!apiKey}
      onClose={onClose}
      title={`Model access for ${apiKey?.name || "API key"}`}
      subtitle="Checked after model resolution, on every endpoint. /v1/models only lists what the key may call."
      pending={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl size="sm" options={ACCESS_OPTIONS} value={mode} onChange={setMode} aria-label="Model access mode" />

        {!requireApiKey ? (
          <SecurityWarning message="Rules only apply to requests that send this key. Turn on Require API key so requests without a key are rejected." />
        ) : null}

        {mode !== "all" ? (
          <div className="flex flex-col gap-3">
            {patterns.length === 0 ? (
              <p className="rounded-dd border border-dashed border-dd-border px-3 py-4 text-center text-xs text-dd-muted">
                No rules yet. {mode === "allow" ? "An empty allowlist blocks every model." : "An empty blocklist blocks nothing."}
              </p>
            ) : (
              <ul className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-dd border border-dd-border p-2" aria-label="Model rules">
                {patterns.map((pattern) => (
                  <li key={pattern} className="flex items-center">
                    <Badge tone={mode === "allow" ? "accent" : "warning"} className="font-mono">{pattern}</Badge>
                    <IconButton
                      icon="close"
                      label={`Remove ${pattern}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => setPatterns((prev) => prev.filter((p) => p !== pattern))}
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-end gap-2">
              <Input
                label="Add a rule"
                hint="Use ids as shown in /v1/models. * is a wildcard, e.g. openai/*"
                value={newPattern}
                list={suggestionsId}
                onChange={(e) => setNewPattern(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addPattern();
                  }
                }}
                placeholder="provider/model or provider/*"
                error={error || undefined}
                className="min-w-0 flex-1"
              />
              <Button icon="add" onClick={addPattern} disabled={!newPattern.trim()}>Add</Button>
            </div>
            <datalist id={suggestionsId}>
              {catalog.map((model) => (
                <option key={model.id} value={model.displayId || model.id} />
              ))}
            </datalist>
          </div>
        ) : error ? (
          <p role="alert" className="text-xs text-dd-danger">{error}</p>
        ) : null}
      </div>
    </Modal>
  );
}

ApiKeyModelAccessModal.propTypes = {
  apiKey: PropTypes.object,
  catalog: PropTypes.array,
  onClose: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
};
