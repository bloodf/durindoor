import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let timeline;
let mainDb;

async function setSettings(settings) {
  const db = await import("@/lib/db/driver.js");
  const adapter = await db.getAdapter();
  adapter.run(
    `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    [JSON.stringify(settings)],
  );
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-proxy-timeline-repo-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete global._proxyTimelineAdapter;
  vi.resetModules();
  const db = await import("@/lib/db/driver.js");
  mainDb = await db.getAdapter();
  await setSettings({ enableProxyTimeline: true, proxyTimelineRetentionDays: 7 });
  timeline = await import("@/lib/db/repos/proxyTimelineRepo.js");
});

afterEach(async () => {
  try { await global._proxyTimelineAdapter?.instance?.close?.(); } catch {}
  try { await global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._proxyTimelineAdapter;
  delete global._dbAdapter;
  vi.resetModules();
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("proxy timeline repository", () => {
  it("stores ordered events for a finished trace", async () => {
    const id = "ordered";
    timeline.startTrace({ id, provider: "p" });
    timeline.record({ traceId: id, type: "request", direction: "out", summary: "one" });
    timeline.record({ traceId: id, type: "response", direction: "in", summary: "two" });
    timeline.finishTrace({ id, status: "ok" });
    await timeline.flushProxyTimelineForTests();
    const trace = await timeline.getTrace(id);
    expect(trace.status).toBe("ok");
    expect(trace.events.map((event) => event.summary)).toEqual(["one", "two"]);
    expect(trace.events.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("does not enqueue when capture is disabled", async () => {
    await setSettings({ enableProxyTimeline: false });
    timeline.record({ traceId: "off", type: "request", direction: "in" });
    await timeline.flushProxyTimelineForTests();
    expect(await timeline.getTrace("off")).toBeNull();
  });

  it("does not create the sidecar while capture is disabled", async () => {
    await setSettings({ enableProxyTimeline: false, proxyTimelineRetentionDays: 7 });
    const { currentProxyTimelineFile } = await import("@/lib/db/paths.js");
    const file = currentProxyTimelineFile();
    expect(fs.existsSync(file)).toBe(false);
    await timeline.pruneExpired();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("reads trace metadata without loading event payloads", async () => {
    timeline.startTrace({ id: "meta-only", provider: "openai" });
    timeline.record({ traceId: "meta-only", type: "sse_chunk", payload: "large payload" });
    await timeline.flushProxyTimelineForTests();
    const { getProxyTimelineAdapter } = await import("@/lib/db/proxyTimelineDb.js");
    const adapter = await getProxyTimelineAdapter();
    const all = vi.spyOn(adapter, "all");
    const trace = await timeline.getTraceMeta("meta-only");
    expect(trace).toMatchObject({ id: "meta-only", provider: "openai" });
    expect(trace).not.toHaveProperty("events");
    expect(all).not.toHaveBeenCalled();
    all.mockRestore();
  });

  it("keeps recording after start without reading settings again", async () => {
    const settings = await import("@/lib/db/repos/settingsRepo.js");
    timeline.startTrace({ id: "cached" });
    vi.spyOn(settings, "getSettingsSync").mockImplementation(() => { throw new Error("hot path query"); });
    timeline.record({ traceId: "cached", type: "request", direction: "in" });
    await timeline.flushProxyTimelineForTests();
    expect((await timeline.getTrace("cached")).events).toHaveLength(1);
  });

  it("stops recording after finish", async () => {
    timeline.startTrace({ id: "finished" });
    timeline.finishTrace({ id: "finished" });
    timeline.record({ traceId: "finished", type: "response", direction: "in" });
    await timeline.flushProxyTimelineForTests();
    expect((await timeline.getTrace("finished")).events).toHaveLength(0);
  });
  it("clears queued traces and accepts traces afterward", async () => {
    timeline.startTrace({ id: "discarded" });
    timeline.record({ traceId: "discarded", type: "request", direction: "in" });
    await timeline.clearTraces();
    await timeline.flushProxyTimelineForTests();
    expect((await timeline.listTraces()).traces).toEqual([]);

    timeline.startTrace({ id: "after-clear" });
    timeline.record({ traceId: "after-clear", type: "request", direction: "in" });
    await timeline.flushProxyTimelineForTests();
    expect((await timeline.listTraces()).traces.map((trace) => trace.id)).toEqual(["after-clear"]);
  });

  it("discards flush batches started before clearTraces", async () => {
    const dbModule = await import("@/lib/db/proxyTimelineDb.js");
    const real = await dbModule.getProxyTimelineAdapter();
    timeline.startTrace({ id: "race" });
    timeline.record({ traceId: "race", type: "request", direction: "in" });
    let releaseFirstCall;
    let enteredAdapter;
    const gate = new Promise((resolve) => { releaseFirstCall = resolve; });
    const entered = new Promise((resolve) => { enteredAdapter = resolve; });
    let first = true;
    const spy = vi.spyOn(dbModule, "getProxyTimelineAdapter").mockImplementation(async () => {
      if (first) { first = false; enteredAdapter(); await gate; }
      return real;
    });
    const flushPromise = timeline.flushProxyTimelineForTests();
    await entered;
    expect(timeline.getQueueLengthForTests()).toBe(0);
    const clearPromise = timeline.clearTraces();
    releaseFirstCall();
    await Promise.all([flushPromise, clearPromise]);
    spy.mockRestore();
    expect((await timeline.listTraces()).traces).toEqual([]);
  });

  it("requeues a batch when opening the sidecar fails", async () => {
    const dbModule = await import("@/lib/db/proxyTimelineDb.js");
    const real = await dbModule.getProxyTimelineAdapter();
    const spy = vi.spyOn(dbModule, "getProxyTimelineAdapter").mockRejectedValueOnce(new Error("sidecar unavailable"));
    timeline.startTrace({ id: "retry-open" });
    timeline.record({ traceId: "retry-open", type: "request", direction: "in" });

    await timeline.flushProxyTimelineForTests();
    expect(timeline.getQueueLengthForTests()).toBe(2);

    spy.mockResolvedValue(real);
    await timeline.flushProxyTimelineForTests();
    spy.mockRestore();
    expect((await timeline.getTrace("retry-open")).events).toHaveLength(1);
  });

  it("automatically retries a sidecar-open failure without a manual second flush", async () => {
    vi.useFakeTimers();
    try {
      const dbModule = await import("@/lib/db/proxyTimelineDb.js");
      const real = await dbModule.getProxyTimelineAdapter();
      const spy = vi.spyOn(dbModule, "getProxyTimelineAdapter")
        .mockRejectedValueOnce(new Error("sidecar unavailable"));
      timeline.startTrace({ id: "auto-retry-open" });

      await vi.advanceTimersByTimeAsync(300);
      spy.mockResolvedValue(real);

      await vi.advanceTimersByTimeAsync(300);
      spy.mockRestore();
      expect(timeline.getQueueLengthForTests()).toBe(0);
      const trace = await timeline.getTrace("auto-retry-open");
      expect(trace.id).toBe("auto-retry-open");
    } finally { vi.useRealTimers(); }
  });

  it("backs off a failed real transaction and rolls back its batch before retrying", async () => {
    vi.useFakeTimers();
    let run;
    let setImmediate;
    try {
      const { getProxyTimelineAdapter } = await import("@/lib/db/proxyTimelineDb.js");
      const adapter = await getProxyTimelineAdapter();
      const originalRun = adapter.run.bind(adapter);
      setImmediate = vi.spyOn(global, "setImmediate");
      let failEventInsert = true;
      run = vi.spyOn(adapter, "run").mockImplementation((sql, params) => {
        if (failEventInsert && sql.startsWith("INSERT OR IGNORE INTO events")) {
          failEventInsert = false;
          setImmediate.mockClear();
          return originalRun("INSERT INTO traces(id, started_at) VALUES (?, NULL)", ["rollback-failure"]);
        }
        return originalRun(sql, params);
      });
      timeline.startTrace({ id: "auto-retry-tx" });
      for (let i = 0; i < 49; i++) timeline.record({ traceId: "auto-retry-tx", type: "request", direction: "in" });

      await vi.advanceTimersByTimeAsync(0);
      expect(setImmediate).not.toHaveBeenCalled();
      expect(timeline.getQueueLengthForTests()).toBe(50);
      expect(adapter.get("SELECT COUNT(*) AS count FROM traces WHERE id = ?", ["auto-retry-tx"]).count).toBe(0);
      expect(adapter.get("SELECT COUNT(*) AS count FROM events WHERE trace_id = ?", ["auto-retry-tx"]).count).toBe(0);

      run.mockRestore();
      await vi.advanceTimersByTimeAsync(250);
      expect(timeline.getQueueLengthForTests()).toBe(0);
      expect((await timeline.getTrace("auto-retry-tx")).events).toHaveLength(49);
    } finally {
      run?.mockRestore();
      setImmediate?.mockRestore();
      vi.useRealTimers();
    }
  });


  it("fails open after sidecar closes", async () => {
    const { getProxyTimelineAdapter } = await import("@/lib/db/proxyTimelineDb.js");
    const adapter = await getProxyTimelineAdapter();
    await adapter.close();
    expect(() => timeline.record({ traceId: "closed", type: "request", direction: "in" })).not.toThrow();
    expect(() => timeline.startTrace({ id: "closed" })).not.toThrow();
  });

  it("flushes no more than fifty queued rows at once", async () => {
    timeline.startTrace({ id: "batch" });
    for (let i = 0; i < 60; i++) timeline.record({ traceId: "batch", type: "sse_chunk", direction: "in", summary: String(i) });
    await timeline.flushProxyTimelineForTests();
    let trace = await timeline.getTrace("batch");
    expect(trace.events).toHaveLength(49);
    await timeline.flushProxyTimelineForTests();
    trace = await timeline.getTrace("batch");
    expect(trace.events).toHaveLength(60);
  });

  it("awaits an in-flight flush instead of returning immediately", async () => {
    const dbModule = await import("@/lib/db/proxyTimelineDb.js");
    const real = await dbModule.getProxyTimelineAdapter();
    timeline.startTrace({ id: "inflight" });
    for (let i = 0; i < 49; i++) timeline.record({ traceId: "inflight", type: "sse_chunk", direction: "in", summary: String(i) });
    let release = () => {};
    let entered;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { entered = resolve; });
    let first = true;
    const spy = vi.spyOn(dbModule, "getProxyTimelineAdapter").mockImplementation(async () => {
      if (first) { first = false; entered(); await gate; }
      return real;
    });
    try {
      let joinedSettled = false;
      const scheduled = timeline.flushProxyTimelineForTests();
      await started;
      const joined = timeline.flushProxyTimelineForTests().then((value) => {
        joinedSettled = true;
        return value;
      });
      expect(timeline.getQueueLengthForTests()).toBe(0);
      await new Promise((resolve) => setImmediate(resolve));
      expect(joinedSettled).toBe(false);
      release();
      await Promise.all([scheduled, joined]);
      expect(joinedSettled).toBe(true);
      expect((await timeline.getTrace("inflight")).events).toHaveLength(49);
    } finally {
      release();
      spy.mockRestore();
    }
  });

  it("drops chunks but preserves error hops when queue is full", async () => {
    timeline.startTrace({ id: "overflow" });
    for (let i = 0; i < 10_000; i++) timeline.record({ traceId: "overflow", type: "sse_chunk", direction: "in", summary: String(i) });
    timeline.record({ traceId: "overflow", type: "sse_chunk", direction: "in", summary: "drop me" });
    timeline.record({ traceId: "overflow", type: "error", direction: "in", summary: "keep me" });
    expect(timeline.getQueueLengthForTests()).toBeLessThanOrEqual(10_000);
    for (let i = 0; i < 205; i++) await timeline.flushProxyTimelineForTests();
    const trace = await timeline.getTrace("overflow");
    expect(trace.truncated).toBe(1);
    expect(trace.events.some((event) => event.type === "error" && event.summary === "keep me")).toBe(true);
    expect(trace.events.some((event) => event.payload?._dropped > 0)).toBe(true);
  }, 15_000);

  it("persists a drop marker in the batch that has room for it", async () => {
    timeline.startTrace({ id: "marker-cap" });
    for (let i = 0; i < 10_000; i++) timeline.record({ traceId: "marker-cap", type: "sse_chunk", direction: "in" });
    timeline.record({ traceId: "marker-cap", type: "sse_chunk", direction: "in" });
    await timeline.flushProxyTimelineForTests();
    const { getProxyTimelineAdapter } = await import("@/lib/db/proxyTimelineDb.js");
    const events = (await getProxyTimelineAdapter()).all("SELECT * FROM events WHERE trace_id=?", ["marker-cap"]);
    expect(events.length).toBeLessThanOrEqual(50);
    expect(events.some((e) => e.direction === "system" && e.summary?.startsWith("dropped "))).toBe(true);
  });

  it("defers a drop marker whose trace start sits at the batch boundary", async () => {
    timeline.startTrace({ id: "A" });
    for (let i = 0; i < 48; i++) timeline.record({ traceId: "A", type: "sse_chunk", direction: "in" });
    timeline.startTrace({ id: "B" });
    for (let i = 0; i < 9_950; i++) timeline.record({ traceId: "B", type: "sse_chunk", direction: "in" });
    timeline.record({ traceId: "B", type: "sse_chunk", direction: "in" });
    const { getProxyTimelineAdapter } = await import("@/lib/db/proxyTimelineDb.js");
    const adapter = await getProxyTimelineAdapter();
    await timeline.flushProxyTimelineForTests();
    expect(adapter.all("SELECT * FROM events WHERE trace_id=?", ["B"])).toHaveLength(0);
    await timeline.flushProxyTimelineForTests();
    const events = adapter.all("SELECT * FROM events WHERE trace_id=?", ["B"]);
    expect(events.some((e) => e.direction === "system")).toBe(true);
  });

  it("persists dropped frames after finish before flush", async () => {
    timeline.startTrace({ id: "finished-overflow" });
    for (let i = 0; i < 10_000; i++) timeline.record({ traceId: "finished-overflow", type: "sse_chunk", direction: "in" });
    timeline.record({ traceId: "finished-overflow", type: "sse_chunk", direction: "in" });
    timeline.finishTrace("finished-overflow");
    for (let i = 0; i < 201; i++) await timeline.flushProxyTimelineForTests();
    const trace = await timeline.getTrace("finished-overflow");
    const seqs = trace.events.map((event) => event.seq);
    expect(trace.events.some((event) => event.direction === "system")).toBe(true);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  }, 15_000);

  it("persists dropped frames for two finished traces sharing batches", async () => {
    timeline.startTrace({ id: "double-A" });
    timeline.startTrace({ id: "double-B" });
    for (let i = 0; i < 10_000; i++) timeline.record({ traceId: "double-A", type: "sse_chunk", direction: "in" });
    for (let i = 0; i < 10_000; i++) timeline.record({ traceId: "double-B", type: "sse_chunk", direction: "in" });
    timeline.record({ traceId: "double-A", type: "sse_chunk", direction: "in" });
    timeline.record({ traceId: "double-B", type: "sse_chunk", direction: "in" });
    timeline.finishTrace("double-A");
    timeline.finishTrace("double-B");
    for (let i = 0; i < 402; i++) await timeline.flushProxyTimelineForTests();
    for (const id of ["double-A", "double-B"]) {
      const trace = await timeline.getTrace(id);
      const seqs = trace.events.map((event) => event.seq);
      expect(trace.events.some((event) => event.direction === "system")).toBe(true);
      expect(new Set(seqs).size).toBe(seqs.length);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    }
  }, 15_000);

  it("cleans sequence state after deferred finished-trace markers drain", async () => {
    const ids = Array.from({ length: 205 }, (_, index) => `marker-finish-${index}`);
    for (const id of ids) timeline.startTrace({ id });
    for (let round = 0; round < 50; round++) for (const id of ids) timeline.record({ traceId: id, type: "sse_chunk", direction: "in" });
    for (const id of ids) timeline.record({ traceId: id, type: "sse_chunk", direction: "in" });
    for (const id of ids) timeline.finishTrace(id);
    for (let index = 0; index < 500; index++) await timeline.flushProxyTimelineForTests();
    const lastId = "marker-finish-159";
    const { getProxyTimelineAdapter } = await import("@/lib/db/proxyTimelineDb.js");
    const adapter = await getProxyTimelineAdapter();
    expect(adapter.all("SELECT seq FROM events WHERE trace_id=?", [lastId])).toEqual(expect.arrayContaining([{ seq: 52 }]));
    await timeline.clearTraces();
    timeline.startTrace({ id: lastId });
    timeline.record({ traceId: lastId, type: "request", direction: "in" });
    await timeline.flushProxyTimelineForTests();
    expect((await timeline.getTrace(lastId)).events.map(({ seq }) => seq)).toEqual([1]);
  }, 15_000);
  it("does not write events or drop markers without a trace start", async () => {
    for (let i = 0; i < 10_001; i++) timeline.record({ traceId: "never-started", type: "sse_chunk", direction: "in" });
    await timeline.flushProxyTimelineForTests();
    const { getProxyTimelineAdapter } = await import("@/lib/db/proxyTimelineDb.js");
    expect((await getProxyTimelineAdapter()).all("SELECT * FROM events WHERE trace_id=?", ["never-started"])).toEqual([]);
  });

  it("redacts trace endpoints before persistence", async () => {
    timeline.startTrace({ id: "redacted-endpoint", endpoint: "https://api.example.com/v1?api_key=secret" });
    await timeline.flushProxyTimelineForTests();
    const { getProxyTimelineAdapter } = await import("@/lib/db/proxyTimelineDb.js");
    const row = (await getProxyTimelineAdapter()).get("SELECT endpoint FROM traces WHERE id=?", ["redacted-endpoint"]);
    expect(row.endpoint).not.toContain("secret");
  });

  it("filters traces by provider and ID query", async () => {
    timeline.startTrace({ id: "alpha-match", provider: "anthropic" });
    timeline.startTrace({ id: "beta-match", provider: "openai" });
    await timeline.flushProxyTimelineForTests();
    expect((await timeline.listTraces({ provider: "anthropic", q: "alpha" })).traces.map(({ id }) => id)).toEqual(["alpha-match"]);
  });

  it("paginates trace results with totals", async () => {
    for (const id of ["page-one", "page-two", "page-three"]) timeline.startTrace({ id });
    await timeline.flushProxyTimelineForTests();
    const result = await timeline.listTraces({ pageSize: 2, page: 1 });
    expect(result.traces).toHaveLength(2);
    expect(result.pagination).toEqual({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2, hasNext: true, hasPrev: false });
  });

  it("prunes expired traces and orphan events", async () => {
    const { getProxyTimelineAdapter } = await import("@/lib/db/proxyTimelineDb.js");
    const adapter = await getProxyTimelineAdapter();
    adapter.run(`INSERT INTO traces(id, started_at) VALUES(?, ?)`, ["old", new Date(Date.now() - 8 * 86400000).toISOString()]);
    adapter.run(`INSERT INTO events(trace_id, seq, t_ms, type, direction) VALUES(?, 1, 0, 'request', 'in')`, ["old"]);
    timeline.startTrace({ id: "fresh" });
    await timeline.flushProxyTimelineForTests();
    await timeline.pruneExpired();
    expect(await timeline.getTrace("old")).toBeNull();
    expect(await timeline.getTrace("fresh")).not.toBeNull();
    expect(adapter.get(`SELECT * FROM events WHERE trace_id = 'old'`)).toBeUndefined();
  });

  it("notifies listeners after successful writes and ignores listener errors", async () => {
    const writes = [];
    const unsubscribe = timeline.onTimelineWrite((write) => writes.push(write));
    timeline.onTimelineWrite(() => { throw new Error("listener failed"); });
    timeline.startTrace({ id: "notify" });
    timeline.record({ traceId: "notify", type: "request", direction: "in" });
    await timeline.flushProxyTimelineForTests();
    unsubscribe();
    expect(writes.some((write) => write.type === "trace")).toBe(true);
    expect(writes.some((write) => write.type === "event")).toBe(true);
  });

  it("retries persist without replaying the transaction or emitting early", async () => {
    vi.useFakeTimers();
    const writes = [];
    const unsubscribe = timeline.onTimelineWrite((write) => writes.push(write));
    let flush;
    let run;
    try {
      const { getProxyTimelineAdapter } = await import("@/lib/db/proxyTimelineDb.js");
      const adapter = await getProxyTimelineAdapter();
      const originalFlush = adapter.flush.bind(adapter);
      const originalRun = adapter.run.bind(adapter);
      flush = vi.spyOn(adapter, "flush")
        .mockRejectedValueOnce(new Error("disk full"))
        .mockImplementation(originalFlush);
      run = vi.spyOn(adapter, "run").mockImplementation(originalRun);

      timeline.startTrace({ id: "persist-fail" });
      timeline.record({ traceId: "persist-fail", type: "request", direction: "in", summary: "one" });
      await timeline.flushProxyTimelineForTests();

      expect(flush).toHaveBeenCalledTimes(1);
      expect(writes).toEqual([]);
      expect(adapter.get("SELECT event_count AS count FROM traces WHERE id=?", ["persist-fail"]).count).toBe(1);

      const eventRuns = run.mock.calls.filter(([sql]) => String(sql).includes("INSERT OR IGNORE INTO events")).length;
      await vi.advanceTimersByTimeAsync(250);

      expect(flush).toHaveBeenCalledTimes(2);
      expect(run.mock.calls.filter(([sql]) => String(sql).includes("INSERT OR IGNORE INTO events")).length).toBe(eventRuns);
      expect(writes.some((write) => write.type === "event")).toBe(true);
      expect(adapter.get("SELECT event_count AS count FROM traces WHERE id=?", ["persist-fail"]).count).toBe(1);
      expect((await timeline.getTrace("persist-fail")).events).toHaveLength(1);
    } finally {
      flush?.mockRestore();
      run?.mockRestore();
      unsubscribe();
      vi.useRealTimers();
    }
  }, 15_000);

  it("creates the sidecar with owner-only permissions", async () => {
    timeline.startTrace({ id: "mode" });
    await timeline.flushProxyTimelineForTests();
    const { currentProxyTimelineFile } = await import("@/lib/db/paths.js");
    const file = currentProxyTimelineFile();
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("redacts secrets in event summaries", async () => {
    timeline.startTrace({ id: "summary-secret" });
    timeline.record({
      traceId: "summary-secret",
      type: "request",
      direction: "out",
      summary: "POST https://api.example.com/v1/chat?api_key=sk-abc123",
    });
    await timeline.flushProxyTimelineForTests();
    const trace = await timeline.getTrace("summary-secret");
    expect(trace.events[0].summary).not.toContain("sk-abc123");
    expect(trace.events[0].summary).toMatch(/redacted/i);
  });
  it("caps a truncated payload at 1 MiB of stored bytes", async () => {
    timeline.startTrace({ id: "byte-cap" });
    timeline.record({
      traceId: "byte-cap",
      type: "sse_chunk",
      direction: "out",
      payload: "é".repeat(700_000),
    });
    await timeline.flushProxyTimelineForTests();
    const { getProxyTimelineAdapter } = await import("@/lib/db/proxyTimelineDb.js");
    const row = (await getProxyTimelineAdapter()).get("SELECT payload FROM events WHERE trace_id=?", ["byte-cap"]);
    expect(Buffer.byteLength(row.payload, "utf8")).toBeLessThanOrEqual(1024 * 1024);
    const parsed = JSON.parse(row.payload);
    expect(parsed._truncated).toBe(true);
    expect(parsed._originalSize).toBeGreaterThan(1024 * 1024);
  });
});
