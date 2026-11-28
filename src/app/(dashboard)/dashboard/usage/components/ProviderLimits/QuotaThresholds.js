"use client";

import { useState } from "react";
import Button from "@/shared/ui/components/Button.jsx";

/** Quota buffer controls identify both the provider and quota window to assistive technology. */
export default function QuotaThresholds({ connection, onSaved }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  if (!connection.quotaWindows?.length) return null;
  async function save(event, key) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("percent");
    const percent = value === "" || Number(value) === 0 ? null : Number(value);
    if (percent !== null && (!Number.isFinite(percent) || percent <= 0 || percent > 100)) {
      setError("Enter a percentage between 0 and 100.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/providers/${encodeURIComponent(connection.id)}/quota-threshold`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dimensionKey: key, percent }),
      });
      if (!response.ok) throw new Error("Could not save quota buffer.");
      await onSaved();
    } catch (failure) { setError(failure.message); } finally { setPending(false); }
  }
  return <div className="flex flex-col gap-2 border-t border-dd-border-subtle pt-2">
    <p className="text-xs text-dd-muted">Pause when remaining quota reaches the buffer. Clear or set to 0 to use the inherited setting.</p>
    {connection.quotaWindows.map((window) => <form key={window.key} onSubmit={(event) => void save(event, window.key)} className="flex flex-wrap items-center gap-2">
      <label className="min-w-0 flex-1 text-xs text-dd-muted" htmlFor={`quota-${connection.id}-${window.key}`}>{window.key}{window.effectivePercent !== null ? ` (effective ${window.effectivePercent}%)` : ""}</label>
      <input key={String(window.percent)} id={`quota-${connection.id}-${window.key}`} aria-label={`${connection.provider} ${window.key} quota buffer`} name="percent" type="number" min="0" max="100" step="any" defaultValue={window.percent ?? ""} className="w-20 rounded border border-dd-border-subtle bg-transparent px-2 py-1 text-sm" />
      <Button type="submit" variant="secondary" size="sm" disabled={pending} aria-label={`Save ${connection.provider} ${window.key} quota buffer`}>Save</Button>
    </form>)}
    {error ? <p role="alert" className="text-xs text-dd-danger">{error}</p> : null}
  </div>;
}
