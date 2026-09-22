"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { isString } from "../../../../../shared/utils/typeChecks.js";

// Pick the models a provider exposes on /v1/models ("visible models" allowlist).
//
// The list here is deliberately wider than the provider page's model chips:
// providers with a live catalog (GitHub Copilot, ...) expose models upstream that
// the static registry has never listed, and only an allowlist can hide those,
// a blacklist built from the registry can never name them. Live entries come
// from /api/providers/[id]/models, with the registry as fallback.
//
// Saving an empty selection clears the allowlist = no restriction.
export default function VisibleModelsModal({
  isOpen,
  onClose,
  providerId,
  providerAlias,
  connections,
  customModels,
  disabledModelIds,
  onSaved,
}) {
  const [available, setAvailable] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Save must stay disabled until the current allowlist loads: saving on a
  // failed GET would overwrite the stored allowlist with whatever this open
  // happened to fetch, wiping the user's real selection.
  const [loadFailed, setLoadFailed] = useState(false);

  const activeConnectionIds = useMemo(
    () => (connections || []).filter((c) => c.isActive !== false && c.id).map((c) => c.id),
    [connections]
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;

    (async () => {
      // A refetch (new provider, connections, or blacklist) must lock Save
      // until it resolves, or Save would write the previous selection.
      setLoading(true);
      let current = [];
      let failed = false;
      try {
        const res = await fetch(
          `/api/models/enabled?providerAlias=${encodeURIComponent(providerAlias)}`,
          { cache: "no-store" }
        );
        if (res.ok) current = (await res.json()).ids || [];
        else failed = true;
      } catch {
        failed = true;
      }
      if (cancelled) return undefined;
      setLoadFailed(failed);
      if (failed) {
        setError("Could not load the current allowlist. Reopen to try again.");
      }

      const liveLists = await Promise.all(
        activeConnectionIds.map(async (connectionId) => {
          try {
            const res = await fetch(`/api/providers/${connectionId}/models`, { cache: "no-store" });
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data?.models) ? data.models : [];
          } catch {
            return [];
          }
        })
      );
      if (cancelled) return undefined;

      const seen = new Set();
      const rows = [];
      const push = (id, name, extra = {}) => {
        const key = String(id ?? "").trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        rows.push({ id: key, name: name || key, ...extra });
      };

      // Live catalog first — these are the ids missing from the registry.
      for (const list of liveLists) {
        for (const entry of list) {
          const id = isString(entry) ? entry : entry?.id;
          const name = isString(entry) ? entry : (entry?.name || entry?.id);
          push(id, name, { live: true });
        }
      }
      // Every kind: /v1/models applies the allowlist to embedding, image,
      // TTS, ... rows too, so hiding them here would drop them on first save.
      for (const model of getModelsByProviderId(providerId) || []) {
        push(model.id, model.name);
      }
      // Allowlisted ids that no longer show up in any catalog stay listed, so
      // saving cannot silently drop them.
      for (const id of current) push(id, id, { stale: true });

      // With no stored allowlist, default to nothing selected — matching the
      // "unchecked = no restriction" semantics this modal documents. Defaulting
      // to every row loaded here would let an untouched Save persist whatever
      // this fetch happened to see as a permanent allowlist, silently hiding
      // any model missing from this load (a new upstream model, a failed
      // connection catalog) forever after.
      const defaults = current;

      setAvailable(rows);
      setSelected(new Set(defaults));
      setLoading(false);
      return undefined;
    })();

    return () => { cancelled = true; };
  }, [isOpen, providerId, providerAlias, activeConnectionIds, disabledModelIds]);

  // Custom models are merged into /v1/models after the allowlist, so they are
  // always visible — showing them as toggleable would be a lie.
  // Match the aliases /v1/models accepts for custom rows: storage alias,
  // registry alias, provider id, and the first active connection's prefix.
  const customRows = useMemo(() => {
    const prefix = (connections || []).find((c) => c.isActive !== false)?.providerSpecificData?.prefix;
    const aliases = new Set([providerAlias, providerId, PROVIDER_ID_TO_ALIAS[providerId], isString(prefix) ? prefix.trim() : ""]);
    return (customModels || [])
      .filter((m) => aliases.has(m.providerAlias))
      .map((m) => ({ id: String(m.id).trim(), name: m.name || m.id }))
      .filter((m) => m.id);
  }, [customModels, connections, providerAlias, providerId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return available;
    return available.filter(
      (row) => row.id.toLowerCase().includes(query) || row.name.toLowerCase().includes(query)
    );
  }, [available, search]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const ids = Array.from(selected);
      const res = await fetch("/api/models/enabled", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias, ids }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to save (${res.status})`);
      }
      onSaved?.(ids);
      onClose();
    } catch (e) {
      setError(e?.message || "Failed to save visible models");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Visible models" size="lg" footer={null}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/8 px-2.5 py-2 text-xs text-text-muted">
          <span className="material-symbols-outlined shrink-0 text-primary" style={{ fontSize: "14px" }}>info</span>
          <span>
            Only the checked models are exposed on <code className="font-mono">/v1/models</code>. Leave
            everything unchecked to expose all of them. Custom models and web search/fetch endpoints are always exposed.
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">
              search
            </span>
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded border border-border bg-surface py-1.5 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set(available.map((row) => row.id)))}
            disabled={loading || saving}
          >
            Select all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            disabled={loading || saving}
          >
            Clear
          </Button>
        </div>

        {error && <p className="text-xs text-red-500 break-words">{error}</p>}

        {loading ? (
          <p className="py-6 text-center text-xs text-text-muted">Loading models...</p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border">
            {filtered.map((row) => (
              <label
                key={row.id}
                className="flex cursor-pointer items-center gap-2 border-b border-border/50 px-3 py-2 last:border-b-0 hover:bg-sidebar/50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  onChange={() => toggle(row.id)}
                  className="size-3.5 accent-primary cursor-pointer"
                />
                <span className="truncate text-xs text-text-main">{row.name}</span>
                <code className="truncate font-mono text-[11px] text-text-muted">{row.id}</code>
                {row.live && !row.stale && (
                  <span className="ml-auto shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">live</span>
                )}
                {row.stale && (
                  <span className="ml-auto shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">not in catalog</span>
                )}
              </label>
            ))}
            {filtered.length === 0 && (
              <p className="py-6 text-center text-xs text-text-muted">No models found</p>
            )}
          </div>
        )}

        {customRows.length > 0 && (
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="mb-1 text-[11px] text-text-muted">Always exposed (custom models)</p>
            <div className="flex flex-wrap gap-1.5">
              {customRows.map((row) => (
                <span key={row.id} className="rounded bg-sidebar px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
                  {row.id}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-text-muted">
            {selected.size === 0
              ? "Nothing selected — all models stay visible."
              : `${selected.size} of ${available.length} selected`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSave} loading={saving} disabled={loading || loadFailed}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

VisibleModelsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  providerId: PropTypes.string.isRequired,
  providerAlias: PropTypes.string.isRequired,
  connections: PropTypes.arrayOf(PropTypes.object),
  customModels: PropTypes.arrayOf(PropTypes.object),
  disabledModelIds: PropTypes.arrayOf(PropTypes.string),
  onSaved: PropTypes.func,
};
