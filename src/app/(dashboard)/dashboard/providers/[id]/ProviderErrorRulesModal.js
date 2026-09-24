"use client";

import { useEffect, useState } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import Select from "@/shared/ui/components/Select.jsx";

const SCOPE_OPTIONS = [
  { value: "model", label: "Model" },
  { value: "provider", label: "Provider" },
  { value: "connection", label: "Connection" },
];

const MAX_MATCH_LENGTH = 200;
const MAX_RULES = 50;

function emptyDraft() {
  return { status: "429", match: "", scope: "model", cooldownSeconds: "" };
}

/**
 * OmniRoute #11104, adapted: manage this provider's operator error rules
 * (settings.providerErrorRules[providerId]). Consulted before the built-in
 * providerRuleRegistry catalog (open-sse/config/providerErrorRules.js).
 *
 * `match` is always a plain case-insensitive substring of the raw upstream
 * error text, never a regular expression -- the server rejects anything
 * else, so this form never offers a regex field.
 */
export default function ProviderErrorRulesModal({ isOpen, providerId, rules, onSave, onClose }) {
  const [localRules, setLocalRules] = useState([]);
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setLocalRules(rules || []);
      setDraft(emptyDraft());
      setError("");
    }
  }, [isOpen, rules]);

  const validateDraft = () => {
    const status = Number.parseInt(draft.status, 10);
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      return "Status must be an HTTP status code between 100 and 599.";
    }
    const match = draft.match.trim();
    if (!match || match.length > MAX_MATCH_LENGTH) {
      return `Match text is required and must be ${MAX_MATCH_LENGTH} characters or fewer.`;
    }
    if (!SCOPE_OPTIONS.some((option) => option.value === draft.scope)) {
      return "Choose a scope.";
    }
    if (localRules.length >= MAX_RULES) {
      return `At most ${MAX_RULES} rules are allowed for this provider.`;
    }
    return "";
  };

  const handleAddRule = () => {
    const validationError = validateDraft();
    if (validationError) {
      setError(validationError);
      return;
    }
    const cooldownSeconds = Number.parseInt(draft.cooldownSeconds, 10);
    const baseRule = {
      status: Number.parseInt(draft.status, 10),
      match: draft.match.trim(),
      scope: draft.scope
    };
    const rule = Number.isFinite(cooldownSeconds) && cooldownSeconds > 0 ?
    { ...baseRule, cooldownMs: cooldownSeconds * 1000 } :
    baseRule;
    setLocalRules([...localRules, rule]);
    setDraft(emptyDraft());
    setError("");
  };

  const handleRemoveRule = (index) => {
    setLocalRules(localRules.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(localRules);
      onClose();
    } catch (err) {
      setError(err?.message || "Failed to save error rules");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      title="Provider Error Rules"
      subtitle={`Consulted before the built-in rules for ${providerId}. Match is a plain substring, case-insensitive, never a regex.`}
      onClose={onClose}
      footer={
      <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </>
      }>

      <div className="flex flex-col gap-4">
        {localRules.length === 0 ?
        <p className="text-xs text-dd-muted">No rules declared for this provider yet.</p> :

        <ul className="flex flex-col gap-2">
            {localRules.map((rule, index) =>
          <li
            key={`${rule.status}-${rule.match}-${index}`}
            className="flex items-center justify-between gap-2 rounded-dd border border-dd-border bg-dd-surface px-3 py-2">

                <div className="min-w-0">
                  <p className="text-xs font-medium text-dd-text break-words">
                    {rule.status} contains &quot;{rule.match}&quot;
                  </p>
                  <p className="text-xs text-dd-muted">
                    scope: {rule.scope}
                    {rule.cooldownMs ? ` · cooldown: ${Math.round(rule.cooldownMs / 1000)}s` : ""}
                  </p>
                </div>
                <IconButton
              icon="delete"
              label={`Remove rule for status ${rule.status}`}
              size="sm"
              onClick={() => handleRemoveRule(index)} />

              </li>
          )}
          </ul>
        }

        <div className="flex flex-col gap-2 rounded-dd border border-dd-border bg-dd-surface-2 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Input
            label="Status"
            type="number"
            min={100}
            max={599}
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })} />

            <Select
            options={SCOPE_OPTIONS}
            value={draft.scope}
            onChange={(value) => setDraft({ ...draft, scope: value })}
            aria-label="Rule scope" />

          </div>
          <Input
          label="Match (substring, case-insensitive)"
          value={draft.match}
          onChange={(e) => setDraft({ ...draft, match: e.target.value })}
          placeholder="daily cap hit"
          hint="A literal substring of the raw upstream error text. Never a regular expression." />

          <Input
          label="Cooldown seconds (optional)"
          type="number"
          min={0}
          value={draft.cooldownSeconds}
          onChange={(e) => setDraft({ ...draft, cooldownSeconds: e.target.value })}
          hint="Leave blank to use the generic backoff ladder." />

          {error ?
          <div className="flex items-center gap-1.5 text-sm text-dd-danger" role="alert">
              <span aria-hidden="true" className="material-symbols-outlined text-base shrink-0">cancel</span>
              <span>{error}</span>
            </div> :
          null}
          <Button size="sm" variant="secondary" icon="add" onClick={handleAddRule}>Add Rule</Button>
        </div>
      </div>
    </Modal>);

}
