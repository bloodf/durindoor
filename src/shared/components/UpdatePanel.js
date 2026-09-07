"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { Card, CardContent } from "@/shared/ui/components/Card.jsx";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import {
  getUpdaterPhaseLabel,
  getUpdaterProgressPercent,
  getUpdaterStatusUrl,
  hasExceededStartupBudget,
  isUpdaterFailure,
  isUpdaterStatusCurrent,
  isUpdaterSuccess,
} from "@/shared/utils/updaterStatus";
import { isBrowser } from "../utils/typeChecks.js";

/**
 * One-click update panel (port of decolua/9router #2575).
 *
 * Modes:
 * - auto: POST /api/version/update → poll detached status server → reload
 * - manual: copy install cmd + optional shutdown (fallback / user choice)
 *
 * Unlike upstream, the status poll is bounded (`hasExceededStartupBudget`):
 * if the detached updater never comes up or wedges mid-phase, the panel
 * fails over to manual install instead of polling forever.
 */

const PROGRESS_BAR = "h-1.5 w-full overflow-hidden rounded-full bg-dd-surface-2";
const PROGRESS_FILL = "h-full rounded-full bg-dd-accent transition-all duration-500";
const META_LINE = "text-xs text-dd-muted";
const ERROR_BANNER = "mb-3 rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-3 py-2 text-xs text-dd-danger";
const MUTED_TOGGLE =
  "mt-3 w-full rounded-dd text-center text-xs text-dd-muted outline-none transition-colors hover:text-dd-text focus-visible:shadow-dd-focus";

const reloadPage = () => globalThis.location.reload();
function PanelHeader({ icon, iconTone = "accent", title, subtitle, children }) {
  const toneClass =
    iconTone === "warning"
      ? "bg-dd-warning/15 text-dd-warning"
      : iconTone === "success"
      ? "bg-dd-success/15 text-dd-success"
      : "bg-dd-accent-soft text-dd-accent";
  return (
    <div className="mb-4 flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`inline-flex size-11 items-center justify-center rounded-dd ${toneClass}`}
      >
        <span className="material-symbols-outlined text-[22px] leading-none">{icon}</span>
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold text-dd-text">{title}</h2>
        <p className={META_LINE}>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export default function UpdatePanel({
  currentVersion,
  latestVersion,
  installCmd,
  onClose,
  onReload = reloadPage,
}) {
  const [mode, setMode] = useState("auto"); // "auto" | "manual"
  const [phase, setPhase] = useState("idle"); // idle | starting | running | success | failed
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const pollRef = useRef(null);
  const reloadRef = useRef(null);
  const countdownRef = useRef(null);
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);
  const statusNotBeforeRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (reloadRef.current) {
      clearInterval(reloadRef.current);
      reloadRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      clearTimers();
    },
    [clearTimers],
  );

  const failToManual = useCallback(
    (message) => {
      clearTimers();
      setError(message);
      setPhase("failed");
      setMode("manual");
    },
    [clearTimers],
  );

  const startStatusPoll = useCallback(() => {
    clearTimers();
    const origin = isBrowser() ? window.location.origin : null;
    const url = getUpdaterStatusUrl(UPDATER_CONFIG.statusPort, origin);
    const poll = async () => {
      if (cancelledRef.current) return;

      // Bounded startup/poll: never strand the overlay polling a dead endpoint
      if (hasExceededStartupBudget(startedAtRef.current, Date.now())) {
        failToManual("Updater is not responding (timed out). Install manually instead.");
        return;
      }

      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelledRef.current) return;

        // Reject stale status from a prior update run before doing anything terminal.
        if (
          statusNotBeforeRef.current &&
          !isUpdaterStatusCurrent(data, statusNotBeforeRef.current)
        ) {
          return;
        }

        setStatus(data);
        setPhase("running");

        if (isUpdaterSuccess(data)) {
          setPhase("success");
          // App relaunches itself; poll dashboard readiness, then reload once.
          if (!reloadRef.current) {
            const probe = async () => {
              if (cancelledRef.current) return;
              try {
                const ready = await fetch(`${origin || ""}/api/version`, { cache: "no-store" });
                if (ready.ok) {
                  clearInterval(reloadRef.current);
                  reloadRef.current = null;
                  onReload();
                  return;
                }
              } catch {
                /* server still coming up */
              }
            };
            let attempts = 0;
            const maxAttempts = 30; // ~60s at 2s interval, within budget
            reloadRef.current = setInterval(async () => {
              attempts += 1;
              if (cancelledRef.current) return;
              if (attempts >= maxAttempts) {
                clearInterval(reloadRef.current);
                reloadRef.current = null;
                failToManual("App restarted but is not responding. Reload manually.");
                return;
              }
              await probe();
            }, 2000);
            probe();
          }
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } else if (isUpdaterFailure(data)) {
          failToManual(data.error || "Install failed");
        }
      } catch {
        // Status server not up yet, or transient network blip after parent exit — keep polling (bounded above)
      }
    };
    // Assign interval BEFORE first poll: a terminal state clears pollRef,
    // so polling first would leak the interval (decolua/9router #2575 race fix).
    pollRef.current = setInterval(poll, UPDATER_CONFIG.statusPollIntervalMs);
    poll();
  }, [clearTimers, failToManual, onReload]);

  const startAutoUpdate = useCallback(async () => {
    setError(null);
    setStatus(null);
    setPhase("starting");
    cancelledRef.current = false;
    startedAtRef.current = Date.now();
    statusNotBeforeRef.current = 0;

    try {
      const res = await fetch("/api/version/update", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Dev / non-CLI install: auto path disabled — fall back to manual
        failToManual(data.message || `Auto-update unavailable (${res.status})`);
        return;
      }

      // Capture the server's clock from the response so we can reject stale
      // status from a previous update run (HTTP Date has 1s precision).
      const serverDate = res.headers.get("Date");
      if (serverDate) {
        const parsed = Date.parse(serverDate);
        if (Number.isFinite(parsed)) {
          statusNotBeforeRef.current = parsed;
        }
      }

      // Parent Next server will exit shortly; poll detached updater status
      setPhase("running");
      startStatusPoll();
    } catch {
      // POST may fail if the server already exited after scheduling the updater — still poll
      setPhase("running");
      startStatusPoll();
    }
  }, [startStatusPoll, failToManual]);

  const handleCopyAndShutdown = async () => {
    try {
      await navigator.clipboard.writeText(installCmd);
    } catch {
      /* clipboard blocked */
    }
    setCopied(true);
    let remaining = UPDATER_CONFIG.shutdownCountdownSec;
    setCountdown(remaining);
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        fetch("/api/version/shutdown", { method: "POST" }).catch(() => {});
        setIsDisconnected(true);
      }
    }, 1000);
  };

  const progress = getUpdaterProgressPercent(
    status || { phase: phase === "starting" ? "starting" : null },
  );
  const phaseLabel =
    phase === "starting"
      ? "Contacting updater…"
      : phase === "success"
        ? "Update complete — reloading when app is ready…"
        : getUpdaterPhaseLabel(status?.phase, {
            attempt: status?.attempt,
            maxRetries: status?.maxRetries,
          });
  const logTail = Array.isArray(status?.logTail) ? status.logTail : [];
  const busy = phase === "starting" || phase === "running" || phase === "success";
  const title = `Update ${APP_CONFIG.name}${latestVersion ? ` to v${latestVersion}` : ""}${currentVersion ? ` (current: v${currentVersion})` : ""}`;

  // ── Auto mode (default) ──────────────────────────────────────────────────
  if (mode === "auto") {
    return (
      <Card padding={false} className="w-full max-w-xl" aria-label={title}>
        <CardContent>
          <div role="status" aria-live="polite" className="sr-only">
            {phase === "idle" ? "Update ready" : phaseLabel}
          </div>
          <PanelHeader
            icon={phase === "success" ? "check_circle" : "system_update"}
            iconTone={phase === "success" ? "success" : "accent"}
            title={title}
            subtitle="One-click install. The app will stop, update, and restart automatically."
          />

          {phase === "idle" ? (
            <>
              <ul className="mb-4 list-disc space-y-1.5 pl-5 text-xs text-dd-muted">
                <li>
                  Works with the production{" "}
                  <code className="rounded-dd bg-dd-surface-2 px-1 py-0.5 font-mono text-[11px] text-dd-text">
                    {UPDATER_CONFIG.npmPackageName}
                  </code>{" "}
                  CLI install
                </li>
                <li>Takes about 1–2 minutes (npm global install + restart)</li>
                <li>You can switch to manual install if auto fails</li>
              </ul>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="ghost" onClick={onClose} className="sm:w-auto">
                  Cancel
                </Button>
                <Button variant="primary" onClick={startAutoUpdate} className="w-full" icon="system_update">
                  Update &amp; Restart
                </Button>
              </div>
              <button
                type="button"
                onClick={() => setMode("manual")}
                className={MUTED_TOGGLE}
              >
                Prefer manual install instead?
              </button>
            </>
          ) : null}

          {busy ? (
            <>
              <div className="mb-3">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-dd-text">{phaseLabel}</span>
                  <span className="dd-tnum text-dd-muted">{progress}%</span>
                </div>
                <div className={PROGRESS_BAR} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, progress)}>
                  <div
                    className={PROGRESS_FILL}
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
              </div>

              {logTail.length > 0 ? (
                <div className="mb-3 max-h-32 space-y-0.5 overflow-y-auto rounded-dd bg-dd-bg-alt px-2 py-1.5 font-mono text-[10px] text-dd-muted">
                  {logTail.map((line, i) => (
                    <div key={`${i}-${line.slice(0, 24)}`} className="truncate">
                      {line}
                    </div>
                  ))}
                </div>
              ) : null}

              {phase === "success" ? (
                <p className="mb-3 text-xs text-dd-success">
                  Install succeeded. Waiting for the app to come back, then reloading…
                </p>
              ) : (
                <p className="mb-3 text-xs text-dd-muted">
                  Keep this tab open. Do not close the browser until the update finishes.
                </p>
              )}

              {phase !== "success" ? (
                <button
                  type="button"
                  onClick={() => {
                    clearTimers();
                    setMode("manual");
                    setPhase("failed");
                  }}
                  className={MUTED_TOGGLE}
                >
                  Stuck? Switch to manual install
                </button>
              ) : null}
            </>
          ) : null}

          {phase === "failed" && mode === "auto" ? (
            <>
              <div className={ERROR_BANNER} role="alert">
                {error || "Auto-update failed."}
              </div>
              <Button variant="primary" onClick={() => setMode("manual")} className="w-full">
                Open manual install
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  // ── Manual fallback ──────────────────────────────────────────────────────
  const isCountingDown = countdown > 0;
  return (
    <Card padding={false} className="relative w-full max-w-xl" aria-label={`${title} — manual`}>
        <div role="status" aria-live="polite" className="sr-only">
          {isDisconnected ? "Server stopped" : isCountingDown ? `Server stops in ${countdown} seconds` : "Manual install ready"}
        </div>
      <CardContent>
        <PanelHeader
          icon="content_copy"
          iconTone="warning"
          title={title}
          subtitle={
            isDisconnected
              ? "Server stopped. Paste the command into a terminal to install."
              : isCountingDown
                ? `Command copied. Server will stop in ${countdown}s…`
                : error
                  ? "Auto-update unavailable — install manually."
                  : `Copy the install command, stop the server, then re-run ${UPDATER_CONFIG.npmPackageName}.`
          }
        />

        {error ? (
          <div className="mb-3 rounded-dd border border-dd-warning/30 bg-dd-warning/10 px-3 py-2 text-xs text-dd-warning" role="alert">
            {error}
          </div>
        ) : null}

        <p className="mb-2 text-sm text-dd-text">Install command:</p>
        <div className="mb-4 w-full rounded-dd bg-dd-bg-alt px-3 py-2">
          <code className="break-all font-mono text-xs text-dd-accent-2">{installCmd}</code>
        </div>

        <ol className="mb-4 list-decimal space-y-1 pl-5 text-xs text-dd-muted">
          <li>
            Click <strong className="font-semibold text-dd-text">Copy &amp; Shutdown</strong> below.
          </li>
          <li>Paste the command into your terminal and press Enter.</li>
          <li>
            Run{" "}
            <code className="rounded-dd bg-dd-surface-2 px-1 py-0.5 font-mono text-[11px] text-dd-success">
              {UPDATER_CONFIG.npmPackageName}
            </code>{" "}
            again after install.
          </li>
        </ol>

        {isDisconnected ? (
          <Button variant="secondary" onClick={onReload} className="w-full" icon="refresh">
            Reload Page
          </Button>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="ghost"
              onClick={() => {
                if (!busy) onClose();
              }}
              disabled={isCountingDown}
              className="sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCopyAndShutdown}
              disabled={isCountingDown}
              className="w-full"
              icon={copied ? "check" : "content_copy"}
            >
              {copied
                ? "✓ Copied — shutting down…"
                : isCountingDown
                  ? `Shutting down in ${countdown}s`
                  : "Copy & Shutdown"}
            </Button>
          </div>
        )}

        {!isDisconnected && !isCountingDown ? (
          <button
            type="button"
            onClick={() => {
              setMode("auto");
              setPhase("idle");
              setError(null);
              setStatus(null);
            }}
            className={MUTED_TOGGLE}
          >
            Try automatic update instead
          </button>
        ) : null}
      </CardContent>
      {!isDisconnected ? (
        <IconButton
          icon="close"
          label="Close update panel"
          variant="ghost"
          size="sm"
          onClick={() => {
            if (!busy) onClose();
          }}
          className="absolute right-2 top-2"
        />
      ) : null}
    </Card>
  );
}

UpdatePanel.propTypes = {
  currentVersion: PropTypes.string,
  latestVersion: PropTypes.string,
  installCmd: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
};