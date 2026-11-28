import { useState, useEffect, useRef } from "react";
import { isBrowser } from "../../../../../../shared/utils/typeChecks.js";
import { REFRESH_INTERVAL_MS, AUTO_REFRESH_STORAGE_KEY, createAutoRefreshScheduler } from "./utils";

export const REFRESH_INTERVAL_S = REFRESH_INTERVAL_MS / 1000;

/** Auto-refresh preference, countdown and the scheduler that drives refreshAllRef. */
export function useAutoRefresh(refreshAllRef) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [hasHydratedAutoRefresh, setHasHydratedAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_S);
  const schedulerRef = useRef(null);

  useEffect(() => {
    if (!isBrowser()) return;
    const stored = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    setAutoRefresh(stored === null ? true : stored === "true");
    setHasHydratedAutoRefresh(true);
  }, []);

  // Persist auto-refresh preference
  useEffect(() => {
    if (!isBrowser() || !hasHydratedAutoRefresh) return;
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(autoRefresh));
  }, [autoRefresh, hasHydratedAutoRefresh]);

  // One scheduler owns refresh + countdown timers and pauses on tab-hidden,
  // deriving the countdown from an absolute deadline so buffered tunnels stay
  // stable across visibility changes. Replaces the prior dual-setInterval logic.
  useEffect(() => {
    if (!hasHydratedAutoRefresh || !autoRefresh) {
      schedulerRef.current?.stop();
      schedulerRef.current = null;
      setCountdown(Math.ceil(REFRESH_INTERVAL_MS / 1000));
      return;
    }

    const scheduler = createAutoRefreshScheduler({
      intervalMs: REFRESH_INTERVAL_MS,
      onRefresh: (force) => refreshAllRef.current?.(force),
      onCountdown: setCountdown
    });
    schedulerRef.current = scheduler;
    scheduler.start();

    const handleVisibilityChange = () => {
      if (document.hidden) scheduler.pause();else
      void scheduler.resume();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      scheduler.stop();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [autoRefresh, hasHydratedAutoRefresh, refreshAllRef]);

  return { autoRefresh, setAutoRefresh, countdown, setCountdown, schedulerRef };
}
