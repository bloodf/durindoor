"use client";

import { useEffect, useId, useState } from "react";
import Modal from "@/shared/ui/components/Modal.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";
import ModelSelectModal from "./ModelSelectModal";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;
const CAPABILITY_KEYS = ["vision", "pdf", "audioInput", "videoInput", "imageOutput", "audioOutput", "search", "tools", "reasoning"];

function ModelItem({ index, model, isFirst, isLast, onEdit, onMoveUp, onMoveDown, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);

  useEffect(() => setDraft(model), [model]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed);
    else setDraft(model);
    setEditing(false);
  };
  const handleKeyDown = (event) => {
    if (event.key === "Enter") commit();
    if (event.key === "Escape") {
      setDraft(model);
      setEditing(false);
    }
  };

  return (
    <li className="group flex min-w-0 items-center gap-2 rounded-dd border border-dd-border-subtle bg-dd-surface-2 px-2 py-1.5 text-[13px] transition-colors hover:border-dd-border">
      <span className="w-5 shrink-0 text-center text-xs text-dd-subtle dd-tnum" aria-label={`Priority ${index + 1}`}>{index + 1}</span>
      {editing ? (
        <Input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={handleKeyDown} aria-label={`Edit model ${index + 1}`} size="sm" className="min-w-0 flex-1 font-mono" />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="min-h-11 min-w-0 flex-1 truncate rounded-dd px-2 text-left font-mono text-xs text-dd-text outline-none hover:bg-dd-surface-3 focus-visible:shadow-dd-focus" title="Click to edit">
          {model}
        </button>
      )}
      <div className="flex shrink-0 items-center">
        <IconButton icon="arrow_upward" label={`Move ${model} up`} size="sm" onClick={onMoveUp} disabled={isFirst} />
        <IconButton icon="arrow_downward" label={`Move ${model} down`} size="sm" onClick={onMoveDown} disabled={isLast} />
        <IconButton icon="close" label={`Remove ${model}`} size="sm" onClick={onRemove} />
      </div>
    </li>
  );
}

// Reusable Combo create/edit modal. forcePrefix auto-prepends to name.
export default function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders, kindFilter = null, forcePrefix = "", title }) {
  const initialName = combo?.name
    ? (forcePrefix && combo.name.startsWith(forcePrefix) ? combo.name.slice(forcePrefix.length) : combo.name)
    : "";
  const [name, setName] = useState(initialName);
  const [models, setModels] = useState(combo?.models || []);
  const [capabilities, setCapabilities] = useState(combo?.capabilities || {});
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState({});
  const comboNameId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const nextName = combo?.name ? (forcePrefix && combo.name.startsWith(forcePrefix) ? combo.name.slice(forcePrefix.length) : combo.name) : "";
    setName(nextName);
    setModels(combo?.models || []);
    setCapabilities(combo?.capabilities || {});
    setNameError("");
    fetch("/api/models/alias").then((response) => response.ok ? response.json() : null).then((data) => data && setModelAliases(data.aliases || {})).catch(() => {});
  }, [isOpen, combo, forcePrefix]);

  const validateName = (value) => {
    if (!value.trim()) { setNameError("Name is required"); return false; }
    if (!VALID_NAME_REGEX.test(forcePrefix + value)) { setNameError("Only letters, numbers, -, _ and . allowed"); return false; }
    setNameError("");
    return true;
  };
  const handleNameChange = (event) => {
    let value = event.target.value;
    if (forcePrefix && value.startsWith(forcePrefix)) value = value.slice(forcePrefix.length);
    setName(value);
    if (value) validateName(value); else setNameError("");
  };
  const handleAddModel = (model) => {
    if (!models.includes(model.value)) setModels([...models, model.value]);
  };
  const handleDeselectModel = (model) => setModels(models.filter((item) => item !== model.value));
  const handleRemoveModel = (index) => setModels(models.filter((_, itemIndex) => itemIndex !== index));
  const handleMoveUp = (index) => {
    if (index === 0) return;
    const next = [...models]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; setModels(next);
  };
  const handleMoveDown = (index) => {
    if (index === models.length - 1) return;
    const next = [...models]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; setModels(next);
  };
  const handleSave = async () => {
    if (!validateName(name)) return;
    setSaving(true);
    await onSave({ name: forcePrefix + name.trim(), models, capabilities });
    setSaving(false);
  };
  const isEdit = !!combo;

  return (
    <>
      <Modal open={isOpen} onClose={onClose} title={title || (isEdit ? "Edit Combo" : "Create Combo")} size="md" footer={
        <>
          <Button onClick={onClose} variant="ghost" disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} variant="primary" loading={saving} disabled={!name.trim() || !!nameError}>{isEdit ? "Save" : "Create"}</Button>
        </>
      }>
        <div className="flex flex-col gap-5">
          {forcePrefix ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={comboNameId} className="text-xs font-medium text-dd-muted">Combo name</label>
              <div className="flex min-w-0">
                <span className="flex min-h-11 items-center rounded-s-dd border border-e-0 border-dd-border bg-dd-surface-2 px-3 font-mono text-[13px] text-dd-muted" aria-hidden="true">{forcePrefix}</span>
                <Input id={comboNameId} value={name} onChange={handleNameChange} placeholder="my-combo" error={nameError} className="min-w-0 flex-1 rounded-s-none font-mono" />
              </div>
              <p className="text-xs text-dd-subtle">Auto-prefixed with “{forcePrefix}”. Only letters, numbers, -, _ and . allowed.</p>
            </div>
          ) : <Input label="Combo name" value={name} onChange={handleNameChange} placeholder="my-combo" error={nameError} hint="Only letters, numbers, -, _ and . allowed." />}

          <section aria-labelledby="combo-models-heading" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3"><h3 id="combo-models-heading" className="text-sm font-semibold text-dd-text">Models</h3><span className="text-xs text-dd-muted dd-tnum">{models.length} selected</span></div>
            {models.length === 0 ? <div className="rounded-dd-lg border border-dashed border-dd-border bg-dd-surface-2 px-4 py-6 text-center"><span aria-hidden="true" className="material-symbols-outlined text-[24px] leading-none text-dd-muted">layers</span><p className="mt-2 text-xs text-dd-muted">No models added yet</p></div> : <ol className="flex max-h-[350px] min-w-0 flex-col gap-1 overflow-y-auto">{models.map((model, index) => <ModelItem key={`${model}-${index}`} index={index} model={model} isFirst={index === 0} isLast={index === models.length - 1} onEdit={(value) => setModels(models.map((item, itemIndex) => itemIndex === index ? value : item))} onMoveUp={() => handleMoveUp(index)} onMoveDown={() => handleMoveDown(index)} onRemove={() => handleRemoveModel(index)} />)}</ol>}
            <Button variant="secondary" icon="add" onClick={() => setShowModelSelect(true)} className="w-full">Add model</Button>
          </section>

          <fieldset className="rounded-dd-lg border border-dd-border p-4"><legend className="px-1 text-sm font-semibold text-dd-text">Capability ceiling</legend><p className="mb-3 text-xs text-dd-muted">Optional. Disable derived features or lower derived limits; blank fields preserve member-derived capabilities.</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{CAPABILITY_KEYS.map((key) => <Checkbox key={key} checked={capabilities[key] === false} onChange={(checked) => setCapabilities((current) => { const next = { ...current }; if (checked) next[key] = false; else delete next[key]; return next; })} label={`Disable ${key}`} />)}</div><div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"><Input label="Context window" type="number" min="1" value={capabilities.contextWindow ?? ""} onChange={(event) => setCapabilities((current) => ({ ...current, contextWindow: event.target.value === "" ? undefined : Number(event.target.value) }))} /><Input label="Max output" type="number" min="1" value={capabilities.maxOutput ?? ""} onChange={(event) => setCapabilities((current) => ({ ...current, maxOutput: event.target.value === "" ? undefined : Number(event.target.value) }))} /></div></fieldset>
        </div>
      </Modal>
      <ModelSelectModal isOpen={showModelSelect} onClose={() => setShowModelSelect(false)} onSelect={handleAddModel} onDeselect={handleDeselectModel} activeProviders={activeProviders} modelAliases={modelAliases} title="Add Model to Combo" kindFilter={kindFilter} addedModelValues={models} closeOnSelect={false} />
    </>
  );
}
