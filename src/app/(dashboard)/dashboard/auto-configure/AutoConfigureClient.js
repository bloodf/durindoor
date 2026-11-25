"use client";

import { useRef, useState } from "react";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Checkbox from "@/shared/ui/components/Checkbox.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import SetupDiagnosticCard from "@/shared/components/SetupDiagnosticCard";
import MotionIcon from "@/shared/ui/v5/motion/MotionIcon.jsx";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { serviceStatus } from "./autoConfigureStatus.js";
import { isString } from "../../../../shared/utils/typeChecks.js";

const SERVICE_META = {
  headroom: { label: "Headroom", icon: "compress" },
  pxpipe: { label: "PxPipe", icon: "token" },
  firecrawl: { label: "Firecrawl", icon: "travel_explore" },
  toggles: { label: "Toggles", icon: "toggle_on" },
};
const STATUS_TONE = { default: "neutral", success: "success", warning: "warning", error: "danger" };

function isCommandAction(action) {
  return /^(?:\$\s+|(?:npm|pip|uv|python|node|headroomUrl|export|set)\b|[A-Za-z_][A-Za-z0-9_]*=|.*(?:^|\s)(?:\.?\.?\/|\/)[^\s]+)/.test(action);
}
function ActionEntry({ action }) {
  const v5 = useUiV5();
  const { copy, copied } = useCopyToClipboard();
  const diagnostic = action?.diagnostic || (action?.summary && action?.fixes ? action : null);
  if (diagnostic) return <SetupDiagnosticCard diagnostic={diagnostic} />;
  if (!isString(action)) return null;
  if (!isCommandAction(action)) return <span className="whitespace-pre-wrap break-words text-xs text-dd-muted">{action}</span>;
  return <div className={v5 ? "flex min-w-0 flex-wrap items-center gap-2" : "flex flex-wrap items-center gap-2"}><code tabIndex={0} aria-label="Configuration command" className={v5 ? "flex min-h-11 min-w-0 max-w-full items-center overflow-x-auto rounded-dd bg-dd-surface-2 px-2 font-mono text-xs text-dd-text" : "flex min-h-11 max-w-full items-center overflow-x-auto rounded-dd bg-dd-surface-2 px-2 font-mono text-xs text-dd-text"} role="region">{action}</code><Button variant="secondary" size="sm" onClick={() => copy(action, action)} icon="content_copy">{copied === action ? "Copied" : "Copy"}</Button></div>;
}
function ServiceRow({ name, svc, dryRun }) {
  const v5 = useUiV5();
  const meta = SERVICE_META[name] || { label: name, icon: "settings" };
  const status = serviceStatus(svc, dryRun);
  const actions = Array.isArray(svc?.actions) ? svc.actions : [];
  return <div className={v5 ? "flex min-w-0 flex-col gap-2 rounded-dd bg-dd-surface-2 p-3" : "flex flex-col gap-2 rounded-dd bg-dd-surface-2 p-3"}>
    <div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2">{v5 ? <MotionIcon name={meta.icon} size={18} className="text-dd-subtle" /> : <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-subtle">{meta.icon}</span>}<span className="truncate text-[13px] font-medium text-dd-text">{meta.label}</span></div><Badge tone={STATUS_TONE[status.variant] || "neutral"} size="sm">{status.label}</Badge></div>
    {actions.length ? <ul className="space-y-1"><>{actions.map((action, index) => <li key={index}><ActionEntry action={action} /></li>)}</></ul> : null}
  </div>;
}
function ResultSummary({ title, services, actions, dryRun, changed }) {
  const v5 = useUiV5();
  const entries = Object.entries(services || {});
  const headline = dryRun ? `Preview — ${changed ? "would apply changes" : "nothing to change"}` : null;
  return <Card padding={false}><div className="flex items-center gap-3 border-b border-dd-border-subtle px-5 py-4"><span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">{v5 ? <MotionIcon name="fact_check" size={18} /> : <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">fact_check</span>}</span><h2 className="min-w-0 flex-1 text-sm font-semibold text-dd-text">{title}</h2>{headline ? <Badge tone={changed ? "warning" : "success"} size="sm">{headline}</Badge> : null}</div><CardContent className="space-y-3">
    {entries.length ? <div className="grid gap-2 sm:grid-cols-2">{entries.map(([name, svc]) => <ServiceRow key={name} name={name} svc={svc} dryRun={dryRun} />)}</div> : <p className="text-xs text-dd-muted">No services reported.</p>}
    {Array.isArray(actions) && actions.length ? <details className="group"><summary className="list-item min-h-11 cursor-pointer py-3 text-xs font-medium text-dd-muted outline-none focus-visible:rounded-dd focus-visible:shadow-dd-focus">Action log ({actions.length})</summary><ul className="mt-2 space-y-1">{actions.map((action, index) => <li key={index}><ActionEntry action={action} /></li>)}</ul></details> : null}
  </CardContent></Card>;
}

export default function AutoConfigureClient({ status: initialStatus, initialError = "" }) {
  const v5 = useUiV5();
  const runLock = useRef(false);
  const [status, setStatus] = useState(initialStatus);
  const [statusError, setStatusError] = useState(initialError);
  const [statusLoading, setStatusLoading] = useState(false);
  async function retryStatus() {
    setStatusLoading(true);
    try {
      const res = await fetch("/api/settings/auto-configure");
      const data = await res.json();
      if (!res.ok || !data.services) throw new Error(data.error || "Configuration status could not be loaded.");
      setStatus(data); setStatusError("");
    } catch (caught) { setStatusError(caught.message); }
    finally { setStatusLoading(false); }
  }
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [error, setError] = useState(null);
  async function run() {
    if (runLock.current) return;
    runLock.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/auto-configure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setReport(data.report);
    } catch (caught) {
      setError(caught.message || String(caught));
    } finally {
      runLock.current = false;
      setLoading(false);
    }
  }
  const statusPreview = status && !report ? <ResultSummary title="Status" services={status.services} actions={status.actions} dryRun={true} changed={status.wouldChange} /> : null;
  return <div className={v5 ? "v5-dashboard-page mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 text-dd-text" : "mx-auto flex w-full max-w-6xl flex-col gap-4"}>
    <PageHeader icon="auto_fix_high" title="Auto-configure" subtitle="One-click setup for Headroom, PxPipe, Firecrawl, and built-in toggles." />
    {v5 && statusPreview ? <div role="status">{statusPreview}</div> : null}
    <Card padding={false}><CardHeader icon="play_circle" title="Run configuration" subtitle="Preview changes before applying them." /><CardContent className="flex flex-wrap items-center justify-between gap-4"><Checkbox checked={dryRun} onChange={setDryRun} label="Dry run (preview only)" hint="Show planned changes without applying them." /><Button variant="primary" onClick={run} loading={loading} disabled={loading} icon="auto_fix_high">{loading ? "Running…" : "Run auto-configure"}</Button></CardContent></Card>
    {statusError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-dd border border-dd-danger/30 p-4">{v5 ? <MotionIcon name="error" size={18} className="text-dd-danger" /> : null}<p>{statusError}</p><Button icon="refresh" loading={statusLoading} onClick={retryStatus}>Retry status</Button></div> : null}
    {error ? <div className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 p-4 text-[13px] text-dd-danger" role="alert">{v5 ? <MotionIcon name="error" size={18} className="me-2 text-dd-danger" /> : null}<span className="whitespace-pre-wrap break-words">{error}</span></div> : null}
    {!v5 ? statusPreview : null}
    {report ? <ResultSummary title={report.dryRun ? "Dry run result" : "Result"} services={report.services} actions={report.actions} dryRun={report.dryRun} changed={report.dryRun ? report.wouldChange : report.changed} /> : null}
  </div>;
}
