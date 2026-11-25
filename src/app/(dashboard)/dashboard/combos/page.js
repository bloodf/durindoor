"use client";

import useSettingsStore from "@/store/settingsStore";

import { useState, useEffect, useEffectEvent, useRef } from "react";
import { ModelSelectModal, CapacityBadges, CardSkeleton } from "@/shared/components";
import Button from "@/shared/ui/components/Button.jsx";
import { Card } from "@/shared/ui/components/Card.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import DocsLink from "@/shared/components/DocsLink";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { filterActiveConnections } from "@/shared/utils/connectionStatus";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { aggregateComboCapabilities, overlayComboCapabilities } from "open-sse/providers/capabilities.js";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { translate } from "@/i18n/runtime";
import ConnectionGroupsPanel from "./ConnectionGroupsPanel.jsx";
import ComboAllowListEditor from "./ComboAllowListEditor.jsx";
import ComboUsageReport from "./components/ComboUsageReport";
import ComboFormModal from "./components/ComboFormModal.jsx";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import ModelSummary from "@/shared/ui/v5/combos/ModelSummary.jsx";
import "@/shared/ui/v5/combos/combos.css";
import { createSettingsQueue } from "../providers/workflowRequests.js";


export default function CombosPage() {
  const v5 = useUiV5();
  const settingsError = useSettingsStore((state) => state.error);
  const [strategyQueue] = useState(() => createSettingsQueue({}, async (updated) => {
    const saved = await useSettingsStore.getState().patchSettings({ comboStrategies: updated });
    if (!saved) throw new Error(useSettingsStore.getState().error || translate("Could not save routing strategy. Retry."));
    setComboStrategies(updated);
  }));
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [providerConnections, setProviderConnections] = useState([]);
  const [comboStrategies, setComboStrategies] = useState({});
  const [prunedCombos, setPrunedCombos] = useState({});
  const [confirmState, setConfirmState] = useState(null);
  const [groups, setGroups] = useState([]);
  const [presetLoading, setPresetLoading] = useState(null); // "cursor" | "claude" | null
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Connection groups (issue #747): allow-list options come from the same
  // active-providers fetch; groups themselves load in ConnectionGroupsPanel.
  const { getCaps } = useModelCaps();
  const { copied, copy } = useCopyToClipboard();

  const loadRequest = useRef(0);
  const strategyVersion = useRef(0);
  const strategyWrites = useRef(0);

  const selectedCombos = combos.filter((c) => selectedIds.includes(c.id));
  const allSelected = combos.length > 0 && selectedIds.length === combos.length;
  const someSelected = selectedIds.length > 0;

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : combos.map((c) => c.id));
  };

  const clearSelection = () => setSelectedIds([]);

  // Cursor/Claude Default preset generation is hidden in the UI (parity with
  // upstream's decolua/9router#1a027131) but stays wired for support/debug use.
  const handleGeneratePresets = async (source) => {
    const label = source === "cursor" ? "Cursor Default" : "Claude Default";
    setPresetLoading(source);
    try {
      const previewRes = await fetch(`/api/combos/presets?source=${source}`);
      if (!previewRes.ok) {
        const preview = await previewRes.json().catch(() => ({}));
        alert(preview.error || `Failed to preview ${label}`);
        return;
      }
      const preview = await previewRes.json();

      const toCreate = preview.toCreate ?? (preview.items || []).filter((i) => !i.exists).length;
      const toSkip = preview.toSkip ?? (preview.items || []).filter((i) => i.exists).length;
      const total = (preview.items || []).length;

      if (total === 0) {
        alert(`No ${label} models available to generate.`);
        return;
      }

      if (toCreate === 0) {
        alert(`All ${total} ${label} combos already exist. Nothing to create.`);
        return;
      }

      setConfirmState({
        title: `Generate ${label}`,
        message: `Create ${toCreate} combo${toCreate === 1 ? "" : "s"} named like ${source === "cursor" ? "Cursor" : "Claude"} model IDs (seeded with cu/… or cc/…). ${toSkip} already exist and will be skipped. You can edit any combo afterward to add fallbacks.`,
        confirmLabel: "Generate",
        tone: "primary",
        onConfirm: async () => {
          setConfirmState((prev) => prev ? { ...prev, pending: true } : null);
          try {
            const res = await fetch("/api/combos/presets", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source }),
            });
            const data = await res.json();
            if (!res.ok) {
              alert(data.error || `Failed to generate ${label}`);
              return;
            }
            await fetchData();
            setConfirmState(null);
          } catch (error) {
            console.log(`Error generating ${label}:`, error);
            alert(`Failed to generate ${label}`);
            setConfirmState((prev) => prev ? { ...prev, pending: false } : null);
          }
        },
      });
    } catch (error) {
      console.log(`Error previewing ${label}:`, error);
      alert(`Failed to preview ${label}`);
    } finally {
      setPresetLoading(null);
    }
  };

  // Combo members whose model a provider's auto-synced list no longer has.
  // Optional metadata: a failure just leaves the badges off.
  const fetchPrunedCombos = async (isCurrent) => {
    try {
      const res = await fetch("/api/models/auto-sync", { cache: "no-store" });
      const data = res?.ok ? await res.json() : null;
      if (isCurrent()) setPrunedCombos(data?.prunedReferences?.combos || {});
    } catch {
      if (isCurrent()) setPrunedCombos({});
    }
  };

  const fetchData = async () => {
    const request = ++loadRequest.current;
    const version = strategyVersion.current;
    const writesInFlight = strategyWrites.current;
    const isCurrent = () => loadRequest.current === request;
    try {
      const [combosRes, providersRes, settingsRes, groupsRes] = await Promise.all([
        fetch("/api/combos"),
        fetch("/api/providers"),
        useSettingsStore.getState().fetchSettings({ force: true }),
        fetch("/api/connection-groups"),
      ]);
      const combosData = combosRes.ok ? await combosRes.json() : await combosRes.json().catch(() => ({}));
      if (!combosRes.ok) throw new Error(combosData?.error || `Failed to load combos (${combosRes.status})`);
      const providersData = providersRes.ok ? await providersRes.json() : await providersRes.json().catch(() => ({}));
      const settingsData = settingsRes || {};
      const groupsData = groupsRes.ok ? await groupsRes.json() : {};

      if (!isCurrent()) return;
      // Show every non-media combo here (llm, embedding, tts, ...); media/web
      // combos belong to media-providers/web (#2686).
      // Older or malformed records may omit models; cards and editors expect an array.
      const visibleCombos = (Array.isArray(combosData.combos) ? combosData.combos : [])
        .filter(c => !MEDIA_PROVIDER_KINDS.some(({ id }) => id === c.kind))
        .map(c => ({ ...c, models: Array.isArray(c.models) ? c.models : [] }));
      setLoadError("");
      setCombos(visibleCombos);
      const alive = new Set(visibleCombos.map((combo) => combo.id));
      setSelectedIds((prev) => prev.filter((id) => alive.has(id)));
      if (providersRes.ok) {
        const connections = providersData.connections || [];
        setProviderConnections(connections);
        setActiveProviders(filterActiveConnections(connections));
      }
      if (groupsRes.ok) setGroups(groupsData.groups || []);
      // A read overlapping a strategy write may contain the pre-write map.
      if (!v5 || (!writesInFlight && !strategyWrites.current && version === strategyVersion.current)) {
        setComboStrategies(settingsData.comboStrategies || {});
        strategyQueue.replace(settingsData.comboStrategies || {});
      }
      await fetchPrunedCombos(isCurrent);
    } catch (error) {
      console.log("Error fetching data:", error);
      if (isCurrent()) setLoadError(error.message || "Failed to load combos");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const loadInitialData = useEffectEvent(() => { fetchData(); });
  useEffect(() => {
    loadInitialData();
    return () => { loadRequest.current += 1; };
  }, []);

  const handleCreate = async (data) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setShowCreateModal(false);
        return { ok: true };
      }
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.error || "Failed to create combo" };
    } catch (error) {
      console.log("Error creating combo:", error);
      return { ok: false, error: "Network error" };
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setEditingCombo(null);
        return { ok: true };
      }
      const err = await res.json().catch(() => ({}));
      const message = err.error || "Failed to update combo";
      console.log("Combo update rejected:", message);
      return { ok: false, error: message };
    } catch (error) {
      console.log("Error updating combo:", error);
      return { ok: false, error: "Network error" };
    }
  };

  const pruneStrategiesForNames = (names, base = comboStrategies) => {
    const updated = { ...base };
    for (const name of names) delete updated[name];
    return updated;
  };

  // V5 serializes strategy edits against the last accepted settings map so
  // edits to separate rows cannot overwrite each other while a request is pending.
  const persistComboStrategies = async (change) => {
    if (v5) {
      strategyVersion.current += 1;
      strategyWrites.current += 1;
      try {
        return await strategyQueue.update(change);
      } finally {
        strategyWrites.current -= 1;
        strategyVersion.current += 1;
      }
    }
    const updated = change(comboStrategies);
    const saved = await useSettingsStore.getState().patchSettings({ comboStrategies: updated });
    if (!saved) throw new Error(useSettingsStore.getState().error || "Failed to save combo strategy");
    setComboStrategies(updated);
  };

  const handleDelete = async (id) => {
    let pending = false;
    const combo = combos.find((c) => c.id === id);
    setConfirmState({
      title: "Delete Combo",
      message: combo ? `Delete combo "${combo.name}"?` : "Delete this combo?",
      onConfirm: async () => {
        if (pending) return;
        pending = true;
        setConfirmState((prev) => prev ? { ...prev, pending: true, error: "" } : null);
        try {
          const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("Failed to delete combo");
          if (combo?.name) {
            await persistComboStrategies((current) => pruneStrategiesForNames([combo.name], current));
          }
          setCombos((prev) => prev.filter((c) => c.id !== id));
          setSelectedIds((prev) => prev.filter((x) => x !== id));
          setConfirmState(null);
        } catch (error) {
          console.log("Error deleting combo:", error);
          // Keep the failed combo and confirmation available for retry.
          setConfirmState((prev) => prev ? { ...prev, pending: false, error: "Failed to delete combo. Please try again." } : null);
        } finally {
          pending = false;
        }
      }
    });
  };

  const handleBulkDelete = () => {
    if (selectedCombos.length === 0) return;
    const count = selectedCombos.length;
    let remaining = selectedCombos;
    let strategies = comboStrategies;
    const deletedNames = new Set();
    let pending = false;
    setConfirmState({
      title: "Delete Selected Combos",
      message: `Delete ${count} selected combo${count === 1 ? "" : "s"}? This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
      onConfirm: async () => {
        if (pending) return;
        pending = true;
        setConfirmState((prev) => prev ? { ...prev, pending: true, error: "" } : null);
        setBulkBusy(true);
        try {
          // Settle every ID; retain only failed/uncertain targets in this retry closure.
          const results = await Promise.allSettled(
            remaining.map((combo) => fetch(`/api/combos/${combo.id}`, { method: "DELETE" }))
          );
          const succeeded = remaining.filter((_, index) => (
            results[index].status === "fulfilled" && results[index].value.ok
          ));
          const ids = succeeded.map((combo) => combo.id);
          remaining = remaining.filter((combo) => !ids.includes(combo.id));
          succeeded.forEach((combo) => deletedNames.add(combo.name));
          strategies = pruneStrategiesForNames(succeeded.map((combo) => combo.name), strategies);
          setCombos((prev) => prev.filter((combo) => !ids.includes(combo.id)));
          setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
          if (ids.length > 0 || remaining.length === 0) {
            // Keep cleanup retryable until the settings boundary accepts it.
            if (v5) {
              await persistComboStrategies((current) => pruneStrategiesForNames([...deletedNames], current));
            } else {
              const saved = await useSettingsStore.getState().patchSettings({ comboStrategies: strategies });
              if (!saved) throw new Error(useSettingsStore.getState().error || "Failed to update combo strategies");
              setComboStrategies(strategies);
            }
          }
          if (remaining.length > 0) {
            const failed = remaining.length;
            setConfirmState((prev) => prev ? {
              ...prev,
              pending: false,
              error: `${failed} combo${failed === 1 ? "" : "s"} could not be deleted. Please try again.`,
            } : null);
          } else {
            setConfirmState(null);
          }
        } catch (error) {
          console.log("Error bulk deleting combos:", error);
          setConfirmState((prev) => prev ? {
            ...prev, pending: false, error: "Failed to update combo strategies. Please try again.",
          } : null);
        } finally {
          pending = false;
          setBulkBusy(false);
        }
      },
    });
  };

  // Merge a per-combo strategy patch into settings.comboStrategies. Passing an empty
  // patch (strategy back to default "fallback") drops the entry entirely.
  const handleSetComboStrategy = async (comboName, patch) => {
    try {
      const update = (current) => {
      const updated = { ...current };
      const next = { ...(updated[comboName] || {}), ...patch };
      // Prune to keep settings clean: default fallback with no extras = no entry.
      if (!next.fallbackStrategy || next.fallbackStrategy === "fallback") {
        // Extras include timeout, sticky limit, fusion config — preserve when any are set.
        if (!next.timeoutMs && !next.stickyLimit && !next.judgeModel && !next.fusionTuning) {
          delete updated[comboName];
        } else {
          updated[comboName] = next;
        }
      } else {
        updated[comboName] = next;
      }

      return updated;
      };
      await persistComboStrategies(update);
      return { ok: true };
    } catch (error) {
      console.log("Error updating combo strategy:", error);
      alert(error.message);
      return { ok: false, error: error.message };
    }
  };

  const handleBulkSetStrategy = async (strategy) => {
    if (selectedCombos.length === 0 || !strategy) return;
    setBulkBusy(true);
    try {
      const update = (current) => {
      const updated = { ...current };
      for (const combo of selectedCombos) {
        if (!strategy || strategy === "fallback") {
          delete updated[combo.name];
        } else {
          updated[combo.name] = {
            ...(updated[combo.name] || {}),
            fallbackStrategy: strategy,
          };
        }
      }
      return updated;
      };
      await persistComboStrategies(update);
    } catch (error) {
      console.log("Error bulk updating combo strategy:", error);
      alert("Failed to update strategy for selected combos");
    } finally {
      setBulkBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className={`${v5 ? "v5-combos-page " : ""}flex min-w-0 flex-col gap-6 px-1 sm:px-0`}>
      {settingsError && <p role="alert" className="text-dd-danger">{settingsError}</p>}
      <PageHeader
        className={v5 ? "v5-combo-page-heading" : undefined}
        icon="layers"
        title={translate("Combos")}
        subtitle={translate("Group models under one name, then pick a strategy per combo.")}
        actions={
          <div className={`flex w-full flex-col gap-2 sm:w-auto sm:items-stretch${v5 ? " sm:me-0.5" : ""}`}>
            <Button
              variant="primary"
              icon="add"
              onClick={() => setShowCreateModal(true)}
              className="w-full sm:w-auto whitespace-nowrap"
            >
              {translate("Create Combo")}
            </Button>
            {/* Cursor/Claude Default preset generators — hidden pending UX pass
                (parity with upstream decolua/9router#1a027131), left wired below. */}
            <div className="hidden">
              <Button
                variant="secondary"
                size="sm"
                icon="edit_note"
                loading={presetLoading === "cursor"}
                disabled={!!presetLoading}
                onClick={() => handleGeneratePresets("cursor")}
                className="w-full whitespace-nowrap"
              >
                {translate("Cursor Default")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon="smart_toy"
                loading={presetLoading === "claude"}
                disabled={!!presetLoading}
                onClick={() => handleGeneratePresets("claude")}
                className="w-full whitespace-nowrap"
              >
                {translate("Claude Default")}
              </Button>
            </div>
          </div>
        }
      />
      {loadError ? (
        <Card>
          <div role="alert" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-dd-danger">{loadError}</p>
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                setLoading(true);
                await fetchData();
              }}
            >
              Retry
            </Button>
          </div>
        </Card>
      ) : null}
      <DocsLink path="features/combos#strategies" label={translate("How combo strategies work")} />
      {loadError ? null : combos.length === 0 ? (
        <Card>
          <EmptyState
            icon="layers"
            title={translate("No combos yet")}
            message={translate("Create model combos with fallback support")}
            action={{
              label: translate("Create Combo"),
              icon: "add",
              onClick: () => setShowCreateModal(true),
            }}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Selection toolbar */}
          <div className="flex min-w-0 flex-col gap-2 rounded-dd border border-dd-border-subtle bg-dd-surface-2/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <Checkbox
              checked={allSelected}
              onChange={toggleSelectAll}
              label={someSelected ? `${selectedIds.length} selected` : `Select all (${combos.length})`}
              ref={(el) => {
                if (el) el.indeterminate = someSelected && !allSelected;
              }}
              className="text-xs text-dd-muted"
            />

            {someSelected && (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="w-full min-w-[160px] sm:w-[200px]">
                  <Select
                    options={getStrategyOptions()}
                    value=""
                    placeholder={translate("Set strategy…")}
                    disabled={bulkBusy}
                    onChange={(value) => {
                      if (value) handleBulkSetStrategy(value);
                    }}
                    size="sm"
                  />
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  icon="delete"
                  disabled={bulkBusy}
                  loading={bulkBusy}
                  onClick={handleBulkDelete}
                  className="whitespace-nowrap"
                >
                  {translate("Delete")} ({selectedIds.length})
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearSelection}
                  disabled={bulkBusy}
                >
                  {translate("Clear")}
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {(() => {
              const comboByName = Object.fromEntries(combos.map((combo) => [combo.name, {
                models: Array.isArray(combo.models) ? combo.models : [],
                capabilities: combo.capabilities || null
              }]));
              return combos.map((combo) => (
                <ComboCard
                  key={combo.id}
                  combo={combo}
                  v5={v5}
                  getCaps={getCaps}
                  comboByName={comboByName}
                  activeProviders={activeProviders}
                  copied={copied}
                  onCopy={copy}
                  onEdit={() => setEditingCombo(combo)}
                  onDelete={() => handleDelete(combo.id)}
                  strategy={comboStrategies[combo.name] || {}}
                  prunedMembers={prunedCombos[combo.name] || []}
                  onSetStrategy={(patch) => handleSetComboStrategy(combo.name, patch)}
                  selected={selectedIds.includes(combo.id)}
                  onToggleSelect={() => toggleSelect(combo.id)}
                  allowListEditor={
                    <ComboAllowListEditor
                      allowedConnectionIds={combo.allowedConnectionIds || []}
                      connections={providerConnections}
                      groups={groups}
                      onChange={async (allowedConnectionIds) => {
                        const result = await handleUpdate(combo.id, { allowedConnectionIds });
                        if (v5) return result;
                      }}
                    />
                  }
                />
              ));
            })()}
          </div>
        </div>
      )}

      <ConnectionGroupsPanel connections={providerConnections} onGroupsChange={setGroups} />

      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="connection-usage-heading">
        <h2 id="connection-usage-heading" className="text-lg font-semibold text-dd-text">{translate("Connection usage")}</h2>
        <ComboUsageReport period="7d" customRange={null} resetNonce={0} />
      </section>

      {/* Create Modal - Use key to force remount and reset state */}
      {showCreateModal && <ComboFormModal
        key="create"
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreate}
        activeProviders={activeProviders}
      />}

      {/* Edit Modal - Use key to force remount and reset state */}
      {editingCombo && <ComboFormModal
        key={editingCombo.id}
        isOpen={!!editingCombo}
        combo={editingCombo}
        onClose={() => setEditingCombo(null)}
        onSave={(data) => handleUpdate(editingCombo.id, data)}
        activeProviders={activeProviders}
      />}
      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.error ? (
          <>
            {confirmState.message}
            <p role="alert" className="mt-2 text-dd-danger">{confirmState.error}</p>
          </>
        ) : confirmState?.message}
        confirmLabel={confirmState?.confirmLabel || "Confirm"}
        tone={confirmState?.tone || "danger"}
        pending={!!confirmState?.pending}
        onCancel={() => !confirmState?.pending && setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
      />
    </div>
  );
}

const fmtK = (n) => {
  if (!n) return "?";
  if (n >= 1000000) {
    const m = n / 1000000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  return `${Math.round(n / 1000)}k`;
};

function getStrategyOptions() {
  return [
    { value: "fallback", label: translate("Fallback — try in order") },
    { value: "round-robin", label: translate("Round Robin — rotate") },
    { value: "weighted", label: translate("Weighted — random by member weight") },
    { value: "smart-scoring", label: "Smart Scoring — best quota first" },
    { value: "smart", label: translate("Smart — complexity-aware routing") },
    { value: "fusion", label: translate("Fusion — panel + judge") },
  ];
}

function ComboCard({ combo, v5, getCaps, comboByName = {}, activeProviders = [], copied, onCopy, onEdit, onDelete, strategy = {}, onSetStrategy, allowListEditor, selected = false, onToggleSelect, prunedMembers = [] }) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const [timeoutDraft, setTimeoutDraft] = useState(null);
  const [writeState, setWriteState] = useState({ pending: false, error: "", retry: false });
  const rowPending = useRef(false);
  const retryPatch = useRef(null);
  const savePatch = async (patch) => {
    if (rowPending.current) return;
    rowPending.current = true;
    retryPatch.current = patch;
    setWriteState({ pending: true, error: "", retry: false });
    const result = await onSetStrategy(patch);
    if (result?.ok === false) setWriteState({ pending: false, error: result.error || translate("Routing change could not be saved."), retry: true });
    else {
      if (Object.hasOwn(patch, "timeoutMs")) setTimeoutDraft(null);
      setWriteState({ pending: false, error: "", retry: false });
    }
    rowPending.current = false;
  };
  const saveTimeout = () => {
    if (timeoutDraft === null || rowPending.current) return;
    const seconds = Number(timeoutDraft);
    if (timeoutDraft.trim() === "" || !Number.isSafeInteger(seconds) || seconds < 0 || !Number.isSafeInteger(seconds * 1000)) {
      setWriteState({ pending: false, error: translate("Enter a whole number of seconds, zero or greater."), retry: false });
      return;
    }
    savePatch({ timeoutMs: seconds * 1000 });
  };
  const current = strategy.fallbackStrategy || "fallback";
  const judge = strategy.judgeModel || "";
  const isFusion = current === "fusion";
  const derivedCaps = aggregateComboCapabilities(combo.models, comboByName);
  const comboCaps = overlayComboCapabilities(derivedCaps, combo.capabilities);

  return (
    <Card className={`group ${v5 ? "v5-combo-row " : ""}${selected ? "ring-1 ring-dd-accent/40 bg-dd-accent-soft/30" : ""}`}>
      <div className={v5 ? "v5-combo-row-body" : "flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"}>
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <Checkbox
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select ${combo.name}`}
            className="shrink-0 pt-1 sm:pt-0"
          />
          <div className="flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-accent">layers</span>
          </div>
          <div className="min-w-0 flex-1">
            <code className="block truncate font-mono text-sm font-medium text-dd-text">{combo.name}</code>
            {prunedMembers.length > 0 && (
              <Badge tone="warning" size="sm" icon="warning" className="mt-1" title={`No longer listed by the provider: ${prunedMembers.join(", ")}`}>
                {prunedMembers.length === 1 ? "1 model no longer listed" : `${prunedMembers.length} models no longer listed`}
              </Badge>
            )}
            {v5 ? <ModelSummary models={combo.models} getCaps={getCaps} comboByName={comboByName} /> : <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {combo.models.length === 0 ? (
                <span className="text-xs italic text-dd-subtle">No models</span>
              ) : (
                combo.models.slice(0, 3).map((model, index) => (
                  <code key={index} className="inline-flex items-center gap-1 rounded bg-dd-surface-2 px-1.5 py-0.5 font-mono text-xs text-dd-muted">
                    <span>{model}</span>
                    <CapacityBadges caps={
                      comboByName[model]
                        ? overlayComboCapabilities(aggregateComboCapabilities(comboByName[model].models, comboByName), comboByName[model].capabilities)
                        : getCaps?.(model)
                    } />
                  </code>
                ))
              )}
              {combo.models.length > 3 && (
                <span className="text-[10px] text-dd-subtle">+{combo.models.length - 3} more</span>
              )}
            </div>}
            {comboCaps && (
              <div className="mt-1 flex items-center gap-2 text-[10px] text-dd-subtle dd-tnum">
                <span>ctx {fmtK(comboCaps.contextWindow)}</span>
                <span>max {fmtK(comboCaps.maxOutput)}</span>
              </div>
            )}
            {/* Fusion: judge picker (Auto = first model) */}
            {isFusion && (
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-dd-muted">{translate("Judge")}</span>
                <button
                  type="button"
                  aria-label="Pick the model that fuses panel answers"
                  onClick={() => setShowJudgeSelect(true)}
                  className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-dd border border-dashed border-dd-accent/40 px-2 py-1 font-mono text-[11px] text-dd-accent outline-none transition-colors hover:border-dd-accent hover:bg-dd-accent-soft focus-visible:shadow-dd-focus"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">gavel</span>
                  <span className="truncate">{judge || `${translate("Auto")} — ${combo.models[0] || translate("first model")}`}</span>
                </button>
                {judge && (
                  <IconButton
                    icon="close"
                    label="Reset judge to Auto"
                    size="sm"
                    onClick={() => onSetStrategy({ judgeModel: "" })}
                    className="text-dd-muted hover:bg-dd-danger/10 hover:text-dd-danger"
                  />
                )}
              </div>
            )}
            {allowListEditor}
          </div>
        </div>

        {/* Actions */}
        <div className={v5 ? "v5-combo-actions" : "flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0"}>
          {/* Strategy selector — always visible */}
          <div className="w-full sm:w-[200px]">
            <Select
              aria-label={`Strategy for ${combo.name}`}
              options={getStrategyOptions()}
              value={current}
              disabled={v5 && writeState.pending}
              onChange={(value) => v5 ? savePatch({ fallbackStrategy: value }) : onSetStrategy({ fallbackStrategy: value })}
              size="sm"
            />
          </div>

          {/* Per-model timeout (fallback / round-robin only; fusion has its own panel timeout) */}
          {current !== "fusion" && (
            <div className="flex items-center gap-1.5">
              <span className="whitespace-nowrap text-[10px] text-dd-muted">{translate("Timeout")}</span>
              <Input
                aria-label={v5 ? `Timeout for ${combo.name}` : undefined}
                type="number"
                min="0"
                step="1"
                size="sm"
                value={v5 ? (timeoutDraft ?? String((strategy.timeoutMs || 0) / 1000)) : (strategy.timeoutMs || 0) / 1000}
                disabled={v5 && writeState.pending}
                onBlur={v5 ? saveTimeout : undefined}
                onKeyDown={v5 ? (event) => { if (event.key === "Enter") { event.preventDefault(); saveTimeout(); } } : undefined}
                onChange={(e) => {
                  if (v5) { setTimeoutDraft(e.target.value); setWriteState({ pending: false, error: "", retry: false }); }
                  else { const sec = parseInt(e.target.value, 10) || 0; onSetStrategy({ timeoutMs: sec * 1000 }); }
                }}
                className="w-14 text-center dd-tnum [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="0"
                title={translate("Max seconds per model before fallback. 0 = use fetch connect timeout (60s)")}
              />
              <span className="text-[10px] text-dd-muted">s</span>
            </div>
          )}

          {v5 && writeState.pending && <span role="status" className="text-xs text-dd-muted">{translate("Saving…")}</span>}
          {v5 && writeState.error && <div role="alert" className="text-xs text-dd-danger">{writeState.error}{writeState.retry && <Button variant="ghost" size="sm" onClick={() => savePatch(retryPatch.current)}>{translate("Retry")}</Button>}</div>}
          <div className="flex flex-wrap items-center justify-end gap-1">
            <IconButton
              icon={copied === `combo-${combo.id}` ? "check" : "content_copy"}
              label="Copy combo name"
              size="sm"
              onClick={() => onCopy(combo.name, `combo-${combo.id}`)}
              className="text-dd-muted hover:bg-dd-surface-2 hover:text-dd-accent"
            />
            <IconButton
              icon="edit"
              label="Edit"
              size="sm"
              onClick={onEdit}
              className="text-dd-muted hover:bg-dd-surface-2 hover:text-dd-accent"
            />
            <IconButton
              icon="delete"
              label="Delete"
              size="sm"
              onClick={onDelete}
              className="text-dd-danger hover:bg-dd-danger/10"
            />
          </div>
        </div>
      </div>

      {/* Judge model picker (single-select; combo members make natural judges too) */}
      <ModelSelectModal
        isOpen={showJudgeSelect}
        onClose={() => setShowJudgeSelect(false)}
        onSelect={(m) => { onSetStrategy({ judgeModel: m?.value || "" }); setShowJudgeSelect(false); }}
        activeProviders={activeProviders}
        title={translate("Select Judge Model")}
        addedModelValues={judge ? [judge] : []}
        closeOnSelect={true}
      />
    </Card>
  );
}
