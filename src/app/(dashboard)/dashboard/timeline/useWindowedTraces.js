"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createLiveReloadScheduler } from "./href.js";

const WINDOW_PAGE_SIZE = "100";
const NOW_TICK_MS = 5000;

/**
 * Merge `incoming` traces into `existing` by id (incoming fields win), drop
 * traces that started before `minStartMs`, and return newest first.
 */
export function upsertTraces(existing, incoming, minStartMs = null) {
  const byId = new Map();
  for (const trace of existing || []) if (trace?.id != null) byId.set(trace.id, trace);
  for (const trace of incoming || []) {
    if (trace?.id == null) continue;
    byId.set(trace.id, { ...byId.get(trace.id), ...trace });
  }
  const startOf = (trace) => Date.parse(trace.started_at);
  return [...byId.values()]
    .filter((trace) => minStartMs == null || startOf(trace) >= minStartMs)
    .sort((a, b) => (startOf(b) || 0) - (startOf(a) || 0));
}

/**
 * Traces for the swimlane: the newest 100 rows that started in the last
 * `windowMs`, filtered by `filterQuery` (URL query without dates). Live
 * refreshes re-query the window and upsert by id instead of replacing, and
 * are skipped while the initial load for the same window is in flight.
 */
export function useWindowedTraces({ enabled, filterQuery, windowMs, live }) {
  const [traces, setTraces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [captureOn, setCaptureOn] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const loadRef = useRef(null);
  const refreshRef = useRef(null);

  const fetchWindow = useCallback(async (merge) => {
    if (merge && loadRef.current) return;
    const owner = merge ? refreshRef : loadRef;
    if (!merge) refreshRef.current?.abort();
    owner.current?.abort();
    const controller = new AbortController();
    owner.current = controller;
    const now = Date.now();
    const windowStartMs = now - windowMs;
    const params = new URLSearchParams(filterQuery);
    params.set("startDate", new Date(windowStartMs).toISOString());
    params.set("endDate", new Date(now).toISOString());
    params.set("page", "1");
    params.set("pageSize", WINDOW_PAGE_SIZE);
    if (!merge) {
      setLoading(true);
      setError("");
    }
    try {
      const settingsRequest = merge ? null : fetch("/api/settings", { cache: "no-store", signal: controller.signal });
      const response = await fetch(`/api/timeline?${params.toString()}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Failed to load timeline");
      const body = await response.json();
      if (controller.signal.aborted) return;
      setNowMs(now);
      setTraces((previous) => upsertTraces(merge ? previous : [], body.traces, windowStartMs));
      setError("");
      if (settingsRequest) {
        const settingsRes = await settingsRequest;
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          if (!controller.signal.aborted) setCaptureOn(settings.enableProxyTimeline === true);
        }
      }
    } catch (err) {
      if (err?.name !== "AbortError") setError(err?.message || "Failed to load timeline");
    } finally {
      if (owner.current === controller) {
        owner.current = null;
        if (!merge) setLoading(false);
      }
    }
  }, [filterQuery, windowMs]);

  useEffect(() => {
    if (!enabled) return undefined;
    fetchWindow(false);
    return () => {
      loadRef.current?.abort();
      refreshRef.current?.abort();
      loadRef.current = null;
      refreshRef.current = null;
    };
  }, [enabled, fetchWindow]);

  useEffect(() => {
    if (!enabled || !live) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, [enabled, live]);

  const liveRefresh = useMemo(() => createLiveReloadScheduler(() => fetchWindow(true)), [fetchWindow]);

  return { traces, loading, error, captureOn, nowMs, windowStart: nowMs - windowMs, liveRefresh };
}
