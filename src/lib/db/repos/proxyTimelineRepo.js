import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { getProxyTimelineAdapter } from "../proxyTimelineDb.js";
import { getSettingsSync } from "./settingsRepo.js";
import { redactValue } from "../../observability/redact.js";
import { isFunction, isString } from "../../../shared/utils/typeChecks.js";

export const QUEUE_CAP = 10_000;
export const QUEUE_BYTE_LIMIT = 32 * 1024 * 1024;
export const FLUSH_BATCH = 50;
const queue = [];
const starts = new Map();
const seqs = new Map();
const dropped = new Map();
const activeTraces = new Set();
const finishedTraces = new Set();
const flushedStarts = new Set();
const listeners = new Set();
let queuedBytes = 0;
let timer = null;
let flushGeneration = 0;
let flushPromise = null;
let pendingPersist = null;
let immediateScheduled = false;

function enabled() { try { return getSettingsSync().enableProxyTimeline === true; } catch { return false; } }
function bytes(item) { return Buffer.byteLength(JSON.stringify(item), "utf8"); }
function seq(id) { const n = (seqs.get(id) || 0) + 1; seqs.set(id, n); return n; }
function noteDrop(id) { dropped.set(id, (dropped.get(id) || 0) + 1); }
function isChunk(item) { return item.kind === "event" && item.event.type === "sse_chunk" && item.event.direction !== "system"; }

function enqueue(item) {
  const size = bytes(item);
  const over = () => queue.length >= QUEUE_CAP || queuedBytes + size > QUEUE_BYTE_LIMIT;
  if (over() && isChunk(item)) { noteDrop(item.event.traceId); return false; }
  while (over()) {
    const index = queue.findIndex(isChunk);
    if (index < 0) return false;
    const [old] = queue.splice(index, 1);
    queuedBytes -= bytes(old);
    noteDrop(old.event.traceId);
  }
  queue.push(item);
  queuedBytes += size;
  return true;
}

/** Encode and redact a payload. Oversize values store a 1 MiB envelope, not a 1 MiB character slice. */
function payload(value) {
  const redacted = redactValue(value);
  const json = JSON.stringify(redacted);
  const size = Buffer.byteLength(json, "utf8");
  const limit = 1024 * 1024;
  if (size <= limit) return { json, truncated: false };
  let lo = 0;
  let hi = json.length;
  let preview = "";
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = json.slice(0, mid);
    const envelope = JSON.stringify({ _truncated: true, _originalSize: size, _preview: candidate });
    if (Buffer.byteLength(envelope, "utf8") <= limit) {
      preview = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return {
    json: JSON.stringify({ _truncated: true, _originalSize: size, _preview: preview }),
    truncated: true,
  };
}

export function startTrace(traceOrId, fields = {}) {
  if (!enabled()) return null;
  try {
    const trace = isString(traceOrId) ? { ...fields, id: traceOrId } : (traceOrId || {});
    const id = trace.id || randomUUID();
    const startedAt = trace.started_at || new Date().toISOString();
    if (!enqueue({ kind: "trace", trace: { ...redactValue(trace), id, started_at: startedAt } })) return null;
    starts.set(id, Date.now());
    activeTraces.add(id);
    schedule();
    return id;
  } catch { return null; }
}

export function record(traceIdOrEvent, maybeEvent = {}) {
  try {
    const event = isString(traceIdOrEvent) ? { ...maybeEvent, traceId: traceIdOrEvent } : (traceIdOrEvent || {});
    if (!event?.traceId || !activeTraces.has(event.traceId)) return;
    const data = payload(event.payload ?? null);
    enqueue({ kind: "event", event: {
      traceId: event.traceId,
      seq: seq(event.traceId),
      t_ms: event.t_ms ?? Math.max(0, Date.now() - (starts.get(event.traceId) || Date.now())),
      type: event.type || "info",
      direction: event.direction || "in",
      summary: event.summary == null ? null : redactValue(event.summary),
      payload: data.json,
      truncated: data.truncated,
    } });
    schedule();
  } catch {}
}

export function finishTrace(traceOrId, fields = {}) {
  try {
    const trace = isString(traceOrId) ? { ...fields, id: traceOrId } : (traceOrId || {});
    if (!trace?.id || !activeTraces.has(trace.id)) return;
    if (!enqueue({ kind: "finish", id: trace.id, updates: {
      ended_at: new Date().toISOString(), status: trace.status || "ok",
      total_ms: trace.total_ms ?? null, ttft_ms: trace.ttft_ms ?? null,
      fallback_count: trace.fallback_count ?? null,
    } })) return;
    activeTraces.delete(trace.id);
    finishedTraces.add(trace.id);
    schedule();
  } catch {}
}

export function onTimelineWrite(fn) { if (!isFunction(fn)) return () => {}; listeners.add(fn); return () => listeners.delete(fn); }
function emit(item) { for (const listener of listeners) try { listener(item); } catch {} }
function schedule() {
  if (pendingPersist || queue.length >= FLUSH_BATCH) {
    if (!immediateScheduled) {
      immediateScheduled = true;
      setImmediate(() => {
        immediateScheduled = false;
        startFlush().catch(() => {});
      });
    }
    return;
  }
  if (timer) return;
  timer = setTimeout(() => { timer = null; startFlush().catch(() => {}); }, 250);
  timer.unref?.();
}
function scheduleRetry() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; startFlush().catch(() => {}); }, 250);
  timer.unref?.();
}
function finalizeBatch(batch) {
  for (const item of batch) {
    if (item.kind === "trace") emit({ type: "trace", id: item.trace.id });
    else if (item.kind === "event") emit({ type: "event", traceId: item.event.traceId, kind: item.event.type });
    else emit({ type: "trace", id: item.id });
  }
  for (const item of batch) if (item.kind === "trace") flushedStarts.add(item.trace.id);
  for (const id of [...finishedTraces]) {
    if (dropped.has(id) || queue.some((queued) => (queued.kind === "event" ? queued.event.traceId : queued.kind === "trace" ? queued.trace.id : queued.id) === id)) continue;
    starts.delete(id); seqs.delete(id); flushedStarts.delete(id); finishedTraces.delete(id);
  }
}

function takeBatch() {
  const candidate = queue.slice(0, FLUSH_BATCH - 1);
  const traceId = [...dropped.keys()].find((id) =>
    (activeTraces.has(id) || finishedTraces.has(id)) &&
    (flushedStarts.has(id) || candidate.some((item) => item.kind === "trace" && item.trace.id === id)),
  );
  const batch = queue.splice(0, traceId ? FLUSH_BATCH - 1 : FLUSH_BATCH);
  for (const item of batch) queuedBytes -= bytes(item);
  let marker;
  if (traceId) {
    const count = dropped.get(traceId);
    const previousSeq = seqs.get(traceId);
    marker = { traceId, count, previousSeq };
    batch.push({ kind: "event", event: {
      traceId, seq: seq(traceId), t_ms: Math.max(0, Date.now() - (starts.get(traceId) || Date.now())),
      type: "sse_chunk", direction: "system", summary: `dropped ${count} frames`,
      payload: JSON.stringify({ _dropped: count }), truncated: true,
    } });
    dropped.delete(traceId);
  }
  for (const id of dropped.keys()) {
    if (!activeTraces.has(id) && !finishedTraces.has(id) && !flushedStarts.has(id)) dropped.delete(id);
  }
  return { batch, restore() {
    if (marker) {
      batch.pop();
      dropped.set(marker.traceId, marker.count);
      if (marker.previousSeq === undefined) seqs.delete(marker.traceId);
      else seqs.set(marker.traceId, marker.previousSeq);
    }
    queue.unshift(...batch);
    for (const item of batch) queuedBytes += bytes(item);
  } };
}

function startFlush() {
  if (flushPromise) return flushPromise;
  flushPromise = flushBatch().finally(() => { flushPromise = null; });
  return flushPromise;
}

async function flushBatch() {
  let retry = false;
  try {
    if (pendingPersist) {
      if (pendingPersist.generation !== flushGeneration) {
        pendingPersist = null;
      } else {
        try {
          await pendingPersist.adapter.flush?.();
          finalizeBatch(pendingPersist.batch);
          pendingPersist = null;
        } catch {
          retry = true;
          return;
        }
      }
    }
    if (!queue.length && !dropped.size) return;
    const generation = flushGeneration;
    const { batch, restore } = takeBatch();
    let adapter;
    try { adapter = await getProxyTimelineAdapter(); } catch {
      if (generation === flushGeneration) { restore(); retry = true; }
      return;
    }
    if (generation !== flushGeneration) return;
    try {
      adapter.transaction(() => {
        for (const item of batch) {
          if (item.kind === "trace") {
            const t = item.trace;
            adapter.run(`INSERT INTO traces(id,started_at,ended_at,status,provider,model,connection_id,api_key_id,endpoint,client_format,provider_format,fallback_count,ttft_ms,total_ms,event_count,payload_bytes,redacted,truncated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,1,0) ON CONFLICT(id) DO NOTHING`, [t.id, t.started_at, null, t.status || "running", t.provider || null, t.model || null, t.connection_id || null, t.api_key_id || null, t.endpoint || null, t.client_format || null, t.provider_format || null, t.fallback_count || 0, t.ttft_ms ?? null, t.total_ms ?? null]);
          } else if (item.kind === "event") {
            const e = item.event;
            adapter.run(`INSERT OR IGNORE INTO events(trace_id,seq,t_ms,type,direction,summary,payload) VALUES(?,?,?,?,?,?,?)`, [e.traceId, e.seq, e.t_ms, e.type, e.direction, e.summary, e.payload]);
            adapter.run(`UPDATE traces SET event_count=event_count+1,payload_bytes=payload_bytes+?,truncated=MAX(truncated,?) WHERE id=?`, [Buffer.byteLength(e.payload, "utf8"), e.truncated ? 1 : 0, e.traceId]);
          } else {
            const u = item.updates;
            adapter.run(`UPDATE traces SET ended_at=COALESCE(?,ended_at),status=COALESCE(?,status),total_ms=COALESCE(?,total_ms),ttft_ms=COALESCE(?,ttft_ms),fallback_count=COALESCE(?,fallback_count) WHERE id=?`, [u.ended_at, u.status, u.total_ms, u.ttft_ms, u.fallback_count, item.id]);
          }
        }
      });
    } catch {
      if (generation === flushGeneration) {
        restore();
        retry = true;
      }
      return;
    }
    try {
      await adapter.flush?.();
    } catch {
      if (generation === flushGeneration) {
        pendingPersist = { adapter, batch, generation };
        retry = true;
      }
      return;
    }
    finalizeBatch(batch);
    if (queue.length || dropped.size) retry = "continue";
  } finally {
    if (retry === true) scheduleRetry();
    else if (retry === "continue") schedule();
  }
}

export async function flushProxyTimelineForTests() {
  if (timer) { clearTimeout(timer); timer = null; }
  await startFlush();
}
export function getQueueLengthForTests() { return queue.length; }

export async function listTraces(filter = {}) {
  try {
    const clauses = [];
    const values = [];
    const fields = { provider: "provider", model: "model", connectionId: "connection_id", apiKeyId: "api_key_id", status: "status", endpoint: "endpoint" };
    for (const [key, column] of Object.entries(fields)) if (filter[key] != null) { clauses.push(`${column}=?`); values.push(filter[key]); }
    if (filter.startDate != null) { clauses.push("started_at>=?"); values.push(filter.startDate); }
    if (filter.endDate != null) { clauses.push("started_at<=?"); values.push(filter.endDate); }
    if (filter.q != null) { clauses.push("id LIKE ?"); values.push(`%${filter.q}%`); }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const page = Number.isInteger(Number(filter.page)) && Number(filter.page) > 0 ? Number(filter.page) : 1;
    const pageSize = Number.isInteger(Number(filter.pageSize)) && Number(filter.pageSize) > 0 ? Math.min(Number(filter.pageSize), 100) : 20;
    const db = await getProxyTimelineAdapter();
    const totalItems = db.get(`SELECT COUNT(*) AS total FROM traces${where}`, values)?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const traces = db.all(`SELECT * FROM traces${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]);
    return { traces, pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 } };
  } catch { return { traces: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1, hasNext: false, hasPrev: false } }; }
}
export async function getTrace(id) {
  try {
    const db = await getProxyTimelineAdapter(); const trace = db.get("SELECT * FROM traces WHERE id=?", [id]);
    if (!trace) return null;
    return { ...trace, events: db.all("SELECT * FROM events WHERE trace_id=? ORDER BY seq,id", [id]).map((e) => ({ ...e, payload: e.payload ? JSON.parse(e.payload) : null })) };
  } catch { return null; }
}
export async function clearTraces() {
  flushGeneration++;
  pendingPersist = null;
  queue.length = 0;
  queuedBytes = 0;
  starts.clear();
  seqs.clear();
  dropped.clear();
  activeTraces.clear();
  finishedTraces.clear();
  flushedStarts.clear();
  if (timer) { clearTimeout(timer); timer = null; }
  try { const db = await getProxyTimelineAdapter(); db.run("DELETE FROM events"); db.run("DELETE FROM traces"); } catch {}
}
export async function pruneExpired() {
  try {
    const days = Number(getSettingsSync().proxyTimelineRetentionDays); if (!Number.isFinite(days) || days <= 0) return;
    const db = await getProxyTimelineAdapter(); const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    db.transaction(() => { db.run("DELETE FROM traces WHERE started_at < ?", [cutoff]); db.run("DELETE FROM events WHERE trace_id NOT IN (SELECT id FROM traces)"); });
  } catch {}
}
if (!global._proxyTimelinePruneTimer) { global._proxyTimelinePruneTimer = setInterval(() => { pruneExpired(); }, 3600000); global._proxyTimelinePruneTimer.unref?.(); }
