"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { isString } from "../../../../shared/utils/typeChecks.js";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useTheme } from "@/shared/hooks/useTheme";
import Button from "@/shared/ui/components/Button.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { Card, CardContent, CardFooter, CardHeader } from "@/shared/ui/components/Card.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export const STEPS = [
  { id: 1, label: "Client Request", file: "1_req_client.json", lang: "json", desc: "Raw request from client" },
  { id: 2, label: "Source Body", file: "2_req_source.json", lang: "json", desc: "After initial conversion" },
  { id: 3, label: "OpenAI Intermediate", file: "3_req_openai.json", lang: "json", desc: "source → openai" },
  { id: 4, label: "Target Request", file: "4_req_target.json", lang: "json", desc: "openai → target + URL + headers" },
  { id: 5, label: "Provider Response", file: "5_res_provider.txt", lang: "text", desc: "Raw SSE from provider" },
  { id: 6, label: "OpenAI Response", file: "6_res_openai.txt", lang: "text", desc: "target → openai (response)" },
  { id: 7, label: "Client Response", file: "7_res_client.txt", lang: "text", desc: "Final response to client" },
];

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 12,
  lineNumbers: "on",
  scrollBeyondLastLine: false,
  wordWrap: "on",
  automaticLayout: true,
};

function TranslatorNotice({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-4 py-3 text-[13px] text-dd-danger">
      <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">error</span>
      <p className="min-w-0 flex-1">{error}</p>
      <IconButton icon="close" label="Dismiss error" size="sm" onClick={onDismiss} />
    </div>
  );
}

export function TranslatorStepCard({ step, content, expanded, loading, onToggle, onLoad, onFormat, onCopy, action }) {
  const { isDark } = useTheme();
  const editorTheme = isDark ? "vs-dark" : "vs";
  return (
    <Card padding={false} className="overflow-hidden">
      <CardHeader
        icon={expanded ? "expand_more" : "chevron_right"}
        title={<span className="flex items-center gap-2"><span className="dd-tnum text-xs text-dd-subtle">{step.id}</span>{step.label}</span>}
        subtitle={<span className="font-mono text-xs">{step.file} · {step.desc}</span>}
        actions={<div className="flex items-center gap-1.5"><StatusDot tone={loading ? "info" : content ? "success" : "neutral"} pulse={loading} label={loading ? "Loading" : content ? `${content.length} chars` : "Not loaded"} /><IconButton icon={expanded ? "expand_less" : "expand_more"} label={`${expanded ? "Collapse" : "Expand"} ${step.label}`} variant="secondary" onClick={onToggle} /></div>}
      />
      {expanded ? (
        <>
          <CardContent className="space-y-3">
            <div className="overflow-hidden rounded-dd border border-dd-border bg-dd-surface-2" aria-label={`${step.label} editor`}>
              <Editor
                height="400px"
                defaultLanguage={step.lang === "text" ? "plaintext" : "json"}
                value={content}
                onChange={(value) => onFormat === undefined ? undefined : onFormat(value, true)}
                theme={editorTheme}
                options={EDITOR_OPTIONS}
              />
            </div>
          </CardContent>
          <CardFooter className="flex-wrap">
            <Button size="md" variant="secondary" icon="folder_open" loading={loading} onClick={onLoad}>Load</Button>
            <Button size="md" variant="secondary" icon="data_object" onClick={() => onFormat()}>Format</Button>
            <Button size="md" variant="secondary" icon="content_copy" onClick={onCopy}>Copy</Button>
            {action}
          </CardFooter>
        </>
      ) : (
        <CardFooter className="justify-between">
          <p className="text-xs text-dd-muted">{step.desc}</p>
          <div className="flex gap-2"><Button size="md" variant="secondary" icon="folder_open" loading={loading} onClick={onLoad}>Load</Button>{action}</div>
        </CardFooter>
      )}
    </Card>
  );
}

export function TranslatorWorkspace({ initialContents = {}, initialMeta = null }) {
  const [contents, setContents] = useState(initialContents);
  const [expanded, setExpanded] = useState({ 1: true });
  const [loading, setLoading] = useState({});
  const [meta, setMeta] = useState(initialMeta);
  const [error, setError] = useState("");
  const { copy } = useCopyToClipboard();

  const setLoad = (key, value) => setLoading((previous) => ({ ...previous, [key]: value }));
  const setContent = (id, value) => setContents((previous) => ({ ...previous, [id]: value }));
  const toggle = (id) => setExpanded((previous) => ({ ...previous, [id]: !previous[id] }));
  const openNext = (nextId) => setExpanded(() => Object.fromEntries(STEPS.map((step) => [step.id, step.id === nextId])));
  const reportError = (message) => setError(message || "Translator request failed");

  const detectMeta = async (rawContent) => {
    try {
      const body = isString(rawContent) ? JSON.parse(rawContent) : rawContent;
      const response = await fetch("/api/translator/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: 1, body }) });
      const data = await response.json();
      if (data.success) setMeta(data.result);
    } catch {}
  };

  const handleLoad = async (stepId) => {
    const step = STEPS.find((item) => item.id === stepId);
    setLoad(`load-${stepId}`, true);
    try {
      const response = await fetch(`/api/translator/load?file=${step.file}`);
      const data = await response.json();
      if (!data.success) reportError(data.error || "File not found");
      else {
        setContent(stepId, data.content);
        if (stepId === 1) await detectMeta(data.content);
      }
    } catch (caught) { reportError(caught.message); }
    setLoad(`load-${stepId}`, false);
  };

  const save = (file, content) => fetch("/api/translator/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file, content }) }).catch(() => {});

  const handleToOpenAI = async () => {
    setLoad("toOpenAI", true);
    try {
      const raw = contents[1];
      const body = JSON.parse(raw);
      save("1_req_client.json", raw);
      save("2_req_source.json", JSON.stringify({ timestamp: new Date().toISOString(), headers: {}, body: body.body || body }, null, 2));
      const response = await fetch("/api/translator/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: 2, body }) });
      const data = await response.json();
      if (!data.success) reportError(data.error);
      else { setContent(3, JSON.stringify(data.result.body, null, 2)); openNext(3); }
    } catch (caught) { reportError(caught.message); }
    setLoad("toOpenAI", false);
  };

  const handleToTarget = async () => {
    setLoad("toTarget", true);
    try {
      const raw = contents[3];
      const openaiBody = JSON.parse(raw);
      save("3_req_openai.json", raw);
      const response = await fetch("/api/translator/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: 3, body: { ...openaiBody, provider: meta?.provider, model: meta?.model } }) });
      const data = await response.json();
      if (!data.success) reportError(data.error);
      else { setContent(4, JSON.stringify({ ...data.result, provider: meta?.provider, model: meta?.model }, null, 2)); openNext(4); }
    } catch (caught) { reportError(caught.message); }
    setLoad("toTarget", false);
  };

  const handleSend = async () => {
    setLoad("send", true);
    try {
      const raw = contents[4];
      const step4 = JSON.parse(raw);
      save("4_req_target.json", raw);
      const provider = step4.provider || meta?.provider;
      const model = step4.model || meta?.model;
      if (!provider || !model) { reportError("Missing provider or model. Please run step 1 first to detect them."); return; }
      const response = await fetch("/api/translator/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, model, body: step4.body || step4 }) });
      if (!response.ok) { reportError((await response.json().catch(() => ({ error: response.statusText }))).error || "Send failed"); return; }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) { const { done, value } = await reader.read(); if (done) break; full += decoder.decode(value, { stream: true }); }
      setContent(5, full);
      openNext(5);
      // Preserve original behavior: original code awaited the fetch directly
      // so a rejected save surfaced in the catch and reported via alert. The
      // fire-and-forget `save` helper swallows rejections, so do not use it here.
      await fetch("/api/translator/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: "5_res_provider.txt", content: full }) });
    } catch (caught) { reportError(caught.message); }
    finally { setLoad("send", false); }
  };

  const handleFormat = (id, value, changed) => {
    if (changed) { setContent(id, value || ""); if (id === 1) detectMeta(value || ""); return; }
    try { setContent(id, JSON.stringify(JSON.parse(contents[id]), null, 2)); } catch {}
  };
  const getAction = (stepId) => stepId === 1 ? <Button size="md" variant="primary" icon="arrow_forward" loading={loading.toOpenAI} onClick={handleToOpenAI}>To OpenAI</Button> : stepId === 3 ? <Button size="md" variant="primary" icon="arrow_forward" loading={loading.toTarget} onClick={handleToTarget}>To Target</Button> : stepId === 4 ? <Button size="md" variant="primary" icon="send" loading={loading.send} onClick={handleSend}>Send</Button> : null;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-4 text-[13px] sm:p-6 lg:p-8">
      <PageHeader icon="swap_horiz" title="Translator Debug" subtitle="Replay request flow — matches log files" actions={meta ? <div className="flex flex-wrap justify-end gap-1.5"><MetaBadge label="Source" value={meta.sourceFormat} tone="info" /><span aria-hidden="true" className="material-symbols-outlined self-center text-[18px] text-dd-muted">arrow_forward</span><MetaBadge label="Target" value={meta.targetFormat} tone="warning" /><MetaBadge label="Provider" value={meta.provider} tone="success" /><MetaBadge label="Model" value={meta.model} tone="accent" /></div> : null} />
      <TranslatorNotice error={error} onDismiss={() => setError("")} />
      {!Object.values(contents).some(Boolean) ? <Card><EmptyState icon="description" title="Load a captured request" message="Start with Client Request to inspect each conversion step and replay it safely." /></Card> : null}
      <section aria-label="Translation steps" className="space-y-3">
        {STEPS.map((step) => <TranslatorStepCard key={step.id} step={step} content={contents[step.id] || ""} expanded={Boolean(expanded[step.id])} loading={Boolean(loading[`load-${step.id}`])} onToggle={() => toggle(step.id)} onLoad={() => handleLoad(step.id)} onFormat={(value, changed) => handleFormat(step.id, value, changed)} onCopy={() => contents[step.id] && copy(contents[step.id], `translator-step-${step.id}`)} action={getAction(step.id)} />)}
      </section>
    </main>
  );
}


export function MetaBadge({ label, value, tone = "neutral" }) {
  return <Badge tone={tone} size="sm"><span className="text-dd-subtle">{label}</span>{value}</Badge>;
}
