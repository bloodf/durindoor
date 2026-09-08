"use client";

import { useCallback, useState } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  diagnosticView,
  hasCopyableCommand,
  hasLogTail,
} from "@/shared/utils/setupDiagnosticView";

export default function SetupDiagnosticCard({ diagnostic, onRetry, className = "" }) {
  const { copy } = useCopyToClipboard();
  const [copiedKey, setCopiedKey] = useState(null);
  const handleCopy = useCallback((command, key) => {
    copy(command, key);
    setCopiedKey(key);
  }, [copy]);
  const view = diagnosticView(diagnostic);
  if (!view) return null;

  return (
    <section
      role="alert"
      className={`rounded-dd-lg border border-dd-warning/40 bg-dd-warning/10 p-5 text-[13px] text-dd-text ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined mt-0.5 text-[20px] leading-none text-dd-warning" aria-hidden="true">warning</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-dd-warning">{view.heading}</p>
          {view.summary ? <p className="mt-1 font-medium text-dd-text">{view.summary}</p> : null}
          {view.detail ? <p className="mt-1 text-dd-muted">{view.detail}</p> : null}
        </div>
      </div>
      {view.fixes.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {view.fixes.map((fix, index) => {
            const copyKey = `setup-diagnostic-fix-${index}`;
            return (
              <li key={`${fix?.label || "fix"}-${index}`} className="rounded-dd border border-dd-border bg-dd-surface p-3">
                <p className="font-medium text-dd-text">{fix?.label || "Resolve this setup problem"}</p>
                {hasCopyableCommand(fix) ? (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <code className="min-w-0 flex-1 break-all rounded-dd bg-dd-surface-2 px-2 py-2 text-xs text-dd-text">{fix.command}</code>
                    <Button size="sm" variant="secondary" onClick={() => handleCopy(fix.command, copyKey)}>
                      {copiedKey === copyKey ? "Copied" : "Copy"}
                    </Button>
                  </div>
                ) : null}
                {fix?.url ? <a className="mt-2 inline-flex min-h-11 items-center rounded-dd px-2 text-[13px] text-dd-accent outline-none hover:bg-dd-accent-soft hover:underline focus-visible:shadow-dd-focus" href={fix.url} target="_blank" rel="noreferrer">Open fix link</a> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {hasLogTail(diagnostic) ? (
        <details className="mt-4 rounded-dd border border-dd-border bg-dd-surface-2 p-3">
          <summary className="cursor-pointer text-dd-muted outline-none focus-visible:rounded-dd focus-visible:shadow-dd-focus">Show recent Headroom log output</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-dd bg-dd-surface p-2 text-xs text-dd-muted">{diagnostic.logTail}</pre>
        </details>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {diagnostic.docs ? <a className="inline-flex min-h-11 items-center rounded-dd px-2 text-[13px] text-dd-accent outline-none hover:bg-dd-accent-soft hover:underline focus-visible:shadow-dd-focus" href={diagnostic.docs} target="_blank" rel="noreferrer">Open Headroom documentation</a> : null}
        {onRetry ? <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>Retry</Button> : null}
      </div>
    </section>
  );
}
