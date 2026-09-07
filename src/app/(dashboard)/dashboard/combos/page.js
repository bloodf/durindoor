"use client";

import { useState, useEffect } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { ModelSelectModal, CapacityBadges, CardSkeleton } from "@/shared/components";
import Button from "@/shared/ui/components/Button.jsx";
import { Card } from "@/shared/ui/components/Card.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
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

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

export default function CombosPage() {
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [providerConnections, setProviderConnections] = useState([]);
  const [comboStrategies, setComboStrategies] = useState({});
  const [confirmState, setConfirmState] = useState(null);
  const [groups, setGroups] = useState([]);
  // Connection groups (issue #747): allow-list options come from the same
  // active-providers fetch; groups themselves load in ConnectionGroupsPanel.
  const { getCaps } = useModelCaps();
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fetchData = async () => {
    setLoadError("");
    try {
      const [combosRes, providersRes, settingsRes, groupsRes] = await Promise.all([
        fetch("/api/combos"),
        fetch("/api/providers"),
        fetch("/api/settings"),
        fetch("/api/connection-groups"),
      ]);
      const combosData = await combosRes.json();
      const providersData = await providersRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const groupsData = groupsRes.ok ? await groupsRes.json() : {};

      if (!combosRes.ok) throw new Error(combosData?.error || "Failed to load combos");
      // Show every non-media combo here (llm, embedding, tts, ...); media/web
      // combos belong to media-providers/web (#2686).
      setCombos((combosData.combos || []).filter(c => !MEDIA_PROVIDER_KINDS.some(({ id }) => id === c.kind)));
      if (providersRes.ok) {
        const connections = providersData.connections || [];
        setProviderConnections(connections);
        setActiveProviders(filterActiveConnections(connections));
      }
      if (groupsRes.ok) setGroups(groupsData.groups || []);
      setComboStrategies(settingsData.comboStrategies || {});
    } catch (error) {
      console.log("Error fetching data:", error);
      setLoadError(error.message || "Failed to load combos");
    } finally {
      setLoading(false);
    }
  };

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

  const handleDelete = async (id) => {
    setConfirmState({
      title: "Delete Combo",
      message: "Delete this combo?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
          if (res.ok) {
            setCombos(combos.filter(c => c.id !== id));
          }
        } catch (error) {
          console.log("Error deleting combo:", error);
        }
      }
    });
  };

  // Merge a per-combo strategy patch into settings.comboStrategies. Passing an empty
  // patch (strategy back to default "fallback") drops the entry entirely.
  const handleSetComboStrategy = async (comboName, patch) => {
    try {
      const updated = { ...comboStrategies };
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

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategies: updated }),
      });

      setComboStrategies(updated);
    } catch (error) {
      console.log("Error updating combo strategy:", error);
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
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <PageHeader
        icon="layers"
        title={translate("Combos")}
        subtitle={translate("Group models under one name, then pick a strategy per combo.")}
        actions={
          <Button
            variant="primary"
            icon="add"
            onClick={() => setShowCreateModal(true)}
            className="w-full sm:w-auto whitespace-nowrap"
          >
            {translate("Create Combo")}
          </Button>
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
      <Card>
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-dd-text">
            {translate("Strategy options")}
          </p>
          <ul className="flex flex-col gap-1 text-[13px] text-dd-muted">
            <li>
              <span className="font-medium text-dd-text">Fallback</span>
              {translate(" — tries models in order (next on failure)")}
            </li>
            <li>
              <span className="font-medium text-dd-text">Round Robin</span>
              {translate(" — rotates models across requests to spread load")}
            </li>
            <li>
              <span className="font-medium text-dd-text">Fusion</span>
              {translate(" — queries all models in parallel, then a judge synthesizes one answer. Best quality, but costs the most: every request bills all panel models + the judge (N+1 calls)")}
            </li>
            <li>
              <span className="font-medium text-dd-text">Smart Scoring</span>
              {" — tracks provider health (quota, ban status) and prefers models with the best score; still falls back on errors"}
            </li>
            <li>
              <span className="font-medium text-dd-text">Capacity auto-switch</span>
              {translate(" — sends image/PDF/audio requests to a model that supports them first")}
            </li>
          </ul>
        </div>
      </Card>
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
                getCaps={getCaps}
                comboByName={comboByName}
                activeProviders={activeProviders}
                copied={copied}
                onCopy={copy}
                onEdit={() => setEditingCombo(combo)}
                onDelete={() => handleDelete(combo.id)}
                strategy={comboStrategies[combo.name] || {}}
                onSetStrategy={(patch) => handleSetComboStrategy(combo.name, patch)}
                allowListEditor={
                  <ComboAllowListEditor
                    allowedConnectionIds={combo.allowedConnectionIds || []}
                    connections={providerConnections}
                    groups={groups}
                    onChange={async (allowedConnectionIds) => {
                      await handleUpdate(combo.id, { allowedConnectionIds });
                    }}
                  />
                }
              />
            ));
          })()}
        </div>
      )}

      <ConnectionGroupsPanel connections={providerConnections} onGroupsChange={setGroups} />

      {/* Create Modal - Use key to force remount and reset state */}
      <ComboFormModal
        key="create"
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreate}
        activeProviders={activeProviders}
      />

      {/* Edit Modal - Use key to force remount and reset state */}
      <ComboFormModal
        key={editingCombo?.id || "new"}
        isOpen={!!editingCombo}
        combo={editingCombo}
        onClose={() => setEditingCombo(null)}
        onSave={(data) => handleUpdate(editingCombo.id, data)}
        activeProviders={activeProviders}
      />
      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        confirmLabel="Confirm"
        tone="danger"
        onCancel={() => setConfirmState(null)}
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
    { value: "fusion", label: translate("Fusion — panel + judge") },
  ];
}

function ComboCard({ combo, getCaps, comboByName = {}, activeProviders = [], copied, onCopy, onEdit, onDelete, strategy = {}, onSetStrategy, allowListEditor }) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const current = strategy.fallbackStrategy || "fallback";
  const judge = strategy.judgeModel || "";
  const isFusion = current === "fusion";
  const derivedCaps = aggregateComboCapabilities(combo.models, comboByName);
  const comboCaps = overlayComboCapabilities(derivedCaps, combo.capabilities);

  return (
    <Card className="group">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-accent">layers</span>
          </div>
          <div className="min-w-0 flex-1">
            <code className="block truncate font-mono text-sm font-medium text-dd-text">{combo.name}</code>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
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
            </div>
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
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          {/* Strategy selector — always visible */}
          <div className="w-full sm:w-[200px]">
            <Select
              aria-label={`Strategy for ${combo.name}`}
              options={getStrategyOptions()}
              value={current}
              onChange={(value) => onSetStrategy({ fallbackStrategy: value })}
              size="sm"
            />
          </div>

          {/* Per-model timeout (fallback / round-robin only; fusion has its own panel timeout) */}
          {current !== "fusion" && (
            <div className="flex items-center gap-1.5">
              <span className="whitespace-nowrap text-[10px] text-dd-muted">{translate("Timeout")}</span>
              <Input
                type="number"
                min="0"
                step="1"
                size="sm"
                value={(strategy.timeoutMs || 0) / 1000}
                onChange={(e) => {
                  const sec = parseInt(e.target.value, 10) || 0;
                  onSetStrategy({ timeoutMs: sec * 1000 });
                }}
                className="w-14 text-center dd-tnum [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="0"
                title={translate("Max seconds per model before fallback. 0 = use fetch connect timeout (60s)")}
              />
              <span className="text-[10px] text-dd-muted">s</span>
            </div>
          )}

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

function ModelItem({ id, index, model, weight = 1, isFirst, isLast, onEdit, onWeightChange, onMoveUp, onMoveDown, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    // no transition — prevents the CSS settle animation fighting React's re-render on drop
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : undefined,
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);
  useEffect(() => {
    if (!editing) setDraft(model);
  }, [model, editing]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed);
    else setDraft(model);
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") { setDraft(model); setEditing(false); }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex min-w-0 flex-wrap items-center gap-1.5 rounded-dd bg-dd-surface-2 px-2 py-1 transition-colors sm:flex-nowrap ${isDragging ? "shadow-dd-elevated ring-1 ring-dd-accent/30" : ""}`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label={`Drag to reorder ${model || `model ${index + 1}`}`}
        className="flex min-h-11 min-w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-dd text-dd-muted outline-none transition-colors hover:text-dd-accent focus-visible:shadow-dd-focus active:cursor-grabbing"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="4" r="2"/><circle cx="15" cy="4" r="2"/>
          <circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/>
          <circle cx="9" cy="20" r="2"/><circle cx="15" cy="20" r="2"/>
        </svg>
      </button>
      {/* Index badge */}
      <span className="w-3 shrink-0 text-center text-[10px] font-medium text-dd-muted dd-tnum">{index + 1}</span>

      {/* Inline editable model value */}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 rounded-dd border border-dd-accent/40 bg-dd-surface px-1.5 py-0.5 font-mono text-xs text-dd-text outline-none focus:shadow-dd-focus"
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          className="min-w-0 flex-1 cursor-text truncate rounded-dd px-1.5 py-0.5 font-mono text-xs text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"
          onClick={() => setEditing(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(true); } }}
          title="Click to edit"
        >
          {model}
        </div>
      )}

      <div className="w-16 shrink-0">
        <Input
          aria-label="Weight"
          size="sm"
          type="number"
          min="0.01"
          step="0.01"
          value={weight}
          onChange={(event) => onWeightChange(event.target.value)}
          className="px-1.5 text-center dd-tnum"
          title="Positive finite selection weight for Weighted strategy"
        />
      </div>

      {/* Priority arrows */}
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          icon="arrow_upward"
          label="Move up"
          size="sm"
          onClick={onMoveUp}
          disabled={isFirst}
        />
        <IconButton
          icon="arrow_downward"
          label="Move down"
          size="sm"
          onClick={onMoveDown}
          disabled={isLast}
        />
      </div>

      {/* Remove */}
      <IconButton
        icon="close"
        label="Remove"
        size="sm"
        onClick={onRemove}
        className="text-dd-muted hover:bg-dd-danger/10 hover:text-dd-danger"
      />
    </div>
  );
}

function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders, kindFilter = null }) {
  // Initialize state with combo values - key prop on parent handles reset on remount
  const [name, setName] = useState(combo?.name || "");
  const [models, setModels] = useState(combo?.models || []);
  const [weights, setWeights] = useState(() => Object.fromEntries((combo?.members || []).map((member) => [member.id, member.weight])));
  const [modelError, setModelError] = useState("");
  const [capabilities, setCapabilities] = useState(combo?.capabilities || {});
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Use stable index-based IDs so duplicates and similar names are handled correctly
  const modelItems = models.map((model, i) => ({ uid: `item-${i}`, model }));

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = modelItems.findIndex((m) => m.uid === active.id);
      const newIndex = modelItems.findIndex((m) => m.uid === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setModels((prev) => arrayMove(prev, oldIndex, newIndex));
      }
    }
  };

  const fetchModalData = async () => {
    try {
      const aliasesRes = await fetch("/api/models/alias");
      if (!aliasesRes.ok) return;
      const aliasesData = await aliasesRes.json();
      setModelAliases(aliasesData.aliases || {});
    } catch (error) {
      console.error("Error fetching modal data:", error);
    }
  };
  useEffect(() => {
    if (!isOpen) return;
    setName(combo?.name || "");
    setModels(combo?.models || []);
    setCapabilities(combo?.capabilities || {});
    setNameError("");
    setSaveError("");
    fetchModalData();
  }, [isOpen, combo]);

  const validateName = (value) => {
    if (!value.trim()) {
      setNameError("Name is required");
      return false;
    }
    if (!VALID_NAME_REGEX.test(value)) {
      setNameError("Only letters, numbers, -, _ and . allowed");
      return false;
    }
    setNameError("");
    return true;
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setName(value);
    if (value) validateName(value);
    else setNameError("");
  };

  const handleAddModel = (model) => {
    if (!models.includes(model.value)) {
      setModels([...models, model.value]);
    }
  };

  const handleDeselectModel = (model) => {
    setModels(models.filter((m) => m !== model.value));
  };

  const handleRemoveModel = (index) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newModels = [...models];
    [newModels[index - 1], newModels[index]] = [newModels[index], newModels[index - 1]];
    setModels(newModels);
  };

  const handleMoveDown = (index) => {
    if (index === models.length - 1) return;
    const newModels = [...models];
    [newModels[index], newModels[index + 1]] = [newModels[index + 1], newModels[index]];
    setModels(newModels);
  };
  const handleWeightChange = (model, value) => {
    const weight = Number(value);
    setWeights((current) => ({ ...current, [model]: Number.isFinite(weight) && weight > 0 ? weight : value }));
  };
  const handleEditModel = (index, newModel) => {
    if (models.some((model, modelIndex) => modelIndex !== index && model === newModel)) {
      setModelError("A combo cannot contain the same model twice");
      return;
    }
    const oldModel = models[index];
    setModelError("");
    setModels((current) => current.map((model, modelIndex) => modelIndex === index ? newModel : model));
    setWeights((current) => {
      const next = { ...current, [newModel]: current[oldModel] ?? 1 };
      delete next[oldModel];
      return next;
    });
  };
  const handleSave = async () => {
    if (!validateName(name)) return;
    const members = models.map((id) => ({ id, weight: Number(weights[id] ?? 1) }));
    if (members.some((member) => !Number.isFinite(member.weight) || member.weight <= 0)) return;
    setSaveError("");
    setSaving(true);
    try {
      const result = await onSave({ name: name.trim(), models, members, capabilities });
      if (!result?.ok) setSaveError(result?.error || "Failed to save combo");
    } finally {
      setSaving(false);
    }
  };

  const isEdit = !!combo;

  return (
    <>
      <Modal
        open={isOpen}
        onClose={onClose}
        title={isEdit ? "Edit Combo" : "Create Combo"}
        size="lg"
        pending={saving}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Combo Name"
            value={name}
            onChange={handleNameChange}
            placeholder="my-combo"
            error={nameError}
            hint="Only letters, numbers, -, _ and . allowed"
          />
          {saveError ? <p role="alert" className="text-xs text-dd-danger">{saveError}</p> : null}

          <section aria-labelledby="combo-models-heading">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h2 id="combo-models-heading" className="text-sm font-medium text-dd-text">Models</h2>
              <span className="text-xs text-dd-muted dd-tnum">{models.length}</span>
            </div>

            {models.length === 0 ? (
              <div className="rounded-dd-lg border border-dashed border-dd-border bg-dd-surface-2 px-4 py-5 text-center">
                <span aria-hidden="true" className="material-symbols-outlined mb-1 text-xl text-dd-muted">layers</span>
                <p className="text-xs text-dd-muted">No models added yet</p>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
                <SortableContext items={modelItems.map((m) => m.uid)} strategy={verticalListSortingStrategy}>
                  <div tabIndex={0} aria-label="Combo models" className="flex max-h-[55vh] min-w-0 flex-col gap-1 overflow-y-auto sm:max-h-[350px]" role="region">
                    {modelItems.map(({ uid, model }, index) => (
                      <ModelItem
                        key={uid}
                        id={uid}
                        index={index}
                        model={model}
                        weight={weights[model] ?? 1}
                        isFirst={index === 0}
                        isLast={index === modelItems.length - 1}
                        onEdit={(newVal) => handleEditModel(index, newVal)}
                        onWeightChange={(value) => handleWeightChange(model, value)}
                        onMoveUp={() => handleMoveUp(index)}
                        onMoveDown={() => handleMoveDown(index)}
                        onRemove={() => handleRemoveModel(index)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
            {modelError && <p role="alert" className="mt-1 text-xs text-dd-danger">{modelError}</p>}

            <Button variant="secondary" size="sm" icon="add" onClick={() => setShowModelSelect(true)} className="mt-2 w-full border-dashed">
              Add Model
            </Button>
          </section>
          <fieldset className="rounded-dd-lg border border-dd-border bg-dd-surface-2 p-3">
            <legend className="px-1 text-sm font-medium text-dd-text">Capability ceiling</legend>
            <p className="mb-2 text-[10px] text-dd-muted">Optional. Only disables derived features or lowers derived limits; blank fields preserve member-derived capabilities.</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {["vision", "pdf", "audioInput", "videoInput", "imageOutput", "audioOutput", "search", "tools", "reasoning"].map((key) => (
                <Checkbox
                  key={key}
                  checked={capabilities[key] === false}
                  onChange={(checked) => setCapabilities((current) => {
                    const next = { ...current };
                    if (checked) next[key] = false; else delete next[key];
                    return next;
                  })}
                  label={`Disable ${key}`}
                  aria-label={`Disable ${key}`}
                />
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input label="Context window" type="number" min="1" value={capabilities.contextWindow ?? ""} onChange={(event) => setCapabilities((current) => ({ ...current, contextWindow: event.target.value === "" ? undefined : Number(event.target.value) }))} />
              <Input label="Max output" type="number" min="1" value={capabilities.maxOutput ?? ""} onChange={(event) => setCapabilities((current) => ({ ...current, maxOutput: event.target.value === "" ? undefined : Number(event.target.value) }))} />
            </div>
          </fieldset>

          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button onClick={onClose} variant="ghost" size="sm">
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              size="sm"
              loading={saving}
              disabled={!name.trim() || !!nameError}
            >
              {isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Model Select Modal */}
      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={handleAddModel}
        onDeselect={handleDeselectModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Add Model to Combo"
        kindFilter={kindFilter}
        addedModelValues={models}
        closeOnSelect={false}
      />
    </>
  );
}