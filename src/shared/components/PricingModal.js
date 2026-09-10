"use client";

import { useEffect, useState } from "react";
import { getDefaultPricing, formatCost } from "open-sse/providers/pricing.js";
import Modal from "@/shared/ui/components/Modal.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";

const PRICING_FIELDS = [
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
  { key: "cached", label: "Cached" },
  { key: "reasoning", label: "Reasoning" },
  { key: "cache_creation", label: "Cache creation" },
];

function PricingCell({ provider, model, field, value, onChange }) {
  return (
    <Input
      type="number"
      step="0.01"
      min="0"
      size="sm"
      value={value ?? 0}
      onChange={(event) => onChange(provider, model, field, event.target.value)}
      aria-label={`${model} ${field} rate`}
      className="min-w-11 text-end font-mono dd-tnum"
    />
  );
}

export default function PricingModal({ isOpen, onClose, onSave }) {
  const [pricingData, setPricingData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) loadPricing();
  }, [isOpen]);

  const loadPricing = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/pricing");
      if (response.ok) {
        const data = await response.json();
        setPricingData(data);
      } else {
        const payload = await response.json().catch(() => ({}));
        setPricingData(getDefaultPricing());
        setError(payload.error || "Failed to load pricing");
      }
    } catch (loadError) {
      console.error("Failed to load pricing:", loadError);
      setPricingData(getDefaultPricing());
      setError(loadError.message || "Failed to load pricing");
    } finally {
      setLoading(false);
    }
  };

  const handlePricingChange = (provider, model, field, value) => {
    const numValue = parseFloat(value);
    if (Number.isNaN(numValue) || numValue < 0) return;
    setPricingData((prev) => {
      const next = { ...prev };
      if (!next[provider]) next[provider] = {};
      if (!next[provider][model]) next[provider][model] = {};
      next[provider][model][field] = numValue;
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pricingData),
      });
      if (response.ok) {
        onSave?.();
        onClose?.();
      } else {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error || "Failed to save pricing");
      }
    } catch (saveError) {
      console.error("Failed to save pricing:", saveError);
      setError(saveError.message || "Failed to save pricing");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/pricing", { method: "DELETE" });
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        setPricingData(payload && Object.keys(payload).length ? payload : getDefaultPricing());
        setResetOpen(false);
      } else {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error || "Failed to reset pricing");
        setResetOpen(false);
      }
    } catch (resetError) {
      console.error("Failed to reset pricing:", resetError);
      setError(resetError.message || "Failed to reset pricing");
      setResetOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const allProviders = Object.keys(pricingData).sort();
  const rows = allProviders.flatMap((provider) => {
    const models = Object.keys(pricingData[provider] || {}).sort();
    return models.map((model) => ({ provider, model, ...pricingData[provider][model] }));
  });

  const columns = [
    { key: "provider", label: "Provider", rowHeader: true, render: (row) => <span className="font-mono text-[13px] text-dd-text">{row.provider}</span> },
    { key: "model", label: "Model", render: (row) => <span className="font-mono text-[13px] text-dd-text">{row.model}</span> },
    ...PRICING_FIELDS.map((field) => ({
      key: field.key,
      label: field.label,
      align: "right",
      mono: true,
      render: (row) => <PricingCell provider={row.provider} model={row.model} field={field.key} value={row[field.key]} onChange={handlePricingChange} />,
    })),
  ];

  return (
    <>
      <Modal
        open={isOpen}
        onClose={onClose}
        title="Pricing Configuration"
        size="lg"
        pending={saving}
        footer={
          <>
            <Button variant="danger" onClick={() => setResetOpen(true)} disabled={saving} loading={saving && resetOpen}>Reset to defaults</Button>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button variant="primary" onClick={handleSave} loading={saving}>Save changes</Button>
            </div>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {error ? <div role="alert" className="flex items-start gap-2 rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-3 py-2 text-xs text-dd-danger"><span aria-hidden="true" className="material-symbols-outlined text-[16px] leading-none">error</span><span>{error}</span></div> : null}
          <aside className="rounded-dd-lg border border-dd-border-subtle bg-dd-surface-2 px-3 py-2 text-[13px] text-dd-muted">
            <p className="font-medium text-dd-text">Pricing rates format</p>
            <p className="mt-1">All rates are in <strong className="text-dd-text">dollars per million tokens</strong> ($/1M tokens). Example: an input rate of <span className="font-mono text-dd-text">2.50</span> means <span className="font-mono text-dd-text">{formatCost(2.5)}</span> per 1,000,000 input tokens.</p>
          </aside>
          {loading ? (
            <div role="status" aria-live="polite" className="flex items-center gap-2 px-3 py-6 text-xs text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined animate-spin text-[18px] leading-none">progress_activity</span><span>Loading pricing data…</span></div>
          ) : rows.length === 0 ? (
            <EmptyState icon="payments" title="No pricing data available" message="Add a provider to configure model rates." />
          ) : (
            <DataTable
              framed={false}
              columns={columns}
              rows={rows}
              keyFn={(row) => `${row.provider}:${row.model}`}
              caption="Pricing rates per provider and model"
              ariaLabel="Pricing rates per provider and model"
              density="compact"
              getRowLabel={(row) => `${row.provider} ${row.model}`}
            />
          )}
        </div>
      </Modal>
      <ConfirmDialog open={resetOpen} pending={saving} title="Reset pricing to defaults?" message="This replaces all provider rates with the built-in defaults. Existing overrides are lost." confirmLabel="Reset" tone="danger" onConfirm={handleReset} onCancel={() => { if (!saving) setResetOpen(false); }} />
    </>
  );
}
