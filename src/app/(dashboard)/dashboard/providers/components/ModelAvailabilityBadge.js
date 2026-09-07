"use client";

/**
 * ModelAvailabilityBadge — compact inline status indicator
 *
 * Shows green when all models are operational, or amber/red when there are
 * issues, with a hover popover for details and cooldown clearing.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { createVisiblePoller } from "@/shared/utils/visiblePoller";

const STATUS_CONFIG = {
  available: { icon: "check_circle", iconClass: "text-dd-success", label: "Available" },
  cooldown: { icon: "schedule", iconClass: "text-dd-warning", label: "Cooldown" },
  unavailable: { icon: "error", iconClass: "text-dd-danger", label: "Unavailable" },
  unknown: { icon: "help", iconClass: "text-dd-muted", label: "Unknown" },
};

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

  // Group unhealthy models by provider
  const byProvider = {};
  models.forEach((m) => {
    if (m.status === "available") return;
    const key = m.provider || "unknown";
    if (!byProvider[key]) byProvider[key] = [];
    byProvider[key].push(m);
  });

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
        <div className="absolute top-full right-0 mt-2 w-80 bg-dd-surface border border-dd-border rounded-dd-lg shadow-dd-elevated z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-dd-border bg-dd-bg-alt">
            <div className="flex items-center gap-2">
              <span className={`material-symbols-outlined text-[16px] ${isHealthy ? "text-dd-success" : "text-dd-warning"}`} aria-hidden="true">
                {isHealthy ? "verified" : "warning"}
              </span>
              <span className="text-sm font-semibold text-dd-text">Model Status</span>
            </div>
            <button
              type="button"
              aria-label="Refresh model availability"
              onClick={fetchStatus}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-dd-surface text-dd-muted hover:text-dd-text transition-colors"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">refresh</span>
            </button>
          </div>

          <div tabIndex={0} aria-label="Model availability details" className="px-4 py-3 max-h-60 overflow-y-auto" role="region">
            {isHealthy ? (
              <p className="text-sm text-dd-muted text-center py-2">
                All models are responding normally.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {Object.entries(byProvider).map(([provider, provModels]) => (
                  <div key={provider}>
                    <p className="text-xs font-semibold text-dd-text mb-1.5 capitalize">{provider}</p>
                    <div className="flex flex-col gap-1">
                      {provModels.map((m) => {
                        const status = STATUS_CONFIG[m.status] || STATUS_CONFIG.unknown;
                        const isClearing = clearing === `${m.provider}:${m.model}`;
                        return (
                          <div
                            key={`${m.provider}-${m.model}`}
                            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-dd-surface/30"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`material-symbols-outlined shrink-0 text-[14px] ${status.iconClass}`} aria-hidden="true">
                                {status.icon}
                              </span>
                              <span className="font-mono text-xs text-dd-text truncate">{m.model}</span>
                            </div>
                            {m.status === "cooldown" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleClearCooldown(m.provider, m.model)}
                                disabled={isClearing}
                                className="text-[10px] px-1.5! py-0.5! ml-2"
                              >
                                {isClearing ? "..." : "Clear"}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
