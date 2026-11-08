"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import {
  PING_SCHEDULE_DEFAULTS,
  getLocalTimezone,
  getScheduleSlotLabels,
  maxSlotsPerDay,
  parseAnchor,
} from "@/shared/services/quotaPingSchedule";

// Upstream decolua/9router#4848: ping at fixed local wall-clock slots so the
// 5h windows line up with working hours. The reactive "on reset" toggle stays
// on the connection row; this modal only edits the anchored schedule.
function toFormState(schedule) {
  return {
    enabled: schedule?.enabled === true,
    anchor: schedule?.anchor || PING_SCHEDULE_DEFAULTS.anchor,
    timezone: schedule?.timezone || getLocalTimezone(),
    windowHours: String(schedule?.windowHours ?? PING_SCHEDULE_DEFAULTS.windowHours),
    slotsPerDay: String(schedule?.slotsPerDay ?? PING_SCHEDULE_DEFAULTS.slotsPerDay),
  };
}

function formatMinutes(total) {
  const minutes = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Keep dismissal blocked during save so a failed request retains the edited schedule. */
export default function AutoPingScheduleModal({ isOpen, connection = null, schedule = null, onSave, onClose }) {
  // Mounted only while a connection is selected, so initial state is fresh.
  const [form, setForm] = useState(() => toFormState(schedule));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const windowHours = Number(form.windowHours);
  const slotsPerDay = Number(form.slotsPerDay);
  const anchor = parseAnchor(form.anchor);
  const windowValid = Number.isFinite(windowHours) && windowHours >= 0.5 && windowHours <= 24;
  const slotsMax = windowValid ? maxSlotsPerDay(windowHours) : 24;
  const slotsValid = Number.isInteger(slotsPerDay) && slotsPerDay >= 1 && slotsPerDay <= slotsMax;
  const scheduleValid = Boolean(anchor) && windowValid && slotsValid;
  const canSave = !saving && (!form.enabled || scheduleValid);

  const previewSlots = form.enabled && scheduleValid
    ? getScheduleSlotLabels({ ...form, enabled: true, windowHours, slotsPerDay })
    : [];
  const coverageEnd = previewSlots.length
    ? formatMinutes(anchor.hour * 60 + anchor.minute + slotsPerDay * windowHours * 60)
    : "";

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await onSave(form.enabled
        ? { enabled: true, anchor: form.anchor, timezone: form.timezone, windowHours, slotsPerDay }
        : null);
      onClose();
    } catch (err) {
      setError(err?.message || "Failed to save the auto-ping schedule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      title="Auto-ping schedule"
      subtitle={`Ping at fixed local times${connection?.name ? ` for ${connection.name}` : ""}. Each ping consumes a small amount of quota.`}
      onClose={onClose}
      pending={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>{saving ? "Saving..." : "Save"}</Button>
        </>
      }>
      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm text-dd-text">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => update({ enabled: e.target.checked })} />
          Enable scheduled pings
        </label>

        {form.enabled &&
        <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input
              label="Anchor time"
              type="time"
              value={form.anchor}
              onChange={(e) => update({ anchor: e.target.value })}
              error={anchor ? "" : "Use HH:MM"} />
              <Input
              label="Window (hours)"
              type="number"
              min="0.5"
              max="24"
              step="0.5"
              value={form.windowHours}
              onChange={(e) => update({ windowHours: e.target.value })}
              error={windowValid ? "" : "0.5 to 24"} />
              <Input
              label="Pings per day"
              type="number"
              min="1"
              max={String(slotsMax)}
              step="1"
              value={form.slotsPerDay}
              onChange={(e) => update({ slotsPerDay: e.target.value })}
              error={slotsValid ? "" : `1 to ${slotsMax}`}
              hint={slotsValid ? `Max ${slotsMax}` : ""} />
            </div>

            {previewSlots.length > 0 &&
          <div className="rounded-dd border border-dd-border bg-dd-surface-2 px-3 py-2">
                <p className="text-xs font-medium text-dd-muted">Daily slots ({form.timezone})</p>
                <p className="mt-1 text-sm font-medium text-dd-text">{previewSlots.join(" → ")}</p>
                <p className="mt-1 text-xs text-dd-muted">
                  Covers {previewSlots[0]} to {coverageEnd}, then pauses until {previewSlots[0]} the next day.
                </p>
              </div>
          }
          </>
        }

        {error ?
        <div className="flex items-center gap-1.5 text-sm text-dd-danger" role="alert">
            <span aria-hidden="true" className="material-symbols-outlined text-base shrink-0">cancel</span>
            <span>{error}</span>
          </div> :
        null}
      </div>
    </Modal>);
}

AutoPingScheduleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  connection: PropTypes.object,
  schedule: PropTypes.object,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
