"use client";

/**
 * ModelAvailabilityBadge — compact inline status indicator
 *
 * Shows green when all models are operational, or amber/red when there are
 * issues, with a hover popover for details and cooldown clearing.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { useNotificationStore } from "@/store/notificationStore";
import { createVisiblePoller } from "@/shared/utils/visiblePoller";

const STATUS_CONFIG = {
  available: { icon: "check_circle", iconClass: "text-dd-success", label: "Available" },
  cooldown: { icon: "schedule", iconClass: "text-dd-warning", label: "Cooldown" },
  unavailable: { icon: "error", iconClass: "text-dd-danger", label: "Unavailable" },
  unknown: { icon: "help", iconClass: "text-dd-muted", label: "Unknown" },
};
function modelLabel(model) {
  if (model.model !== "__all") return model.model;
  return model.status === "unavailable" ? "Account unavailable" : "All models";
}

function retryLabel(until) {
  if (!until) return null;
  const retryAt = new Date(until);
  if (Number.isNaN(retryAt.getTime())) return null;
  return `Retry at ${retryAt.toLocaleString()}`;
}

function groupModels(models) {
  const providers = new Map();
  const seenAllScope = new Set();

  for (const model of models) {
    if (model.status === "available") continue;
    const provider = model.provider || "unknown";
    const accountKey = model.connectionId || model.connectionName || "unknown";
    if (model.model === "__all") {
      const duplicateKey = `${provider}:${accountKey}:${model.status}:${model.until || ""}:${model.lastError || ""}`;
      if (seenAllScope.has(duplicateKey)) continue;
      seenAllScope.add(duplicateKey);
    }

    if (!providers.has(provider)) providers.set(provider, new Map());
    const accounts = providers.get(provider);
    if (!accounts.has(accountKey)) {
      accounts.set(accountKey, {
        name: model.connectionName || model.connectionId || "Unknown account",
        models: [],
      });
    }
    accounts.get(accountKey).models.push(model);
  }

  return providers;
}

export default function ModelAvailabilityBadge() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [clearing, setClearing] = useState(null);
  const ref = useRef(null);
  const notify = useNotificationStore();

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/models/availability");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // silent fail — will retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const poller = createVisiblePoller({ callback: fetchStatus, intervalMs: 30_000 });
    poller.start();
    return () => poller.stop();
  }, [fetchStatus]);

  // Close popover on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setExpanded(false);
    };
    if (expanded) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  const handleClearCooldown = async (provider, model) => {
    setClearing(`${provider}:${model}`);
    try {
      const res = await fetch("/api/models/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearCooldown", provider, model }),
      });
      if (res.ok) {
        notify.success(`Cooldown cleared for ${model}`);
        await fetchStatus();
      } else {
        notify.error("Failed to clear cooldown");
      }
    } catch {
      notify.error("Failed to clear cooldown");
    } finally {
      setClearing(null);
    }
  };

  if (loading) return null;

  const models = data?.models || [];
  const unavailableCount = data?.unavailableCount || models.filter((m) => m.status !== "available").length;
  const isHealthy = unavailableCount === 0;

  // connectionId keeps same-provider accounts distinct; only identical account-wide rows collapse.
  const byProvider = groupModels(models);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-haspopup="dialog"
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-dd border px-3 text-xs font-medium outline-none transition-colors focus-visible:shadow-dd-focus ${
          isHealthy
            ? "border-dd-accent/20 bg-dd-accent-soft text-dd-accent hover:bg-dd-surface-2"
            : "border-dd-warning/20 bg-dd-warning/10 text-dd-warning hover:bg-dd-surface-2"
        }`}
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[16px] leading-none">
          {isHealthy ? "verified" : "warning"}
        </span>
        {isHealthy ? "All models operational" : `${unavailableCount} model${unavailableCount !== 1 ? "s" : ""} with issues`}
      </button>

      {expanded && (
        <div
          role="dialog"
          aria-label="Model Status"
          className="absolute right-0 top-full z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-dd-lg border border-dd-border bg-dd-surface shadow-dd-elevated"
        >
          <div className="flex min-w-0 items-center gap-2 border-b border-dd-border bg-dd-bg-alt px-3 py-1.5">
            <span className={`material-symbols-outlined shrink-0 text-[16px] ${isHealthy ? "text-dd-success" : "text-dd-warning"}`} aria-hidden="true">
              {isHealthy ? "verified" : "warning"}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-dd-text">Model Status</span>
            <IconButton
              icon="refresh"
              label="Refresh model availability"
              size="sm"
              onClick={fetchStatus}
            />
          </div>

          <div tabIndex={0} aria-label="Model availability details" className="max-h-72 overflow-y-auto overflow-x-hidden px-3 py-3" role="region">
            {isHealthy ? (
              <p className="py-2 text-center text-sm text-dd-muted">
                All models are responding normally.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {Array.from(byProvider, ([provider, accounts]) => (
                  <section key={provider} aria-label={`${provider} availability`}>
                    <h3 className="mb-1.5 text-xs font-semibold capitalize text-dd-text">{provider}</h3>
                    <div className="flex flex-col gap-2">
                      {Array.from(accounts, ([accountKey, account]) => (
                        <div key={accountKey} className="rounded-lg bg-dd-surface/30 px-2.5 py-2">
                          <p className="break-words text-xs font-medium text-dd-text">{account.name}</p>
                          <div className="mt-1.5 flex flex-col gap-2">
                            {account.models.map((m, index) => {
                              const status = STATUS_CONFIG[m.status] || STATUS_CONFIG.unknown;
                              const isClearing = clearing === `${m.provider}:${m.model}`;
                              const retry = retryLabel(m.until);
                              return (
                                <div key={`${m.model}-${m.status}-${m.until || ""}-${index}`} className="flex min-w-0 items-start gap-2">
                                  <span className={`material-symbols-outlined mt-0.5 shrink-0 text-[14px] ${status.iconClass}`} aria-hidden="true">
                                    {status.icon}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="break-words font-mono text-xs text-dd-text">{modelLabel(m)}</p>
                                    <p className="text-[11px] text-dd-muted">{status.label}</p>
                                    {m.lastError ? <p className="break-words text-[11px] text-dd-muted">{m.lastError}</p> : null}
                                    {retry ? <p className="text-[11px] text-dd-muted">{retry}</p> : null}
                                  </div>
                                  {m.status === "cooldown" && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleClearCooldown(m.provider, m.model)}
                                      aria-label={`Clear ${modelLabel(m)} cooldown across all ${m.provider} accounts`}
                                      title={`Clears this cooldown across all ${m.provider} accounts`}
                                      disabled={isClearing}
                                      className="ml-auto max-w-36 shrink-0 whitespace-normal text-xs leading-tight"
                                    >
                                      {isClearing ? "Clearing…" : "Clear provider-wide cooldown"}
                                    </Button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
