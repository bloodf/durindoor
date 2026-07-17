"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import Button from "./Button";
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
export default function UpdatePanel({
  currentVersion,
  latestVersion,
  installCmd,
  onClose,
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

  useEffect(() => () => {
    cancelledRef.current = true;
    clearTimers();
  }, [clearTimers]);

  const failToManual = useCallback((message) => {
    clearTimers();
    setError(message);
    setPhase("failed");
    setMode("manual");
  }, [clearTimers]);

  const startStatusPoll = useCallback(() => {
    clearTimers();
    const origin = typeof window !== "undefined" ? window.location.origin : null;
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
        if (statusNotBeforeRef.current && !isUpdaterStatusCurrent(data, statusNotBeforeRef.current)) {
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
                  globalThis.location.reload();
                  return;
                }
              } catch { /* server still coming up */ }
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
  }, [clearTimers, failToManual]);

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
    } catch { /* clipboard blocked */ }
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

  const progress = getUpdaterProgressPercent(status || { phase: phase === "starting" ? "starting" : null });
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
  const title = `Update ${APP_CONFIG.name}${latestVersion ? ` to v${latestVersion}` : ""}`;

  // ── Auto mode (default) ──────────────────────────────────────────────────
  if (mode === "auto") {
    return (
      <div className="w-full max-w-xl rounded-xl bg-neutral-900/95 border border-white/10 p-6 text-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center size-11 rounded-full bg-green-500/20 text-green-400">
            <span className="material-symbols-outlined text-[24px]">
              {phase === "success" ? "check_circle" : "system_update"}
            </span>
          </div>
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-xs text-white/60">
              One-click install. The app will stop, update, and restart automatically.
            </p>
          </div>
        </div>

        {phase === "idle" && (
          <>
            <ul className="text-xs text-white/70 space-y-1.5 list-disc list-inside mb-4">
              <li>Works with the production <code className="px-1 rounded bg-white/10">{UPDATER_CONFIG.npmPackageName}</code> CLI install</li>
              <li>Takes about 1–2 minutes (npm global install + restart)</li>
              <li>You can switch to manual install if auto fails</li>
            </ul>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="secondary" onClick={onClose} className="sm:w-auto">
                Cancel
              </Button>
              <Button variant="primary" fullWidth onClick={startAutoUpdate}>
                Update & Restart
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className="mt-3 w-full text-center text-[11px] text-white/50 hover:text-white/80 transition-colors"
            >
              Prefer manual install instead?
            </button>
          </>
        )}

        {busy && (
          <>
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-white/80">{phaseLabel}</span>
                <span className="text-white/50 tabular-nums">{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, progress)}%` }}
                />
              </div>
            </div>

            {logTail.length > 0 && (
              <div className="mb-3 max-h-32 overflow-y-auto rounded bg-black/40 px-2 py-1.5 font-mono text-[10px] text-white/60 space-y-0.5">
                {logTail.map((line, i) => (
                  <div key={`${i}-${line.slice(0, 24)}`} className="truncate">{line}</div>
                ))}
              </div>
            )}

            {phase === "success" ? (
              <p className="text-xs text-green-400/90 mb-3">
                Install succeeded. Waiting for the app to come back, then reloading…
              </p>
            ) : (
              <p className="text-xs text-white/50 mb-3">
                Keep this tab open. Do not close the browser until the update finishes.
              </p>
            )}

            {phase !== "success" && (
              <button
                type="button"
                onClick={() => {
                  clearTimers();
                  setMode("manual");
                  setPhase("failed");
                }}
                className="w-full text-center text-[11px] text-white/50 hover:text-white/80 transition-colors"
              >
                Stuck? Switch to manual install
              </button>
            )}
          </>
        )}

        {phase === "failed" && mode === "auto" && (
          <>
            <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error || "Auto-update failed."}
            </div>
            <Button variant="primary" fullWidth onClick={() => setMode("manual")}>
              Open manual install
            </Button>
          </>
        )}
      </div>
    );
  }

  // ── Manual fallback ──────────────────────────────────────────────────────
  const isCountingDown = countdown > 0;
  return (
    <div className="w-full max-w-xl rounded-xl bg-neutral-900/95 border border-white/10 p-6 text-white">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center size-11 rounded-full bg-amber-500/20 text-amber-400">
          <span className="material-symbols-outlined text-[24px]">content_copy</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-xs text-white/60">
            {isDisconnected
              ? "Server stopped. Paste the command into a terminal to install."
              : isCountingDown
                ? `Command copied. Server will stop in ${countdown}s...`
                : error
                  ? "Auto-update unavailable — install manually."
                  : `Copy the install command, stop the server, then re-run ${UPDATER_CONFIG.npmPackageName}.`}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {error}
        </div>
      )}

      <p className="text-sm text-white/80 mb-2">Install command:</p>
      <div className="w-full px-3 py-2 rounded bg-white/5 mb-4">
        <code className="text-xs font-mono text-amber-400 break-all">{installCmd}</code>
      </div>

      <ol className="text-xs text-white/70 space-y-1 list-decimal list-inside mb-4">
        <li>Click <strong>Copy & Shutdown</strong> below.</li>
        <li>Paste the command into your terminal and press Enter.</li>
        <li>Run <code className="px-1 rounded bg-white/10 text-green-400">{UPDATER_CONFIG.npmPackageName}</code> again after install.</li>
      </ol>

      {isDisconnected ? (
        <Button variant="secondary" fullWidth onClick={() => globalThis.location.reload()}>
          Reload Page
        </Button>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              if (!busy) onClose();
            }}
            disabled={isCountingDown}
            className="sm:w-auto"
          >
            Cancel
          </Button>
          <Button variant="primary" fullWidth onClick={handleCopyAndShutdown} disabled={isCountingDown}>
            {copied ? "✓ Copied — shutting down..." : isCountingDown ? `Shutting down in ${countdown}s` : "Copy & Shutdown"}
          </Button>
        </div>
      )}

      {!isDisconnected && !isCountingDown && (
        <button
          type="button"
          onClick={() => {
            setMode("auto");
            setPhase("idle");
            setError(null);
            setStatus(null);
          }}
          className="mt-3 w-full text-center text-[11px] text-white/50 hover:text-white/80 transition-colors"
        >
          Try automatic update instead
        </button>
      )}
    </div>
  );
}

UpdatePanel.propTypes = {
  currentVersion: PropTypes.string,
  latestVersion: PropTypes.string,
  installCmd: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
};
