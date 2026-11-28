"use client";


import { useState, useRef } from "react";
import { ModelSelectModal, CapacityBadges } from "@/shared/components";
import Button from "@/shared/ui/components/Button.jsx";
import { Card } from "@/shared/ui/components/Card.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { INHERIT_COMBO_STRATEGY } from "@/shared/utils/comboStrategy";
import { aggregateComboCapabilities, overlayComboCapabilities } from "open-sse/providers/capabilities.js";
import { translate } from "@/i18n/runtime";
import ModelSummary from "@/shared/ui/v5/combos/ModelSummary.jsx";
import "@/shared/ui/v5/combos/combos.css";


function getStrategyOptions(globalStrategy) {
  const options = [
    { value: "fallback", label: translate("Fallback — try in order") },
    { value: "round-robin", label: translate("Round Robin — rotate") },
    { value: "weighted", label: translate("Weighted — random by member weight") },
    { value: "smart-scoring", label: "Smart Scoring — best quota first" },
    { value: "smart", label: translate("Smart — complexity-aware routing") },
    { value: "fusion", label: translate("Fusion — panel + judge") },
  ];
  const globalLabel = options.find((option) => option.value === globalStrategy)?.label.split(" — ")[0];
  return [
    { value: INHERIT_COMBO_STRATEGY, label: `${translate("Inherit global")} (${globalLabel || globalStrategy})` },
    ...options,
  ];
}

export default function ComboCard({ combo, v5, getCaps, comboByName = {}, activeProviders = [], copied, onCopy, onEdit, onDelete, strategy = {}, globalComboStrategy = "fallback", onSetStrategy, allowListEditor, selected = false, onToggleSelect, prunedMembers = [] }) {
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
  const current = strategy.fallbackStrategy || INHERIT_COMBO_STRATEGY;
  const judge = strategy.judgeModel || "";
  const isFusion = (strategy.fallbackStrategy || globalComboStrategy) === "fusion";
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
              options={getStrategyOptions(globalComboStrategy)}
              value={current}
              disabled={v5 && writeState.pending}
              onChange={(value) => v5 ? savePatch({ fallbackStrategy: value }) : onSetStrategy({ fallbackStrategy: value })}
              size="sm"
            />
          </div>

          {/* Per-model timeout (fallback / round-robin only; fusion has its own panel timeout) */}
          {!isFusion && (
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
