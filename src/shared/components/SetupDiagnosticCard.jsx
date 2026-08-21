"use client";

import { useCallback, useState } from "react";
import { Button } from "@/shared/components";
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
      className={`rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm ${className}`}
    >
      <p className="font-semibold text-warning">{view.heading}</p>
      {view.summary && (
        <p className="mt-1 font-medium text-text">{view.summary}</p>
      )}
      {view.detail && (
        <p className="mt-1 text-text-muted">{view.detail}</p>
      )}
      {view.fixes.length > 0 && (
        <ul className="mt-3 space-y-3">
          {view.fixes.map((fix, index) => {
            const copyKey = `setup-diagnostic-fix-${index}`;
            return (
              <li
                key={`${fix?.label || "fix"}-${index}`}
                className="rounded border border-border/60 bg-surface/60 p-2"
              >
                <p className="font-medium text-text">
                  {fix?.label || "Resolve this setup problem"}
                </p>
                {hasCopyableCommand(fix) && (
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded bg-surface px-2 py-1 text-xs text-text">
                      {fix.command}
                    </code>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleCopy(fix.command, copyKey)}
                    >
                      {copiedKey === copyKey ? "Copied" : "Copy"}
                    </Button>
                  </div>
                )}
                {fix?.url && (
                  <a
                    className="mt-2 inline-block text-accent underline"
                    href={fix.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open fix link
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hasLogTail(diagnostic) && (
        <details className="mt-3">
          <summary className="cursor-pointer text-text-muted">
            Show recent Headroom log output
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-xs text-text-muted">
            {diagnostic.logTail}
          </pre>
        </details>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        {diagnostic.docs && (
          <a
            className="text-accent underline"
            href={diagnostic.docs}
            target="_blank"
            rel="noreferrer"
          >
            Open Headroom documentation
          </a>
        )}
        {onRetry && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </section>
  );
}
