"use client";

import { useEffect, useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { ModelSelectModal } from "@/shared/components";
import Button from "@/shared/ui/components/Button.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { sortComboModels } from "@/lib/combos/comboSort.js";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

function ModelItem({ id, index, model, weight = 1, requirePositiveWeight = false, isFirst, isLast, onEdit, onWeightChange, onMoveUp, onMoveDown, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    // no transition — prevents the CSS settle animation fighting React's re-render on drop
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : undefined,
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);
  const startEditing = () => {
    setDraft(model);
    setEditing(true);
  };
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
      className={`group flex min-w-0 flex-wrap items-center gap-1.5 rounded-dd bg-dd-surface-2 py-1 transition-colors sm:flex-nowrap ${isDragging ? "shadow-dd-elevated ring-1 ring-dd-accent/30" : ""}`}
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
          aria-label={`Model ${index + 1}`}
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
          className="flex min-h-11 min-w-0 flex-1 cursor-text items-center truncate rounded-dd px-1.5 py-0.5 font-mono text-xs text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"
          onClick={startEditing}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startEditing(); } }}
          title="Click to edit"
        >
          {model}
        </div>
      )}

      <div className="w-16 shrink-0">
        <Field error={weight === "" || !Number.isFinite(Number(weight)) || Number(weight) < 0 || (requirePositiveWeight && Number(weight) === 0) ? "Use a positive weight" : undefined}>
          <Input
            aria-label="Weight"
            size="sm"
            type="number"
            min="0"
            step="0.01"
            value={weight}
            onChange={(event) => onWeightChange(event.target.value)}
            className="px-1.5 text-center dd-tnum"
            title="Selection weight; zero is fallback-only for round robin"
          />
        </Field>
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

export default function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders, kindFilter = null }) {
  // Initialize state with combo values - key prop on parent handles reset on remount
  const [name, setName] = useState(combo?.name || "");
  const [noLog, setNoLog] = useState(combo?.noLog === true);
  const [models, setModels] = useState(combo?.models || []);
  const [weights, setWeights] = useState(() => Object.fromEntries((combo?.members || []).map((member) => [member.id, member.weight])));
  const [modelError, setModelError] = useState("");
  const [capabilities, setCapabilities] = useState(combo?.capabilities || {});
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState({});
  // OmniRoute #11812 (port(omniroute)): one-shot member reorder, not a
  // persisted live mode — picking a method sorts `models` immediately and
  // saves through the existing field.
  const [sortMethod, setSortMethod] = useState("manual");
  const handleSortMethodChange = (method) => {
    setSortMethod(method);
    setModels((current) => sortComboModels(current, method));
  };

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

  // Each mounted form is one open session; late metadata cannot update another session.
  useEffect(() => {
    let active = true;
    const fetchModalData = async () => {
      try {
        const aliasesRes = await fetch("/api/models/alias");
        if (!aliasesRes.ok) return;
        const aliasesData = await aliasesRes.json();
        if (active) setModelAliases(aliasesData.aliases || {});
      } catch (error) {
        console.error("Error fetching modal data:", error);
      }
    };
    fetchModalData();
    return () => { active = false; };
  }, []);

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
      setModels((current) => sortComboModels([...current, model.value], sortMethod));
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
    setWeights((current) => ({ ...current, [model]: value !== "" && Number.isFinite(weight) && weight >= 0 ? weight : value }));
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
    if (invalidWeights) return;
    setSaveError("");
    setSaving(true);
    try {
      // Omit the default unless an existing disabled log must be re-enabled.
      const data = { name: name.trim(), models, members, capabilities };
      if (noLog || combo?.noLog === true) data.noLog = noLog;
      const result = await onSave(data);
      if (!result?.ok) setSaveError(result?.error || "Failed to save combo");
    } finally {
      setSaving(false);
    }
  };

  const isEdit = !!combo;
  // Keep invalid weight drafts editable, explain the blocked save, and retain
  // the same input node/focus as feedback appears (matching the V5 review form).
  const invalidWeights = models.some((id) => weights[id] === "" || !Number.isFinite(Number(weights[id] ?? 1)) || Number(weights[id] ?? 1) < 0) || (models.length > 0 && !models.some((id) => Number(weights[id] ?? 1) > 0));

  // Layout contract (mirrors KeysPageClient and shared/components/ComboFormModal):
  // Cancel/Save live in the Modal `footer` slot so the primitive owns padding,
  // the divider and 44px targets; the body must not render its own button row.
  // The capability ceiling is a bordered `rounded-dd-lg p-4` fieldset.
  // Covered by tests/unit/combos-modal-spacing.test.js.
  return (
    <>
      <Modal
        open={isOpen}
        onClose={onClose}
        title={isEdit ? "Edit Combo" : "Create Combo"}
        size="lg"
        pending={saving}
        footer={
          <>
            {models.length > 0 && !models.some((id) => Number(weights[id] ?? 1) > 0) && <p role="alert">At least one member must have a positive weight.</p>}
            <Button onClick={onClose} variant="ghost" disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              disabled={!name.trim() || !!nameError || invalidWeights}
            >
              {isEdit ? "Save" : "Create"}
            </Button>
          </>
        }
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
          <label className="flex items-center gap-2 text-sm text-dd-text">
            <input type="checkbox" checked={!noLog} onChange={(event) => setNoLog(!event.target.checked)} />
            Logging
          </label>
          <p className="text-xs text-dd-subtle">When off, request and response content is not saved in request details. Usage metadata is retained.</p>
          {saveError ? <p role="alert" className="text-xs text-dd-danger">{saveError}</p> : null}

          <section aria-labelledby="combo-models-heading">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 id="combo-models-heading" className="text-sm font-medium text-dd-text">Models</h2>
              <div className="flex items-center gap-2">
                <Select
                  aria-label="Sort models"
                  value={sortMethod}
                  onChange={handleSortMethodChange}
                  options={[
                  { value: "manual", label: "Manual order" },
                  { value: "provider", label: "By provider" },
                  { value: "name", label: "By name" }]
                  }
                  size="sm"
                  fullWidth={false}
                  disabled={models.length < 2}
                />
                <span className="text-xs text-dd-muted dd-tnum">{models.length}</span>
              </div>
            </div>

            {models.length === 0 ? (
              <div className="px-4 py-5 text-center">
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
                        requirePositiveWeight={!models.some((id) => Number(weights[id] ?? 1) > 0)}
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
          <fieldset className="rounded-dd-lg border border-dd-border p-4">
            <legend className="px-1 text-sm font-semibold text-dd-text">Capability ceiling</legend>
            <p className="mb-3 text-xs text-dd-muted">Optional. Only disables derived features or lowers derived limits; blank fields preserve member-derived capabilities.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {["vision", "pdf", "audioInput", "videoInput", "imageOutput", "audioOutput", "videoOutput", "search", "tools", "reasoning"].map((key) => (
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
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Context window" type="number" min="1" value={capabilities.contextWindow ?? ""} onChange={(event) => setCapabilities((current) => ({ ...current, contextWindow: event.target.value === "" ? undefined : Number(event.target.value) }))} />
              <Input label="Max output" type="number" min="1" value={capabilities.maxOutput ?? ""} onChange={(event) => setCapabilities((current) => ({ ...current, maxOutput: event.target.value === "" ? undefined : Number(event.target.value) }))} />
            </div>
          </fieldset>
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
