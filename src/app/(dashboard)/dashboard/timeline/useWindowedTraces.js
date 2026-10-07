"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const NOW_TICK_MS = 5000;

export function upsertTraces(existing, incoming, minStartMs = null) {
  const byId = new Map();
  for (const trace of existing || []) if (trace?.id != null) byId.set(trace.id, trace);
  for (const trace of incoming || []) {
    if (trace?.id != null) byId.set(trace.id, { ...byId.get(trace.id), ...trace });
  }
  return [...byId.values()]
    .filter((trace) => minStartMs == null || Date.parse(trace.started_at) >= minStartMs)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

export function matchesTraceFilters(trace, query) {
  const fields = { provider: "provider", model: "model", connectionId: "connection_id", apiKeyId: "api_key_id", status: "status", endpoint: "endpoint" };
  for (const [key, field] of Object.entries(fields)) {
    const value = query.get(key);
    if (value && trace[field] !== value) return false;
  }
  return !query.get("q") || String(trace.id).includes(query.get("q"));
}

/** Load the newest 100, then reconcile every notified ID authoritatively.
 * A serialized queue retains notifications during initial loading and refreshes;
 * no list limit can hide a retained trace's completion or filter transition.
 */
export function useWindowedTraces({ enabled, filterQuery, windowMs, live }) {
  const [traces, setTraces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [captureOn, setCaptureOn] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const notifyRef = useRef(null);
  const tracesRef = useRef(traces);
  tracesRef.current = traces;
  const previousLive = useRef(live);
  const liveRefresh = useMemo(() => ({
    schedule(event) {
      const item = JSON.parse(event.data);
      const id = item.id || item.traceId;
      if (id) notifyRef.current?.schedule(id);
    },
    cancel() { notifyRef.current?.cancel(); },
  }), []);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    const options = { cache: "no-store", signal: controller.signal };
    const pending = new Set();
    const filters = new URLSearchParams(filterQuery);
    let busy = true;
    let timer;
    let resyncWindow = false;
    async function readWindow(now) {
      const params = new URLSearchParams(filters);
      params.set("startDate", new Date(now - windowMs).toISOString());
      params.set("endDate", new Date(now).toISOString());
      params.set("page", "1");
      params.set("pageSize", "100");
      const response = await fetch(`/api/timeline?${params}`, options);
      if (!response.ok) throw new Error("Failed to load timeline");
      return (await response.json()).traces || [];
    }
    const schedule = () => {
      if (!busy && (pending.size || resyncWindow) && !controller.signal.aborted && !timer) {
        timer = setTimeout(drain, 500);
      }
    };
    async function drain() {
      timer = null;
      if (busy || controller.signal.aborted) return;
      busy = true;
      const ids = [...pending];
      pending.clear();
      const reloadWindow = resyncWindow;
      resyncWindow = false;
      try {
        const [windowRows, updates] = await Promise.all([
          reloadWindow ? readWindow(Date.now()) : [],
          Promise.all(ids.map(async (id) => {
            const response = await fetch(`/api/timeline/${encodeURIComponent(id)}/meta`, options);
            if (response.status === 404) return { id, trace: null };
            if (!response.ok) throw new Error("Failed to load trace update");
            return { id, trace: (await response.json()).trace };
          })),
        ]);
        if (controller.signal.aborted) return;
        const now = Date.now();
        setNowMs(now);
        setTraces((previous) => {
          const replaced = new Set(ids);
          const incoming = [
            ...windowRows.filter((trace) => !replaced.has(trace.id)),
            ...updates.map((update) => update.trace).filter(Boolean),
          ].filter((trace) => matchesTraceFilters(trace, filters));
          return upsertTraces(previous.filter((trace) => !replaced.has(trace.id)), incoming, now - windowMs);
        });
        setError("");
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message || "Failed to load trace update");
      } finally {
        busy = false;
        schedule();
      }
    }
    notifyRef.current = {
      schedule(id) { pending.add(id); schedule(); },
      resume() {
        resyncWindow = true;
        const cutoff = Date.now() - windowMs;
        for (const trace of tracesRef.current) {
          if (Date.parse(trace.started_at) >= cutoff) pending.add(trace.id);
        }
        schedule();
      },
      cancel() { clearTimeout(timer); timer = null; pending.clear(); resyncWindow = false; },
    };
    setLoading(true);
    setError("");
    setTraces([]);
    (async () => {
      try {
        const now = Date.now();
        const rows = await readWindow(now);
        if (controller.signal.aborted) return;
        const resolvedNow = Date.now();
        setNowMs(resolvedNow);
        setTraces(upsertTraces([], rows, resolvedNow - windowMs).filter((trace) => matchesTraceFilters(trace, filters)));
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message || "Failed to load timeline");
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
        schedule();
      }
    })();
    fetch("/api/settings", options).then(async (response) => {
      if (!response.ok) throw new Error("Failed to load timeline settings");
      const body = await response.json();
      if (!controller.signal.aborted) setCaptureOn(body.enableProxyTimeline === true);
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => {
      notifyRef.current = null;
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, filterQuery, windowMs]);

  useEffect(() => {
    const resuming = !previousLive.current && live;
    previousLive.current = live;
    if (!enabled || !live) return undefined;
    const tick = () => {
      const now = Date.now();
      setNowMs(now);
      setTraces((previous) => upsertTraces(previous, [], now - windowMs));
    };
    tick();
    if (resuming) notifyRef.current?.resume();
    const timer = setInterval(tick, NOW_TICK_MS);
    return () => clearInterval(timer);
  }, [enabled, live, windowMs]);

  return { traces, loading, error, captureOn, nowMs, windowStart: nowMs - windowMs, liveRefresh };
}
