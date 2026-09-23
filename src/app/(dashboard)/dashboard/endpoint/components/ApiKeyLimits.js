"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";

export const formatNumber = (n) => Math.round(n || 0).toLocaleString("en-US");
export const formatUsd = (n) => `$${(n || 0).toFixed(2)}`;

export function meterBarClass(ratio) {
  if (ratio >= 1) return "bg-dd-danger";
  if (ratio >= 0.8) return "bg-dd-warning";
  return "bg-dd-accent";
}

function UsageMeter({ label, used = 0, limit = null, format }) {
  const exhausted = limit != null && used >= limit;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[11px] text-dd-muted">
        <span>{label}</span>
        <span className={`font-mono ${exhausted ? "text-dd-danger" : ""}`}>
          {format(used)}{limit != null ? ` / ${format(limit)}` : " · no limit"}
        </span>
      </div>
      {limit != null ? (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-dd-surface-2">
          <div className={`h-full rounded-full ${meterBarClass(used / limit)}`} style={{ width: `${Math.min(used / limit, 1) * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}

UsageMeter.propTypes = {
  label: PropTypes.string.isRequired,
  used: PropTypes.number,
  limit: PropTypes.number,
  format: PropTypes.func.isRequired,
};

/** Compact meters for one key: RPM, plus every limit that is set or always shown. */
export function KeyUsageSummary({ usage }) {
  if (!usage) return null;
  const shown = usage.limits?.filter((l) => l.always || l.limit != null) || [];
  return (
    <div className="mt-2 grid max-w-xl grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-3">
      <UsageMeter label="Requests/min" used={usage.rpm?.used} limit={usage.rpm?.limit} format={formatNumber} />
      {usage.tpm?.limit != null ? (
        <UsageMeter label="Tokens/min" used={usage.tpm.used} limit={usage.tpm.limit} format={formatNumber} />
      ) : null}
      {shown.map((l) => (
        <UsageMeter key={l.field} label={l.label} used={l.used} limit={l.limit} format={l.money ? formatUsd : formatNumber} />
      ))}
    </div>
  );
}

KeyUsageSummary.propTypes = {
  usage: PropTypes.object,
};

// `dailyLimitTokens` is the key's own column; the rest live in its policy and
// match API_KEY_LIMIT_FIELDS in src/lib/db/helpers/apiKeyPolicy.js.
const LIMIT_SECTIONS = [
  {
    title: "Rate",
    hint: "Sliding 60 seconds. Tokens count once a response finishes.",
    fields: [
      { name: "rpmLimit", label: "Requests / minute" },
      { name: "tpmLimit", label: "Tokens / minute" },
    ],
  },
  {
    title: "Per day",
    hint: "Resets at the server's local midnight.",
    fields: [
      { name: "dailyLimitTokens", label: "Total tokens" },
      { name: "dailyInputTokenLimit", label: "Input tokens" },
      { name: "dailyOutputTokenLimit", label: "Output tokens" },
    ],
  },
  {
    title: "Per month",
    hint: "Resets on the 1st. Budget uses the cost estimates from Pricing settings.",
    fields: [
      { name: "monthlyTokenLimit", label: "Total tokens" },
      { name: "monthlyInputTokenLimit", label: "Input tokens" },
      { name: "monthlyOutputTokenLimit", label: "Output tokens" },
      { name: "monthlyRequestLimit", label: "Requests" },
      { name: "monthlyBudget", label: "Budget (USD)", step: "0.01" },
    ],
  },
];
const ALL_FIELDS = LIMIT_SECTIONS.flatMap((s) => s.fields);

const currentLimit = (apiKey, name) => (name === "dailyLimitTokens" ? apiKey?.dailyLimitTokens : apiKey?.policy?.[name]);
const toField = (v) => (v == null || v === 0 ? "" : String(v));
const toLimit = (v) => (String(v).trim() === "" || Number(v) === 0 ? null : Number(v));

/** Build the PUT /api/keys/:id body from the form values (empty or 0 = no limit). */
export function limitsPayloadFromValues(values) {
  return Object.fromEntries(ALL_FIELDS.map((f) => [f.name, toLimit(values[f.name] ?? "")]));
}

export function KeyLimitsModal({ apiKey, onClose, onSave }) {
  // Mounted fresh per key (the parent passes key={id}), so props seed the form once.
  const [values, setValues] = useState(() => Object.fromEntries(ALL_FIELDS.map((f) => [f.name, toField(currentLimit(apiKey, f.name))])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const invalid = Object.values(values).some((v) => String(v).trim() !== "" && !(Number(v) >= 0));

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(apiKey.id, limitsPayloadFromValues(values));
      onClose();
    } catch (e) {
      setError(e.message || "Failed to save limits");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!apiKey}
      size="xl"
      title={`Limits for ${apiKey?.name || "API key"}`}
      subtitle="Leave empty (or 0) for no limit. Over-limit requests get HTTP 429 with Retry-After."
      onClose={onClose}
      pending={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={invalid}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-xs text-dd-muted">
          Token, request and budget limits are checked before each request, so requests already in flight can go slightly over.
        </p>
        {LIMIT_SECTIONS.map((section) => (
          <div key={section.title} className="flex flex-col gap-2">
            <div>
              <p className="text-[13px] font-semibold text-dd-text">{section.title}</p>
              {section.hint ? <p className="text-xs text-dd-muted">{section.hint}</p> : null}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {section.fields.map((f) => (
                <Input
                  key={f.name}
                  label={f.label}
                  type="number"
                  min="0"
                  step={f.step || "1"}
                  value={values[f.name]}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                  placeholder="Unlimited"
                />
              ))}
            </div>
          </div>
        ))}
        {error ? <p role="alert" className="text-xs text-dd-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}

KeyLimitsModal.propTypes = {
  apiKey: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
};
