// Opt-in OpenTelemetry routing traces (#1128).
//
// Ported from OmniRoute open-sse/services/routing/otel.ts
// (diegosouzapw/OmniRoute@61e07fb7, MIT): no @opentelemetry SDK dependency,
// spans go to the collector's OTLP/HTTP JSON endpoint via global fetch.
// Fork changes: one span per chatCore routing attempt, fed by the proxy
// timeline seam (chatCore/proxyTimeline.js), with the client request id as
// the shared trace id so combo/fallback attempts line up in one trace.
//
// Off unless DURINDOOR_OTEL_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT is set
// (OTEL_SDK_DISABLED=true wins). Only allowlisted low-cardinality metadata is
// exported: no prompts, payloads, error text, credentials, API keys or
// connection ids. Everything is fail-open: export errors never reach the
// request path; buffers are bounded and drop oldest.

import { randomBytes } from "node:crypto";
import { isNumber, isString } from "../../src/shared/utils/typeChecks.js";

const MAX_ACTIVE_SPANS = 2000;
const MAX_BUFFERED_SPANS = 512;
const MAX_BATCH = 64;
const MAX_EVENTS_PER_SPAN = 32;
const MAX_CONSECUTIVE_FAILURES = 5;
const FLUSH_INTERVAL_MS = 5000;
const EXPORT_TIMEOUT_MS = 3000;
// Timeline event types that become span events. Summaries are never exported.
const EVENT_TYPES = new Set(["route", "error", "abort", "info", "retry", "fallback"]);
const STATUS_CODE = { ok: 1, error: 2 };

let config;
let active = new Map();
let buffer = [];
let stats = { exported: 0, dropped: 0, failures: 0 };
let consecutiveFailures = 0;
let timer = null;
let flushing = null;

function readConfig(env = process.env) {
  if (String(env.OTEL_SDK_DISABLED || "").toLowerCase() === "true") return null;
  // Spec: OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is used as-is; a base endpoint
  // (DURINDOOR_OTEL_ENDPOINT / OTEL_EXPORTER_OTLP_ENDPOINT) gets /v1/traces.
  const exact = String(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || "").trim();
  const base = String(env.DURINDOOR_OTEL_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim();
  const tracesUrl = exact || (base && (/\/v1\/traces\/?$/.test(base) ? base : `${base.replace(/\/+$/, "")}/v1/traces`));
  if (!tracesUrl) return null;
  try {
    const { protocol } = new URL(tracesUrl);
    if (protocol !== "http:" && protocol !== "https:") return null;
  } catch {
    return null;
  }
  return {
    tracesUrl,
    headers: parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    serviceName: String(env.OTEL_SERVICE_NAME || "durindoor").slice(0, 128)
  };
}

/** "k1=v1,k2=v2" (OTel spec form, values may be URL-encoded). */
function parseHeaders(raw) {
  const headers = {};
  if (!isString(raw)) return headers;
  for (const pair of raw.split(",")) {
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    const key = pair.slice(0, i).trim();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) continue;
    try {
      headers[key] = decodeURIComponent(pair.slice(i + 1).trim());
    } catch {
      headers[key] = pair.slice(i + 1).trim();
    }
  }
  return headers;
}

function getConfig() {
  if (config === undefined) config = readConfig();
  return config;
}

export function isOtelEnabled() {
  return getConfig() !== null;
}

const nowNs = () => BigInt(Date.now()) * 1_000_000n;
const hex = (bytes) => randomBytes(bytes).toString("hex");

function traceIdFor(requestId) {
  const compact = isString(requestId) ? requestId.replace(/-/g, "").toLowerCase() : "";
  return /^[0-9a-f]{32}$/.test(compact) && !/^0+$/.test(compact) ? compact : hex(16);
}

function attr(key, value) {
  if (value === undefined || value === null || value === "") return null;
  if (isNumber(value)) {
    return Number.isInteger(value) ? { key, value: { intValue: String(value) } } : { key, value: { doubleValue: value } };
  }
  return { key, value: { stringValue: String(value).slice(0, 256) } };
}

function endpointPath(endpoint) {
  if (!isString(endpoint)) return null;
  return endpoint.split("?")[0].slice(0, 128);
}

/** Begin one routing-attempt span. `fields` is the proxy-timeline trace row. */
export function otelStart(id, fields = {}, ctx = {}) {
  try {
    if (!isOtelEnabled() || !id) return;
    if (active.size >= MAX_ACTIVE_SPANS) {
      active.delete(active.keys().next().value);
      stats.dropped++;
    }
    active.set(id, {
      traceId: traceIdFor(ctx.requestId),
      spanId: hex(8),
      start: nowNs(),
      firstByte: null,
      events: [],
      attrs: [
      attr("gen_ai.operation.name", "chat"),
      attr("gen_ai.provider.name", fields.provider),
      attr("gen_ai.request.model", fields.model),
      attr("durindoor.endpoint", endpointPath(fields.endpoint)),
      attr("durindoor.client_format", fields.client_format),
      attr("durindoor.provider_format", fields.provider_format)].
      filter(Boolean)
    });
  } catch {/* fail-open */}
}

/** Record a timeline event: only its type (allowlisted) and time; first output chunk = TTFT. */
export function otelEvent(id, event = {}) {
  try {
    const span = active.get(id);
    if (!span) return;
    if (event.type === "sse_chunk") {
      if (span.firstByte === null) span.firstByte = nowNs();
      return;
    }
    if (!EVENT_TYPES.has(event.type) || span.events.length >= MAX_EVENTS_PER_SPAN) return;
    span.events.push({ timeUnixNano: nowNs().toString(), name: event.type, attributes: [] });
  } catch {/* fail-open */}
}

/** Mark first output byte without the timeline frame tap. */
export function otelFirstByte(id) {
  const span = active.get(id);
  if (span && span.firstByte === null) span.firstByte = nowNs();
}

export function otelFinish(id, fields = {}) {
  try {
    const span = active.get(id);
    if (!span) return;
    active.delete(id);
    const end = nowNs();
    const status = isString(fields.status) ? fields.status : "ok";
    const attributes = [
    ...span.attrs,
    attr("durindoor.outcome", status),
    attr("durindoor.total_ms", Number((end - span.start) / 1_000_000n)),
    span.firstByte !== null ? attr("durindoor.ttft_ms", Number((span.firstByte - span.start) / 1_000_000n)) : null].
    filter(Boolean);
    enqueue({
      traceId: span.traceId,
      spanId: span.spanId,
      name: `chat ${fields.provider || attrValue(span.attrs, "gen_ai.provider.name") || "provider"}`,
      kind: 3, // CLIENT
      startTimeUnixNano: span.start.toString(),
      endTimeUnixNano: end.toString(),
      attributes,
      events: span.events,
      status: { code: STATUS_CODE[status] ?? 0 }
    });
  } catch {/* fail-open */}
}

function attrValue(attrs, key) {
  return attrs.find((a) => a.key === key)?.value?.stringValue;
}

function enqueue(span) {
  if (buffer.length >= MAX_BUFFERED_SPANS) {
    buffer.shift();
    stats.dropped++;
  }
  buffer.push(span);
  if (buffer.length >= MAX_BATCH) {
    void flushOtel();
  } else if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      void flushOtel();
    }, FLUSH_INTERVAL_MS);
    timer.unref?.();
  }
}

export function buildOtlpPayload(spans, serviceName) {
  return {
    resourceSpans: [{
      resource: { attributes: [attr("service.name", serviceName), attr("telemetry.sdk.name", "durindoor")] },
      scopeSpans: [{ scope: { name: "durindoor.routing" }, spans }]
    }]
  };
}

/** Export buffered spans. Never throws; at most one flush in flight. */
export function flushOtel() {
  if (flushing) return flushing;
  const cfg = getConfig();
  if (!cfg || buffer.length === 0) return Promise.resolve();
  const batch = buffer.splice(0, MAX_BATCH);
  flushing = (async () => {
    try {
      const res = await fetch(cfg.tracesUrl, {
        method: "POST",
        headers: { ...cfg.headers, "Content-Type": "application/json" },
        body: JSON.stringify(buildOtlpPayload(batch, cfg.serviceName)),
        signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS)
      });
      if (!res.ok) throw new Error(`collector ${res.status}`);
      consecutiveFailures = 0;
      stats.exported += batch.length;
    } catch {
      stats.failures++;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES || buffer.length + batch.length > MAX_BUFFERED_SPANS) {
        stats.dropped += batch.length;
      } else {
        buffer.unshift(...batch);
      }
    } finally {
      flushing = null;
    }
    if (buffer.length > 0 && !timer) {
      timer = setTimeout(() => {
        timer = null;
        void flushOtel();
      }, FLUSH_INTERVAL_MS);
      timer.unref?.();
    }
  })();
  return flushing;
}

/** Stop the timer and attempt one final export (bounded by the export timeout). */
export async function shutdownOtel() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    await flushOtel();
  } catch {/* fail-open */}
}

export function getOtelStats() {
  return { ...stats, buffered: buffer.length, active: active.size };
}

/** Test hook: re-read env and clear all state. */
export function resetOtelForTests(env) {
  if (timer) clearTimeout(timer);
  timer = null;
  flushing = null;
  config = env ? readConfig(env) : undefined;
  active = new Map();
  buffer = [];
  stats = { exported: 0, dropped: 0, failures: 0 };
  consecutiveFailures = 0;
}

process.once?.("beforeExit", () => {
  if (buffer.length > 0) void shutdownOtel();
});
