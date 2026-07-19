"use client";

import { useState } from "react";
import { Badge } from "@/shared/components";

// Derive a status badge + tone for a single service report.
// Service reports have shape: { changed?, wouldChange?, actions: [], installed?, detected?, running? }
// Absence (pxpipe/firecrawl not present, headroom not reachable) must surface as "Unavailable"
// before change flags — otherwise an absent service mislabels as "Up to date".
function serviceStatus(svc, dryRun) {
  if (!svc) return { label: "Unknown", variant: "default" };
  // Change wins over absence: a dry-run can plan to install an absent service
  // (e.g. headroom installed:false, wouldInstall:true, wouldChange:true).
  const willChange = dryRun ? svc.wouldChange : svc.changed;
  if (willChange) return { label: dryRun ? "Would change" : "Changed", variant: "warning" };
  // Firecrawl reports `detected` when a probe ran; pxpipe/headroom report `installed`.
  // Absent services that would NOT change (pxpipe/firecrawl not present) surface here.
  const present = svc.detected !== false && svc.installed !== false;
  if (!present) return { label: "Unavailable", variant: "default" };
  return { label: "Up to date", variant: "success" };
}

// Service display config keyed on report.services entries from runAutoConfigure.
const SERVICE_META = {
  headroom: { label: "Headroom", icon: "compress" },
  pxpipe: { label: "PxPipe", icon: "token" },
  firecrawl: { label: "Firecrawl", icon: "travel_explore" },
  toggles: { label: "Toggles", icon: "toggle_on" },
};

// Render a service summary + its action log. `dryRun` decides wouldChange vs changed tone.
function ServiceRow({ name, svc, dryRun }) {
  const meta = SERVICE_META[name] || { label: name, icon: "settings" };
  const st = serviceStatus(svc, dryRun);
  const actions = Array.isArray(svc?.actions) ? svc.actions : [];
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-text-muted">{meta.icon}</span>
          <span className="text-sm font-medium text-text-main">{meta.label}</span>
        </div>
        <Badge variant={st.variant} size="sm" dot>{st.label}</Badge>
      </div>
      {actions.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {actions.map((action, i) => (
            <li key={i} className="whitespace-pre-wrap break-words text-xs text-text-muted">
              {action}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Structured summary for either a dry-run status (page prop) or a run report.
// Both share services + actions; reports add dryRun/changed.
function ResultSummary({ title, services, actions, dryRun, changed }) {
  const entries = Object.entries(services || {});
  const headline = dryRun
    ? `Preview — ${changed ? "would apply changes" : "nothing to change"}`
    : null;
  return (
    <div className="rounded-lg border border-border bg-surface/30 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-main">{title}</h2>
        {headline && <Badge variant={changed ? "warning" : "success"} size="sm" dot>{headline}</Badge>}
      </div>
      {entries.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {entries.map(([name, svc]) => (
            <ServiceRow key={name} name={name} svc={svc} dryRun={dryRun} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-muted">No services reported.</p>
      )}
      {Array.isArray(actions) && actions.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-text-muted">
            Action log ({actions.length})
          </summary>
          <ul className="mt-2 space-y-0.5">
            {actions.map((action, i) => (
              <li key={i} className="whitespace-pre-wrap break-words text-xs text-text-muted">
                {action}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function AutoConfigureClient({ status }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/auto-configure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setReport(data.report);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Auto-configure</h1>
      </div>

      <p className="text-gray-300">
        One-click setup for Headroom, PxPipe, Firecrawl, and built-in toggles.
      </p>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
          />
          Dry run (preview only)
        </label>

        <button
          onClick={run}
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Running..." : "Run auto-configure"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-800 bg-red-900/30 p-4 text-red-200">
          <span className="whitespace-pre-wrap break-words">{error}</span>
        </div>
      )}

      {status && !report && (
        <ResultSummary
          title="Status"
          services={status.services}
          actions={status.actions}
          dryRun
          changed={status.wouldChange}
        />
      )}

      {report && (
        <ResultSummary
          title={report.dryRun ? "Dry run result" : "Result"}
          services={report.services}
          actions={report.actions}
          dryRun={report.dryRun}
          changed={report.dryRun ? report.wouldChange : report.changed}
        />
      )}
    </div>
  );
}
