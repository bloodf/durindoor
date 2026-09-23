"use client";

// port(omniroute): provider peak-hour protection editor (OmniRoute #11622,
// adapted to Durin DS). Lets an operator block or deprioritize a connection
// during configured UTC windows (e.g. a provider's known peak-pricing hours).

import PropTypes from "prop-types";
import Input from "@/shared/ui/components/Input.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import { Chip } from "@/shared/ui/components/Chip.jsx";
import {
  PEAK_HOUR_PROTECTION_DAYS,
  normalizePeakHourProtection } from
"@/lib/providers/peakHourProtection";

export const EMPTY_PEAK_HOUR_PROTECTION = { enabled: false, mode: "block", windows: [] };

const DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

function newId() {
  return globalThis.crypto?.randomUUID ?
  globalThis.crypto.randomUUID() :
  `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function newWindow() {
  return { id: newId(), name: "", days: [], startUtc: "06:00", endUtc: "10:00" };
}

/** Coerce a stored (or freshly-loaded) value into editor-shaped state. */
export function cloneForEdit(value) {
  const normalized = normalizePeakHourProtection(value) || EMPTY_PEAK_HOUR_PROTECTION;
  return {
    enabled: normalized.enabled,
    mode: normalized.mode,
    windows: normalized.windows.map((window) => ({ id: newId(), ...window }))
  };
}

/** Strip UI-only fields (window.id) before persisting via providerSpecificData.peakHourProtection. */
export function normalizeForSave(value) {
  return normalizePeakHourProtection({
    enabled: value.enabled,
    mode: value.mode,
    windows: value.windows.map(({ id: _id, ...rest }) => rest)
  });
}

export function formatPeakHourSummary(value) {
  const config = normalizePeakHourProtection(value);
  if (!config?.enabled || config.windows.length === 0) return null;
  const mode = config.mode === "avoid" ? "Avoid" : "Block";
  return `${mode} during ${config.windows.length} peak window${config.windows.length === 1 ? "" : "s"}`;
}

export default function PeakHourProtectionEditor({ value, onChange }) {
  const updateWindow = (id, patch) => {
    onChange({
      ...value,
      windows: value.windows.map((window) => window.id === id ? { ...window, ...patch } : window)
    });
  };

  const toggleDay = (window, day) => {
    const days = new Set(window.days || []);
    if (days.has(day)) days.delete(day);else
    days.add(day);
    updateWindow(window.id, { days: Array.from(days) });
  };

  return (
    <section className="rounded-dd-lg border border-dd-border-subtle bg-dd-surface-2 p-4">
      <h3 className="mb-3 text-[13px] font-semibold text-dd-text">Peak-hour protection</h3>
      <div className="flex flex-col gap-4">
        <Toggle
          checked={value.enabled}
          onChange={(enabled) => onChange({ ...value, enabled })}
          label="Enable peak-hour protection"
          description="Block or deprioritize this connection during configured UTC windows, instead of pricing uncertain peak multipliers." />

        <Field label="Protection mode">
          <Select
            value={value.mode}
            onChange={(mode) => onChange({ ...value, mode })}
            options={[
            { value: "block", label: "Block requests" },
            { value: "avoid", label: "Avoid in routing" }]}

            aria-label="Protection mode" />

        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon="add"
            onClick={() => onChange({ ...value, windows: [...value.windows, newWindow()] })}>

            Add window
          </Button>
        </div>

        {value.windows.length === 0 ?
        <p className="text-xs text-dd-muted">No peak-hour windows configured.</p> :

        <div className="flex flex-col gap-3">
            {value.windows.map((window) =>
          <div key={window.id} className="rounded-dd border border-dd-border-subtle bg-dd-surface p-3">
                <div className="mb-3 flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                  label="Window name"
                  value={window.name || ""}
                  onChange={(e) => updateWindow(window.id, { name: e.target.value })}
                  placeholder="e.g. weekday peak" />

                  </div>
                  <Button
                variant="ghost"
                size="sm"
                icon="delete"
                onClick={() => onChange({ ...value, windows: value.windows.filter((w) => w.id !== window.id) })} />

                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                label="Start UTC"
                type="time"
                value={window.startUtc}
                onChange={(e) => updateWindow(window.id, { startUtc: e.target.value })} />

                  <Input
                label="End UTC"
                type="time"
                value={window.endUtc}
                onChange={(e) => updateWindow(window.id, { endUtc: e.target.value })} />

                </div>
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium text-dd-muted">Days (empty = every day)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PEAK_HOUR_PROTECTION_DAYS.map((day) =>
                <Chip
                  key={day}
                  size="sm"
                  label={DAY_LABELS[day]}
                  selected={(window.days || []).includes(day)}
                  onClick={() => toggleDay(window, day)} />

                )}
                  </div>
                </div>
              </div>
          )}
          </div>
        }
      </div>
    </section>);

}

PeakHourProtectionEditor.propTypes = {
  value: PropTypes['shape']({
    enabled: PropTypes.bool,
    mode: PropTypes.oneOf(["block", "avoid"]),
    windows: PropTypes.arrayOf(PropTypes.object)
  }).isRequired,
  onChange: PropTypes.func.isRequired
};
