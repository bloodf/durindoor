import React, { useState } from "react";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";

const ENGINE_OPTIONS = [
  { value: "all", label: "All engines" },
  { value: "rtk", label: "RTK" },
  { value: "headroom", label: "Headroom" },
  { value: "caveman", label: "Caveman" },
];

const PRESET_OPTIONS = [
  { value: "", label: "Choose an example…" },
  { value: "tool-output", label: "Large tool output" },
  { value: "chat", label: "Long chat context" },
  { value: "request", label: "OpenAI request body" },
];

const MODEL_OPTIONS = [
  { value: "gpt-5.6-sol", label: "codex/gpt-5.6-sol" },
  { value: "claude-fable-5", label: "cc/claude-fable-5" },
  { value: "minimax-m2.7", label: "minimax/MiniMax-M2.7" },
];

const ADVANCED_REQUEST = `{
  "model": "codex/gpt-5.6-sol",
  "messages": [
    { "role": "user", "content": "Summarize this tool output" }
  ]
}`;

function TokenStat({ label, value }) {
  return (
    <div className="rounded-dd border border-dd-border-subtle bg-dd-surface-2 px-3 py-2">
      <p className="text-xs text-dd-muted">{label}</p>
      <p className="dd-tnum mt-0.5 text-lg font-semibold text-dd-text">{value}</p>
    </div>
  );
}

function PreviewPanel({ title, badge, text, tokens }) {
  return (
    <article className="flex min-h-72 flex-col overflow-hidden rounded-dd-lg border border-dd-border bg-dd-surface">
      <div className="flex items-center justify-between gap-3 border-b border-dd-border-subtle px-4 py-3">
        <h3 className="text-[13px] font-semibold text-dd-text">{title}</h3>
        {badge}
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5 text-dd-muted">
        {text}
      </pre>
      <div className="border-t border-dd-border-subtle px-4 py-3">
        <TokenStat label="Tokens" value={tokens} />
      </div>
    </article>
  );
}

function EmptyResults() {
  return (
    <Card className="flex min-h-96 items-center justify-center border-dashed">
      <div className="max-w-sm text-center">
        <span className="material-symbols-outlined text-[32px] text-dd-subtle" aria-hidden="true">
          compare_arrows
        </span>
        <h2 className="mt-3 text-sm font-semibold text-dd-text">No preview yet</h2>
        <p className="mt-1 text-xs leading-5 text-dd-muted">
          Select a model, add input, then run a preview to compare token usage.
        </p>
      </div>
    </Card>
  );
}

function Results({ results }) {
  return (
    <section className="space-y-3" aria-labelledby="results-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="results-title" className="text-sm font-semibold text-dd-text">Results</h2>
        <div className="flex items-center gap-2">
          <Badge tone="success">−{results.savedTokens} tokens</Badge>
          <Badge tone="success">{results.savings}% saved</Badge>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <PreviewPanel title="Before" text={results.before} tokens={results.beforeTokens} />
        <PreviewPanel
          title="After"
          badge={<Badge tone="success" size="sm">Compressed</Badge>}
          text={results.after}
          tokens={results.afterTokens}
        />
      </div>
    </section>
  );
}
function isValidJson(value) {
  if (!value.trim()) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

export default function TestSaversPage({ initialAdvanced = false, initialResults = null }) {
  const [engine, setEngine] = useState("all");
  const [preset, setPreset] = useState("");
  const [model, setModel] = useState(initialResults ? "gpt-5.6-sol" : "");
  const [advanced, setAdvanced] = useState(initialAdvanced);
  const [input, setInput] = useState(initialResults?.before ?? "");

  const [requestJson, setRequestJson] = useState(ADVANCED_REQUEST);
  const canRun = advanced ? isValidJson(requestJson) : Boolean(model && input.trim());
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        icon="science"
        title="Test Savers"
        subtitle="Preview how each compression engine would transform a request body"
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
      <Card padding={false} className="self-start">
        <CardHeader
          icon="tune"
          title="Preview request"
          subtitle="No request is sent to a provider."
        />
        <CardContent className="space-y-4">
          <Field label="Engine">
            <Select options={ENGINE_OPTIONS} value={engine} onChange={setEngine} />
          </Field>
          <Field label="Example preset">
            <Select options={PRESET_OPTIONS} value={preset} onChange={setPreset} />
          </Field>
          <Field label="Model">
            <Select
              options={MODEL_OPTIONS}
              value={model}
              onChange={setModel}
              placeholder="Select model…"
            />
          </Field>
          <Toggle
            checked={advanced}
            onChange={setAdvanced}
            label="Advanced JSON mode"
            description="Edit the complete request body."
          />
          {advanced ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-dd-muted">Request JSON</span>
              <pre
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label="Request JSON"
                onInput={(event) => setRequestJson(event.currentTarget.textContent ?? "")}
                className="min-h-52 overflow-auto whitespace-pre-wrap rounded-dd border border-dd-border bg-dd-surface-2 p-3 font-mono text-xs leading-5 text-dd-text outline-none focus:border-dd-accent focus:shadow-dd-focus"
              >
                {requestJson}
              </pre>
            </div>
          ) : (
            <>
              <Input
                label="Model input"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="provider/model"
                className="font-mono"
              />
              <Textarea
                label="Input text"
                rows={9}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Paste a prompt, tool result, or request body…"
              />
            </>
          )}
          <Button
            variant="primary"
            icon="play_arrow"
            disabled={!canRun}
            className="w-full"
          >
            Run preview
          </Button>
        </CardContent>
      </Card>

      <div className="min-w-0">
        {initialResults ? <Results results={initialResults} /> : <EmptyResults />}
      </div>
      </div>
    </div>
  );
}
