"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { createLimiter, readCompareSelections, writeCompareSelections, MAX_COMPARE_COLUMNS, MAX_PARALLEL_COMPARE_RUNS, MIN_COMPARE_COLUMNS, streamCompletion } from "@/lib/playground/compare";
import { getConnectionOptions, getModelReasoningOptions } from "./playgroundHelpers";

const GRID_CLASSES = {
  2: "grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2",
  3: "grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3",
  4: "grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"
};

const STATUS_BADGE = {
  queued: { tone: "neutral", icon: "schedule", label: "Queued" },
  running: { tone: "accent", icon: "progress_activity", label: "Streaming" },
  done: { tone: "success", icon: "check", label: "Done" },
  error: { tone: "danger", icon: "error", label: "Error" },
  cancelled: { tone: "warning", icon: "stop", label: "Cancelled" }
};

let columnSeq = 0;
function newColumn(modelId = "") {
  columnSeq += 1;
  return { id: `col-${columnSeq}`, modelId, connectionId: "auto", status: "idle", text: "", error: "", latencyMs: null, ttftMs: null, usage: null };
}

function formatMs(value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : "—";
}

/**
 * Side-by-side Compare panel. The prompt, image attachments and reasoning
 * effort come from the shared playground composer (`content`, `reasoningEffort`)
 * and are never cleared by a run. Each column streams independently, can be
 * stopped on its own, and at most MAX_PARALLEL_COMPARE_RUNS requests are in
 * flight at once.
 */
export default function PlaygroundCompare({ providerGroups = [], modelOptions = [], content = "", reasoningEffort = "auto", fetchImpl }) {
  const [columns, setColumns] = useState(() => [newColumn(modelOptions[0]?.id), newColumn(modelOptions[1]?.id || modelOptions[0]?.id)]);
  const [selectionsLoaded, setSelectionsLoaded] = useState(false);
  const controllers = useRef(new Map());
  const limiter = useMemo(() => createLimiter(MAX_PARALLEL_COMPARE_RUNS), []);
  const modelById = useMemo(() => new Map(modelOptions.map((model) => [model.id, model])), [modelOptions]);
  const modelSelectOptions = useMemo(() => modelOptions.map((model) => ({ value: model.id, label: `${model.providerName} · ${model.name}` })), [modelOptions]);

  // A column whose model is unknown (discovery not done, model removed) falls
  // back to a catalog model by position, derived at render time.
  const modelIdFor = (column, index) => modelById.has(column.modelId) ? column.modelId : modelOptions[Math.min(index, modelOptions.length - 1)]?.id;

  // Session storage holds selectors only; responses and prompts stay in memory.
  useEffect(() => {
    const saved = readCompareSelections();
    if (saved) setColumns(saved.map((selection) => ({ ...newColumn(), ...selection })));
    setSelectionsLoaded(true);
  }, []);

  useEffect(() => {
    if (selectionsLoaded) writeCompareSelections(columns);
  }, [columns, selectionsLoaded]);

  useEffect(() => () => {
    for (const controller of controllers.current.values()) controller.abort();
  }, []);

  const patch = (id, update) => setColumns((prev) => prev.map((column) => column.id === id ? { ...column, ...update } : column));
  const hasPrompt = Array.isArray(content) ? content.length > 0 : String(content || "").trim().length > 0;
  const isBusy = (column) => column.status === "queued" || column.status === "running";

  const runColumn = (column, index) => {
    const model = modelById.get(modelIdFor(column, index));
    if (!model || !hasPrompt || isBusy(column)) return;
    controllers.current.get(column.id)?.abort();
    const controller = new AbortController();
    controllers.current.set(column.id, controller);
    patch(column.id, { status: "queued", text: "", error: "", latencyMs: null, ttftMs: null, usage: null });

    const body = { model: model.requestModel || model.id, messages: [{ role: "user", content }] };
    const effortOptions = getModelReasoningOptions(model.providerId, model.requestModel, { getThinkingLevels });
    if (reasoningEffort !== "auto" && effortOptions?.includes(reasoningEffort)) body.reasoning_effort = reasoningEffort;
    const group = providerGroups.find((item) => item.providerId === model.providerId);
    const connectionValid = getConnectionOptions(group).some((option) => option.value === column.connectionId);
    const headers = connectionValid && column.connectionId !== "auto" ? { "x-connection-id": column.connectionId } : {};

    limiter(() => {
      if (controller.signal.aborted) return null;
      patch(column.id, { status: "running" });
      return streamCompletion({ fetchImpl: fetchImpl || globalThis.fetch, body, headers, signal: controller.signal, onText: (text) => patch(column.id, { text }) });
    }).
    then((result) => {
      if (!result) return;
      patch(column.id, { status: "done", text: result.text, latencyMs: result.latencyMs, ttftMs: result.ttftMs, usage: result.usage });
    }).
    catch((error) => {
      patch(column.id, error?.name === "AbortError" ? { status: "cancelled" } : { status: "error", error: error?.message || "Request failed" });
    }).
    finally(() => {
      if (controllers.current.get(column.id) === controller) controllers.current.delete(column.id);
    });
  };

  const stopColumn = (column) => {
    controllers.current.get(column.id)?.abort();
    if (column.status === "queued") patch(column.id, { status: "cancelled" });
  };

  const removeColumn = (column) => {
    stopColumn(column);
    setColumns((prev) => prev.filter((item) => item.id !== column.id));
  };

  const addColumn = () => setColumns((prev) => prev.length >= MAX_COMPARE_COLUMNS ? prev : [...prev, newColumn(modelOptions[prev.length % Math.max(1, modelOptions.length)]?.id)]);

  const copy = (text) => globalThis.navigator?.clipboard?.writeText(text).catch(() => {});

  if (modelOptions.length === 0) {
    return <EmptyState icon="compare_arrows" title="No models to compare" message="Connect a provider with chat models, then compare them here." />;
  }

  return (
    <section aria-label="Compare models" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-dd-muted">Runs the composer prompt on every column. Up to {MAX_PARALLEL_COMPARE_RUNS} requests run at once; the rest queue.</p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon="add" onClick={addColumn} disabled={columns.length >= MAX_COMPARE_COLUMNS}>Add model</Button>
          <Button variant="primary" size="sm" icon="play_arrow" onClick={() => columns.forEach((column, index) => runColumn(column, index))} disabled={!hasPrompt || columns.every(isBusy)}>Run all</Button>
        </div>
      </div>
      <ol className={GRID_CLASSES[columns.length] || GRID_CLASSES[4]}>
        {columns.map((column, index) => {
          const modelId = modelIdFor(column, index);
          const model = modelById.get(modelId);
          const group = providerGroups.find((item) => item.providerId === model?.providerId);
          const connectionOptions = getConnectionOptions(group);
          const badge = STATUS_BADGE[column.status];
          const tokens = column.usage ? `${column.usage.prompt_tokens ?? "?"} in · ${column.usage.completion_tokens ?? "?"} out` : "—";
          return (
            <li key={column.id} className="flex min-h-80 min-w-0 flex-col rounded-dd-lg border border-dd-border-subtle bg-dd-surface md:max-h-[70vh]">
              <div className="flex flex-col gap-2 border-b border-dd-border-subtle p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><Select aria-label={`Model for column ${index + 1}`} options={modelSelectOptions} value={modelId} onChange={(modelId) => patch(column.id, { modelId, connectionId: "auto" })} placeholder="Select model" disabled={isBusy(column)} /></div>
                  <IconButton icon="close" label={`Remove column ${index + 1}`} size="sm" onClick={() => removeColumn(column)} disabled={columns.length <= MIN_COMPARE_COLUMNS} />
                </div>
                {connectionOptions.length > 1 ? <Select aria-label={`Connection for column ${index + 1}`} options={connectionOptions} value={connectionOptions.some((option) => option.value === column.connectionId) ? column.connectionId : "auto"} onChange={(connectionId) => patch(column.id, { connectionId })} placeholder="Select connection" disabled={isBusy(column)} /> : null}
                <div className="flex items-center justify-between gap-2">
                  {badge ? <Badge tone={badge.tone} size="sm" icon={badge.icon}>{badge.label}</Badge> : <span className="text-xs text-dd-subtle">Ready</span>}
                  <div className="flex items-center gap-1">
                    <IconButton icon="content_copy" label={`Copy response ${index + 1}`} size="sm" onClick={() => copy(column.text)} disabled={!column.text} />
                    {isBusy(column) ? <Button variant="secondary" size="sm" icon="stop" onClick={() => stopColumn(column)}>Stop</Button> : <Button variant="secondary" size="sm" icon="play_arrow" onClick={() => runColumn(column, index)} disabled={!model || !hasPrompt}>Run</Button>}
                  </div>
                </div>
              </div>
              <div role="region" tabIndex={0} aria-label={`Response from ${model?.name || `column ${index + 1}`}`} aria-busy={isBusy(column)} className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-3 py-3 text-[13px] leading-6 text-dd-text">
                {column.status === "error" ? <p role="alert" className="text-dd-danger">{column.error}</p> : column.text || <span className="text-dd-subtle">{column.status === "queued" ? "Waiting for a free slot…" : column.status === "running" ? "Waiting for the first token…" : "No response yet."}</span>}
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-dd-border-subtle px-3 py-2 text-xs">
                <dt className="text-dd-subtle">Latency</dt><dd className="dd-tnum text-end text-dd-muted">{formatMs(column.latencyMs)}</dd>
                <dt className="text-dd-subtle">First token</dt><dd className="dd-tnum text-end text-dd-muted">{formatMs(column.ttftMs)}</dd>
                <dt className="text-dd-subtle">Tokens</dt><dd className="dd-tnum text-end text-dd-muted">{tokens}</dd>
                <dt className="text-dd-subtle">Authoritative cost</dt><dd className="text-end text-dd-muted" title="The completion stream does not report an authoritative charge.">Unknown</dd>
              </dl>
            </li>);
        })}
      </ol>
    </section>);
}
