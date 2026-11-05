import { AsyncLocalStorage } from "node:async_hooks";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { isFunction, isObject } from "../../src/shared/utils/typeChecks.js";

export const HTTP_DURATION_BUCKETS = Object.freeze([0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300]);
export const HTTP_OUTCOMES = Object.freeze(["completed", "http_error", "stream_error", "cancelled", "handler_error"]);
export const CLIENT_ADMISSION_REASONS = Object.freeze(["auth_missing", "auth_invalid", "policy", "client_limit"]);
export const HEALTH_STATES = Object.freeze(["healthy", "degraded", "down", "blocked", "unconfigured", "unknown"]);

// Aggregates survive server module reloads, never process restarts. No request
// bodies, IDs, URLs or credentials enter the exported state.
const metrics = globalThis.__durindoorOperationalMetrics ??= {
  context: new AsyncLocalStorage(),
  requests: new WeakMap(),
  started: 0,
  active: 0,
  outcomes: Object.fromEntries(HTTP_OUTCOMES.map((outcome) => [outcome, 0])),
  buckets: HTTP_DURATION_BUCKETS.map(() => 0),
  durationCount: 0,
  durationSum: 0,
  admission: { timeout: 0, aborted: 0 },
  health: null,
  healthGeneration: 0,
  runtime: null,
  events: [],
  warnedSampler: false,
};

// Additive initialization also preserves counters and pending selections across
// HMR from a module version that predates client-admission instrumentation.
metrics.clientAdmission ??= Object.fromEntries(CLIENT_ADMISSION_REASONS.map((reason) => [reason, 0]));
metrics.responseAdmission ??= new WeakMap();

/** Mark an actual local denial Response, without counting a candidate result.
 * Metadata is weak, private and never added to the wire response or diagnostics.
 */
export function annotateClientAdmissionFailure(response, reason) {
  if (response instanceof Response && CLIENT_ADMISSION_REASONS.includes(reason)) {
    metrics.responseAdmission.set(response, { reason });
  }
  return response;
}

/** Preserve the same opaque selection when correlation rebuilds a Response. */
export function copyClientAdmissionFailure(source, target) {
  const selection = metrics.responseAdmission.get(source);
  if (selection && target instanceof Response) metrics.responseAdmission.set(target, selection);
  return target;
}

/** The delayed keepalive producer selects a denial after its HTTP 200 exists.
 * Bind the cell to that output; select only after forwarding the chosen denial.
 * This never marks the async context or other candidate/nested Responses.
 */
export function createClientAdmissionSelection() {
  const selection = { reason: null };
  return {
    bind(response) {
      metrics.responseAdmission.set(response, selection);
      return response;
    },
    select(response) {
      selection.reason = metrics.responseAdmission.get(response)?.reason ?? null;
    },
  };
}

/** Bind an explicitly derived Request to the currently executing observation.
 * Called by the legacy trusted-ID copy and the Gemini route's explicit bridge.
 * The opaque scope, never ID equality, determines accounting identity.
 */
export function inheritHttpObservation(request) {
  const outer = metrics.context.getStore();
  if (outer?.executing && !metrics.requests.has(request)) metrics.requests.set(request, outer);
}

/** Observe HTTP transport completion, without interpreting provider payloads.
 * An unread non-HEAD body stays active until request abort or reader cancel.
 * Same-Request reuse is one observation; independent Requests get independent
 * observations unless explicitly derived inside an active outer handler.
 */
export async function observeHttpRequest(request, callback) {
  if (!request || (!isObject(request) && !isFunction(request)) || request.method === "OPTIONS") return callback();
  const existing = metrics.requests.get(request);
  if (existing) return metrics.context.run(existing, callback);

  const scope = { finished: false, executing: true };
  metrics.requests.set(request, scope);
  metrics.started++;
  metrics.active++;
  const startedAt = performance.now();
  let response;
  const finish = (outcome) => {
    if (scope.finished) return;
    scope.finished = true;
    request.signal?.removeEventListener("abort", onAbort);
    metrics.active--;
    metrics.outcomes[outcome]++;
    if (outcome === "completed" || outcome === "http_error") {
      const reason = metrics.responseAdmission.get(response)?.reason;
      if (CLIENT_ADMISSION_REASONS.includes(reason)) metrics.clientAdmission[reason]++;
    }
    const seconds = (performance.now() - startedAt) / 1000;
    if (Number.isFinite(seconds) && seconds >= 0) {
      metrics.durationCount++;
      metrics.durationSum += seconds;
      HTTP_DURATION_BUCKETS.forEach((bound, index) => { if (seconds <= bound) metrics.buckets[index]++; });
    }
  };
  const onAbort = () => finish("cancelled");
  request.signal?.addEventListener("abort", onAbort, { once: true });
  if (request.signal?.aborted) onAbort();

  try {
    response = await metrics.context.run(scope, callback);
  } catch (error) {
    finish("handler_error");
    throw error;
  } finally {
    scope.executing = false;
  }
  if (!(response instanceof Response)) {
    finish("handler_error");
    return response;
  }
  const outcome = response.status >= 400 ? "http_error" : "completed";
  // Next can reuse GET for an implicit HEAD and discard its body without
  // reading or cancelling it. Account at handler return and leave it untouched.
  if (request.method === "HEAD" || !response.body) {
    finish(outcome);
    return response;
  }

  // Zero high-water mark prevents this observer from pulling ahead of the
  // downstream reader. Acquire a single upstream reader only on pull/cancel.
  let reader;
  const upstream = () => reader ??= response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await upstream().read();
        if (done) {
          finish(outcome);
          controller.close();
        } else controller.enqueue(value);
      } catch (error) {
        finish("stream_error");
        controller.error(error);
      }
    },
    cancel(reason) {
      finish("cancelled");
      return upstream().cancel(reason);
    },
  }, { highWaterMark: 0 });
  return copyClientAdmissionFailure(response,
    new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }));
}

function rememberEvent(event) {
  metrics.events.push(event);
  if (metrics.events.length > 16) metrics.events.shift();
}

/** Count only actual gate rejections; never provider keys, tier keys or errors. */
export function recordAdmissionFailure(reason) {
  metrics.admission[reason]++;
  rememberEvent({ kind: reason, uptimeSeconds: process.uptime(), active: metrics.active,
    admissionFailures: metrics.admission.timeout + metrics.admission.aborted });
}

/** Numeric projection only. The health monitor retains its existing authority. */
export function getProviderHealthGeneration() { return metrics.healthGeneration; }

export function publishProviderHealth(summary, expiresAt, generation = metrics.healthGeneration) {
  if (generation !== metrics.healthGeneration) return;
  const counts = Object.fromEntries(HEALTH_STATES.map((state) => [state, summary?.[state]]));
  metrics.health = Number.isFinite(expiresAt) && HEALTH_STATES.every((state) => Number.isSafeInteger(counts[state]) && counts[state] >= 0)
    ? { counts, expiresAt } : null;
}

export function clearProviderHealth() {
  metrics.health = null;
  metrics.healthGeneration++;
}

/** Preserve the existing process-lifetime p99 sampler; never reset it. */
export function getEventLoopSampler() {
  if (!globalThis.__durindoorMetricsSampler) {
    const sampler = monitorEventLoopDelay({ resolution: 20 });
    sampler.enable();
    globalThis.__durindoorMetricsSampler = sampler;
  }
  return globalThis.__durindoorMetricsSampler;
}

/** Explicit boot API for the instrumentation owner. Not started by a scrape.
 * One unref'd 1s drift timer, fixed 5s threshold, 16 numeric events. Reuses
 * the p99 sampler; no second native histogram or per-request timer is created.
 */
export function startOperationalMetricsRuntime() {
  if (metrics.runtime) return;
  getEventLoopSampler();
  const runtime = { startedAt: process.uptime(), lastTick: performance.now(), readingAvailable: false, stalls: 0, maxSeconds: 0, lastStall: null };
  runtime.timer = setInterval(() => {
    const now = performance.now();
    const delay = now - runtime.lastTick - 1000;
    runtime.lastTick = now;
    if (!Number.isFinite(delay) || delay < 0) {
      runtime.readingAvailable = false;
      if (!metrics.warnedSampler) {
        metrics.warnedSampler = true;
        console.warn("[metrics] Runtime sampler reading unavailable");
      }
      return;
    }
    runtime.readingAvailable = true;
    if (delay <= 5000) return;
    runtime.stalls++;
    runtime.maxSeconds = Math.max(runtime.maxSeconds, delay / 1000);
    let rss = null;
    try {
      const sample = process.memoryUsage().rss;
      if (Number.isSafeInteger(sample) && sample >= 0) rss = sample;
    } catch { /* unavailable stays unknown */ }
    if (rss === null && !metrics.warnedSampler) {
      metrics.warnedSampler = true;
      console.warn("[metrics] Runtime sampler reading unavailable");
    }
    runtime.lastStall = { kind: "stall", uptimeSeconds: process.uptime(), delaySeconds: delay / 1000, rss,
      active: metrics.active, admissionFailures: metrics.admission.timeout + metrics.admission.aborted };
    rememberEvent(runtime.lastStall);
  }, 1000);
  runtime.timer.unref?.();
  metrics.runtime = runtime;
}

/** Bounded numeric diagnostics. No sampler history is consumed by reads. */
export function getOperationalDiagnostics() { return metrics.events.map((event) => ({ ...event })); }

export function operationalMetricsText(now = Date.now()) {
  const lines = [];
  const gauge = (name, value) => lines.push(`# TYPE durindoor_${name} gauge`, `durindoor_${name} ${value}`);
  const counter = (name, value) => lines.push(`# TYPE durindoor_${name} counter`, `durindoor_${name} ${value}`);
  counter("http_requests_total", metrics.started);
  gauge("http_active_requests", metrics.active);
  lines.push("# TYPE durindoor_http_requests_completed_total counter");
  for (const outcome of HTTP_OUTCOMES) lines.push(`durindoor_http_requests_completed_total{outcome="${outcome}"} ${metrics.outcomes[outcome]}`);
  counter("http_errors_total", metrics.outcomes.http_error + metrics.outcomes.stream_error + metrics.outcomes.handler_error);
  lines.push("# TYPE durindoor_http_request_duration_seconds histogram");
  HTTP_DURATION_BUCKETS.forEach((bound, index) => lines.push(`durindoor_http_request_duration_seconds_bucket{le="${bound}"} ${metrics.buckets[index]}`));
  lines.push(`durindoor_http_request_duration_seconds_bucket{le="+Inf"} ${metrics.durationCount}`,
    `durindoor_http_request_duration_seconds_count ${metrics.durationCount}`,
    `durindoor_http_request_duration_seconds_sum ${metrics.durationSum}`);
  lines.push("# TYPE durindoor_admission_failures_total counter");
  for (const reason of ["timeout", "aborted"]) lines.push(`durindoor_admission_failures_total{reason="${reason}"} ${metrics.admission[reason]}`);
  lines.push("# TYPE durindoor_client_admission_failures_total counter");
  for (const reason of CLIENT_ADMISSION_REASONS) lines.push(`durindoor_client_admission_failures_total{reason="${reason}"} ${metrics.clientAdmission[reason]}`);
  const health = metrics.health && now < metrics.health.expiresAt ? metrics.health : null;
  gauge("provider_health_snapshot_available", health ? 1 : 0);
  if (health) {
    lines.push("# TYPE durindoor_provider_connections gauge");
    for (const state of HEALTH_STATES) lines.push(`durindoor_provider_connections{state="${state}"} ${health.counts[state]}`);
  }
  gauge("runtime_recorder_started", metrics.runtime ? 1 : 0);
  if (metrics.runtime) {
    const runtime = metrics.runtime;
    gauge("runtime_recorder_start_uptime_seconds", runtime.startedAt);
    gauge("runtime_sampler_reading_available", runtime.readingAvailable ? 1 : 0);
    counter("event_loop_stalls_total", runtime.stalls);
    gauge("event_loop_stall_max_seconds", runtime.maxSeconds);
    if (runtime.lastStall) {
      gauge("event_loop_last_stall_active_requests", runtime.lastStall.active);
      gauge("event_loop_last_stall_admission_failures", runtime.lastStall.admissionFailures);
      if (runtime.lastStall.rss !== null) gauge("event_loop_last_stall_resident_memory_bytes", runtime.lastStall.rss);
    }
  }
  return lines.join("\n") + "\n";
}
