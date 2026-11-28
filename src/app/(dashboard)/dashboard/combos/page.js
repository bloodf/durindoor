"use client";
import { getStrategyOptions } from "./ComboCard";
import useSettingsStore from "@/store/settingsStore";
import { useState, useEffect, useEffectEvent, useRef } from "react";
import { CardSkeleton } from "@/shared/components";
import Button from "@/shared/ui/components/Button.jsx";
import { Card } from "@/shared/ui/components/Card.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import DocsLink from "@/shared/components/DocsLink";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { filterActiveConnections } from "@/shared/utils/connectionStatus";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { updateComboStrategy } from "@/shared/utils/comboStrategy";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { translate } from "@/i18n/runtime";
import ConnectionGroupsPanel from "./ConnectionGroupsPanel.jsx";
import ComboAllowListEditor from "./ComboAllowListEditor.jsx";
import ComboUsageReport from "./components/ComboUsageReport";
import ComboFormModal from "./components/ComboFormModal.jsx";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import "@/shared/ui/v5/combos/combos.css";
import { createSettingsQueue } from "../providers/workflowRequests.js";
import ComboCard from "./ComboCard.jsx";
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
  const [globalComboStrategy, setGlobalComboStrategy] = useState("fallback");
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
      setGlobalComboStrategy(settingsData.comboStrategy || "fallback");
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
    for (const name of names) updated[name] = null;
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
  // An explicit fallback overrides the global strategy; only Inherit clears it.
  const handleSetComboStrategy = async (comboName, patch) => {
    try {
      await persistComboStrategies((current) => updateComboStrategy(current, comboName, patch));
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
      await persistComboStrategies((current) => selectedCombos.reduce(
        (updated, combo) => updateComboStrategy(updated, combo.name, { fallbackStrategy: strategy }),
        current
      ));
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
                    options={getStrategyOptions(globalComboStrategy)}
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
                  globalComboStrategy={globalComboStrategy}
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
