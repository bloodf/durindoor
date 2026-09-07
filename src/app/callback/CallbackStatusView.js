"use client";

import { Card } from "@/shared/ui/components/Card.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { isBrowser } from "../../shared/utils/typeChecks.js";

export function CallbackStatusView({ status = "processing", failureMessage = "" }) {
  const processing = status === "processing";
  const success = status === "success" || status === "done";
  const failed = status === "error";
  const manual = status === "manual";

  return (
    <main className="flex min-h-screen items-center justify-center bg-dd-bg p-4">
      <Card className="w-full max-w-md text-center shadow-dd-elevated">
        <div className={`mx-auto mb-4 flex size-16 items-center justify-center rounded-full ${success ? "bg-dd-success/10 text-dd-success" : failed ? "bg-dd-danger/10 text-dd-danger" : manual ? "bg-dd-warning/10 text-dd-warning" : "bg-dd-accent-soft text-dd-accent"}`}>
          <span aria-hidden="true" className={`material-symbols-outlined text-3xl ${processing ? "animate-spin" : ""}`}>
            {processing ? "progress_activity" : success ? "check_circle" : failed ? "error" : "info"}
          </span>
        </div>
        <Badge tone={success ? "success" : failed ? "danger" : manual ? "warning" : "accent"} size="sm" className="mb-3">OAuth callback</Badge>
        <h1 className="mb-2 text-xl font-semibold text-dd-text">{processing ? "Processing…" : success ? "Authorization successful!" : failed ? "Authorization failed" : "Copy this URL"}</h1>
        <p className="text-[13px] text-dd-muted">{processing ? "Please wait while we complete the authorization." : success ? (status === "success" ? "This window will close automatically…" : "You can close this tab now.") : failed ? (failureMessage || "The provider rejected this login.") : "Please copy the URL from the address bar and paste it in the application."}</p>
        {manual ? <div className="mt-4 rounded-dd border border-dd-border bg-dd-surface-2 p-3 text-start"><code className="break-all text-xs text-dd-text">{isBrowser() ? window.location.href : ""}</code></div> : null}
      </Card>
    </main>
  );
}
