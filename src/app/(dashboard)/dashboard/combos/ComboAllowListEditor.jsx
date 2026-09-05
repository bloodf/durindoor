"use client";

import { useMemo, useState } from "react";
import Select from "@/shared/ui/components/Select.jsx";
import { Chip } from "@/shared/ui/components/Chip.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { isString } from "../../../../shared/utils/typeChecks.js";

/**
 * Per-combo connection allow-list editor (issue #747, units 2 + 4).
 * Mounted inline in `ComboCard` below the strategy row. Persists via the
 * existing `PUT /api/combos/[id]` `allowedConnectionIds` field — no
 * separate route. Empty list = unrestricted (existing behavior, unchanged).
 *
 * Group quick-add: when at least one connection group is defined, an
 * extra `Select` lets the operator append every member of that group to
 * the current allow-list. The group itself never becomes a dispatch unit;
 * its members are expanded at write time so deletion of a group cannot
 * orphan allow-list references.
 *
 * @param {object} props
 * @param {string[]} props.allowedConnectionIds current allow-list (never null)
 * @param {object[]} props.connections active provider connections for labels
 * @param {object[]} props.groups connection groups (each with `connectionIds`)
 * @param {(ids: string[]) => Promise<void>} props.onChange persists the new list
 */
function connectionLabel(connection) {
  return `${connection.name || connection.email || connection.provider || "Connection"} (${connection.id.slice(0, 8)})`;
}

function dedupeConcat(existing, additions) {
  const seen = new Set(existing);
  const out = [...existing];
  for (const id of additions) {
    if (!isString(id) || id.length === 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export default function ComboAllowListEditor({
  allowedConnectionIds = [],
  connections = [],
  groups = [],
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assignGroupValue, setAssignGroupValue] = useState("");

  const options = useMemo(
    () => connections.map((c) => ({ value: c.id, label: connectionLabel(c) })),
    [connections]
  );
  const labelForId = (id) => options.find((o) => o.value === id)?.label || id;

  const persist = async (next) => {
    setSaving(true);
    try {
      await onChange(next);
    } finally {
      setSaving(false);
    }
  };

  // Group quick-add: groups that still contribute at least one new id. Groups
  // with zero unknown members are hidden so the operator does not act on
  // already-fully-assigned groups.
  const groupOptions = useMemo(() => {
    return (groups || [])
      .map((g) => {
        const newMembers = g.connectionIds.filter((id) => !allowedConnectionIds.includes(id));
        return { group: g, newMembers };
      })
      .filter((entry) => entry.newMembers.length > 0)
      .map((entry) => ({
        value: entry.group.id,
        label: `${entry.group.name} (+${entry.newMembers.length})`,
        memberIds: entry.newMembers,
      }));
  }, [groups, allowedConnectionIds]);

  if (!open && allowedConnectionIds.length === 0) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-dd-muted outline-none transition-colors hover:text-dd-accent focus-visible:shadow-dd-focus"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[13px] leading-none">
          lock_open
        </span>
        Unrestricted — allow any eligible connection
      </button>
    );
  }

  const unselected = options.filter((o) => !allowedConnectionIds.includes(o.value));

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="material-symbols-outlined text-[13px] leading-none text-dd-muted">
          {allowedConnectionIds.length > 0 ? "lock" : "lock_open"}
        </span>
        <span className="text-[11px] font-medium text-dd-muted">
          Connection allow-list{allowedConnectionIds.length === 0 ? " (unrestricted)" : ""}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {allowedConnectionIds.map((id) => (
          <Chip
            key={id}
            size="sm"
            label={labelForId(id)}
            onRemove={() => persist(allowedConnectionIds.filter((x) => x !== id))}
          />
        ))}
        {groupOptions.length > 0 ? (
          <div className="min-w-[180px]">
            <Select
              options={groupOptions}
              value={assignGroupValue}
              onChange={(groupId) => {
                setAssignGroupValue("");
                const group = groupOptions.find((o) => o.value === groupId);
                if (!group) return;
                persist(dedupeConcat(allowedConnectionIds, group.memberIds));
              }}
              placeholder="Add a group…"
              size="sm"
            />
          </div>
        ) : null}
        <div className="min-w-[180px]">
          <Select
            options={unselected}
            value=""
            onChange={(id) => persist(dedupeConcat(allowedConnectionIds, [id]))}
            placeholder={unselected.length ? "Add connection…" : "All connections added"}
            disabled={saving || unselected.length === 0}
            size="sm"
          />
        </div>
        {allowedConnectionIds.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => persist([])} disabled={saving}>
            Clear (unrestrict)
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
