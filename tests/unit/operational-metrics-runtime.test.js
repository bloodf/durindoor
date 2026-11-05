import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => vi.fn());
const histogram = vi.hoisted(() => ({ enable: vi.fn(), reset: vi.fn(), count: 1, percentile: vi.fn(() => 40_000_000) }));
vi.mock("node:perf_hooks", () => ({ monitorEventLoopDelay: vi.fn(() => histogram) }));
vi.mock("@/dashboardGuard", () => ({ hasValidCliToken: async () => false, hasValidToken: async () => false, isAdminScopedKey: async () => true }));
vi.mock("@/lib/db/index.js", () => ({ getActiveRequests: async () => ({ activeRequests: [] }) }));
vi.mock("@/lib/db/repos/connectionsRepo", () => ({ getProviderConnections: vi.fn(() => { throw new Error("Unexpected connection read"); }) }));
vi.mock("@/lib/providerHealthProbe", () => ({ probeConnectionHealth: probe, sanitizeErrorMessage: () => "redacted", AUTH_FAILURE_STATUSES: new Set([401, 403]) }));
vi.mock("@/shared/services/providerQuotaPreflight", () => ({ inspectProviderQuota: async () => new Map() }));
vi.mock("@/lib/db/repos/usageRepo", () => ({ getRecentlyActiveConnectionIds: async () => new Set() }));
vi.mock("open-sse/services/model.js", () => ({ resolveProviderAlias: (provider) => provider }));
vi.mock("@/sse/handlers/nativeProvider.js", () => ({ handleNativeProvider: async () => new Response("native-bytes", { headers: { "x-native": "preserved" } }) }));

let metrics, correlation;
const request = (options) => new Request("https://gateway.test/v1/chat/completions", options);
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  delete globalThis.__durindoorOperationalMetrics;
  delete globalThis.__durindoorMetricsSampler;
  metrics = await import("../../open-sse/services/operationalMetrics.js");
  correlation = await import("../../src/sse/utils/requestCorrelation.js");
});
afterEach(() => {
  clearInterval(globalThis.__durindoorOperationalMetrics?.runtime?.timer);
  delete globalThis.__durindoorOperationalMetrics;
  delete globalThis.__durindoorMetricsSampler;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("client HTTP observations", () => {
  it("retains a pending weak admission selection across reload and counts EOF once", async () => {
    const req = request({ method: "POST" });
    const selection = metrics.createClientAdmissionSelection();
    const source = selection.bind(new Response("selected denial frame", { headers: { "content-type": "text/event-stream" } }));
    const denial = metrics.annotateClientAdmissionFailure(new Response(null, { status: 403 }), "policy");
    const response = await metrics.observeHttpRequest(req, () => correlation.correlateResponse(source, "pending-fixture"));
    const state = globalThis.__durindoorOperationalMetrics;
    expect(response.bodyUsed).toBe(false);
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_active_requests 1\n");
    expect(metrics.operationalMetricsText()).toContain('durindoor_client_admission_failures_total{reason="policy"} 0\n');
    vi.resetModules();
    const reloaded = await import("../../open-sse/services/operationalMetrics.js");
    expect(globalThis.__durindoorOperationalMetrics).toBe(state);
    selection.select(denial);
    expect(reloaded.operationalMetricsText()).toContain('durindoor_client_admission_failures_total{reason="policy"} 0\n');
    expect(await response.text()).toBe("selected denial frame");
    expect(reloaded.operationalMetricsText()).toContain('durindoor_client_admission_failures_total{reason="policy"} 1\n');
    expect(reloaded.operationalMetricsText()).toContain("durindoor_http_active_requests 0\n");
    await (await reloaded.observeHttpRequest(req, () => new Response("same Request reused"))).text();
    expect(reloaded.operationalMetricsText()).toContain("durindoor_http_requests_total 1\n");
    expect(reloaded.operationalMetricsText()).toContain('durindoor_client_admission_failures_total{reason="policy"} 1\n');
  });

  it("counts a marked bodyless non-HEAD denial at return without replacing the Response", async () => {
    const source = metrics.annotateClientAdmissionFailure(new Response(null, { status: 429,
      headers: { "retry-after": "7" } }), "client_limit");
    const response = await metrics.observeHttpRequest(request({ method: "POST" }), () => source);
    expect(response).toBe(source);
    expect(response.body).toBeNull();
    expect(response.bodyUsed).toBe(false);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_active_requests 0\n");
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="http_error"} 1\n');
    expect(metrics.operationalMetricsText()).toContain('durindoor_client_admission_failures_total{reason="client_limit"} 1\n');
  });

  it("counts a nested and repeatedly observed Request once", async () => {
    const inner = correlation.withHttpRequestCorrelation(() => new Response("bytes"));
    const outer = correlation.withHttpRequestCorrelation((req) => inner(req));
    const req = request();
    expect(await (await outer(req)).text()).toBe("bytes");
    expect(await (await outer(req)).text()).toBe("bytes");
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_requests_total 1\n");
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="completed"} 1\n');
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_active_requests 0\n");
  });

  it("inherits only an explicitly derived Request inside the active outer handler", async () => {
    const inner = correlation.withHttpRequestCorrelation(() => new Response("legacy response"));
    const outer = correlation.withHttpRequestCorrelation(async (req) => {
      const derived = request();
      correlation.getRequestId(derived, correlation.getRequestId(req));
      return inner(derived);
    });
    expect(await (await outer(request())).text()).toBe("legacy response");
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_requests_total 1\n");
  });

  it("counts concurrent top-level Requests independently even with identical trusted IDs", async () => {
    const first = request(), second = request();
    correlation.getRequestId(first, "identical-trusted-id");
    correlation.getRequestId(second, "identical-trusted-id");
    const handler = correlation.withHttpRequestCorrelation(async () => new Response("ok"));
    const responses = await Promise.all([handler(first), handler(second)]);
    expect(await Promise.all(responses.map((response) => response.text()))).toEqual(["ok", "ok"]);
    expect(responses.map((response) => response.headers.get("x-request-id"))).toEqual(["identical-trusted-id", "identical-trusted-id"]);
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_requests_total 2\n");
  });

  it("does not inherit an observation from an async scope after its outer handler returned", async () => {
    let release, later;
    const resumed = new Promise((resolve) => { release = resolve; });
    const inner = correlation.withHttpRequestCorrelation(() => new Response("independent"));
    const outer = correlation.withHttpRequestCorrelation((req) => {
      later = resumed.then(() => {
        const derived = request();
        correlation.getRequestId(derived, correlation.getRequestId(req));
        return inner(derived);
      });
      return new Response(null, { status: 204 });
    });
    expect((await outer(request())).status).toBe(204);
    release();
    expect(await (await later).text()).toBe("independent");
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_requests_total 2\n");
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="completed"} 2\n');
  });

  it("counts distinct nested Requests independently without an explicit derivation", async () => {
    const first = request(), second = request();
    correlation.getRequestId(first, "same-id");
    correlation.getRequestId(second, "same-id");
    const inner = correlation.withHttpRequestCorrelation(() => new Response("inner"));
    const outer = correlation.withHttpRequestCorrelation(async () => new Response(await (await inner(second)).text()));
    expect(await (await outer(first)).text()).toBe("inner");
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_requests_total 2\n");
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="completed"} 2\n');
  });

  it("preserves pre-dispatch rejection and sanitized handler error behavior", async () => {
    const denied = correlation.withHttpRequestCorrelation(() => new Response("denied", { status: 401, headers: { "retry-after": "1" } }));
    const response = await denied(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(await response.text()).toBe("denied");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const throws = correlation.withHttpRequestCorrelation(() => { throw new Error("private-credential"); });
    const failed = await throws(request());
    expect(failed.status).toBe(500);
    expect((await failed.json()).error.message).toBe("Request failed");
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="http_error"} 2\n');
    expect(metrics.operationalMetricsText()).not.toContain("private-credential");
  });

  it("accounts abort before headers once without changing the handler's response", async () => {
    const abort = new AbortController();
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    const handler = correlation.withHttpRequestCorrelation(async () => { await waiting; return new Response("late"); });
    const pending = handler(request({ signal: abort.signal }));
    abort.abort("original reason");
    release();
    const response = await pending;
    expect(await response.text()).toBe("late");
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="cancelled"} 1\n');
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="completed"} 0\n');
  });

  it("observes an already aborted request without skipping its handler", async () => {
    const abort = new AbortController();
    abort.abort();
    const handler = vi.fn(() => new Response(null, { status: 204 }));
    expect((await correlation.withHttpRequestCorrelation(handler)(request({ signal: abort.signal }))).status).toBe(204);
    expect(handler).toHaveBeenCalledOnce();
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="cancelled"} 1\n');
  });

  it("does not eagerly consume, buffer ahead or alter stream chunks", async () => {
    const chunk = new Uint8Array([0, 128, 255]);
    const pull = vi.fn((controller) => pull.mock.calls.length === 1 ? controller.enqueue(chunk) : controller.close());
    const source = new ReadableStream({ pull }, { highWaterMark: 0 });
    const handler = correlation.withHttpRequestCorrelation(() => new Response(source, { status: 202, statusText: "Accepted", headers: { "x-test": "kept" } }));
    const response = await handler(request());
    expect(pull).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
    expect(response.statusText).toBe("Accepted");
    expect(response.headers.get("x-test")).toBe("kept");
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_active_requests 1\n");
    const reader = response.body.getReader();
    expect(await reader.read()).toEqual({ done: false, value: chunk });
    expect(pull).toHaveBeenCalledTimes(1);
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_active_requests 0\n");
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="completed"} 1\n');
  });

  it("propagates the original body error and records one transport failure", async () => {
    const failure = new Error("body failed");
    const handler = correlation.withHttpRequestCorrelation(() => new Response(new ReadableStream({ pull(controller) { controller.error(failure); } }, { highWaterMark: 0 })));
    const response = await handler(request());
    const reader = response.body.getReader();
    await expect(reader.read()).rejects.toBe(failure);
    await expect(reader.read()).rejects.toBe(failure);
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="stream_error"} 1\n');
  });

  it("finishes an implicit HEAD with a deliberately unread GET response body", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const body = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
    const handler = correlation.withHttpRequestCorrelation(() => new Response(body, {
      status: 200, headers: { "content-length": "5", "x-head": "preserved" },
    }));
    const response = await handler(request({ method: "HEAD" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("5");
    expect(response.headers.get("x-head")).toBe("preserved");
    expect(response.body).toBe(body);
    expect(response.bodyUsed).toBe(false);
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_active_requests 0\n");
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="completed"} 1\n');
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_request_duration_seconds_count 1\n");
    // Deliberately do not read, cancel or abort: that is the implicit HEAD path.
  });

  it("accounts a native HEAD error at return without replacing or consuming its body", async () => {
    const original = new Response("unread error", { status: 503, headers: { "retry-after": "3" } });
    const response = await metrics.observeHttpRequest(request({ method: "HEAD" }), async () => original);
    expect(response).toBe(original);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(response.bodyUsed).toBe(false);
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_active_requests 0\n");
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="http_error"} 1\n');
  });

  it("forwards cancellation reason and rejection without a second terminal event", async () => {
    const reason = { reason: "consumer cancellation" };
    const failure = new Error("cancel failed");
    const cancel = vi.fn(() => Promise.reject(failure));
    const abort = new AbortController();
    const handler = correlation.withHttpRequestCorrelation(() => new Response(new ReadableStream({ cancel }, { highWaterMark: 0 })));
    const response = await handler(request({ signal: abort.signal }));
    await expect(response.body.cancel(reason)).rejects.toBe(failure);
    abort.abort();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason);
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="cancelled"} 1\n');
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_active_requests 0\n");
  });

  it("keeps an unread body active and does not parse semantic provider error events", async () => {
    const handler = correlation.withHttpRequestCorrelation(() => new Response('data: {"error":"provider failure"}\n\n', { headers: { "content-type": "text/event-stream" } }));
    const response = await handler(request());
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_active_requests 1\n");
    expect(await response.text()).toBe('data: {"error":"provider failure"}\n\n');
    expect(metrics.operationalMetricsText()).toContain('durindoor_http_requests_completed_total{outcome="completed"} 1\n');
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_errors_total 0\n");
  });

  it("records fixed cumulative latency buckets through terminal consumption", async () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const response = await correlation.withHttpRequestCorrelation(() => new Response("ok"))(request());
    now = 3500;
    await response.text();
    const text = metrics.operationalMetricsText();
    expect(text).toContain('durindoor_http_request_duration_seconds_bucket{le="1"} 0\n');
    expect(text).toContain('durindoor_http_request_duration_seconds_bucket{le="2.5"} 1\n');
    expect(text).toContain('durindoor_http_request_duration_seconds_bucket{le="+Inf"} 1\n');
    expect(text).toContain("durindoor_http_request_duration_seconds_sum 2.5\n");
    expect(text).toContain("durindoor_http_request_duration_seconds_count 1\n");
  });

  it("excludes OPTIONS and preserves native HTTP response contracts", async () => {
    await correlation.withHttpRequestCorrelation(() => new Response(null))(request({ method: "OPTIONS" }));
    const route = await import("../../src/app/api/v1/native/[provider]/[...operation]/route.js");
    const response = await route.POST(request({ method: "POST" }), { params: Promise.resolve({ provider: "private-provider", operation: ["test"] }) });
    expect(response.headers.get("x-native")).toBe("preserved");
    expect(response.headers.has("x-request-id")).toBe(false);
    expect(await response.text()).toBe("native-bytes");
    expect(metrics.operationalMetricsText()).toContain("durindoor_http_requests_total 1\n");
    expect(metrics.operationalMetricsText()).not.toContain("private-provider");
  });

  it("reuses aggregates on reload and starts empty for a fresh process state", async () => {
    await (await correlation.withHttpRequestCorrelation(() => new Response(null))(request())).text();
    vi.resetModules();
    const reloaded = await import("../../open-sse/services/operationalMetrics.js");
    expect(reloaded.operationalMetricsText()).toContain("durindoor_http_requests_total 1\n");
    delete globalThis.__durindoorOperationalMetrics;
    vi.resetModules();
    const restarted = await import("../../open-sse/services/operationalMetrics.js");
    expect(restarted.operationalMetricsText()).toContain("durindoor_http_requests_total 0\n");
  });

  it("exports only fixed labels without reading or retaining credential/prompt/URL fields", async () => {
    const req = request({ method: "POST", headers: { authorization: "Bearer private-key", "x-request-id": "private-caller-id", "content-type": "application/json" }, body: JSON.stringify({ prompt: "private-prompt", session: "private-session", url: "https://private.test/secret" }) });
    const handler = correlation.withHttpRequestCorrelation(async (input) => {
      expect(input.bodyUsed).toBe(false);
      expect((await input.json()).prompt).toBe("private-prompt");
      return new Response("unchanged");
    });
    expect(await (await handler(req)).text()).toBe("unchanged");
    metrics.publishProviderHealth({ healthy: 1, degraded: 0, down: 0, blocked: 0, unconfigured: 0, unknown: 0 }, 5000);
    const text = metrics.operationalMetricsText(1000);
    expect(text).not.toMatch(/private|https?:|prompt|session|authorization|request_id/);
    const labels = [...text.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    expect(labels).toEqual([
      'outcome="completed"', 'outcome="http_error"', 'outcome="stream_error"', 'outcome="cancelled"', 'outcome="handler_error"',
      'le="0.01"', 'le="0.05"', 'le="0.1"', 'le="0.25"', 'le="0.5"', 'le="1"', 'le="2.5"', 'le="5"', 'le="10"', 'le="30"', 'le="60"', 'le="300"', 'le="+Inf"',
      'reason="timeout"', 'reason="aborted"',
      'reason="auth_missing"', 'reason="auth_invalid"', 'reason="policy"', 'reason="client_limit"',
      'state="healthy"', 'state="degraded"', 'state="down"', 'state="blocked"', 'state="unconfigured"', 'state="unknown"',
    ]);
  });
});

describe("cached provider and admission signals", () => {
  it("exports fresh numeric cache projection, omits expired/invalidated states and never probes on scrape", async () => {
    const health = await import("../../src/lib/healthMonitor.js");
    await health.getHealthPayload({ now: () => 1000, connectionsLoader: async () => [] });
    expect(metrics.operationalMetricsText(1000)).toContain('durindoor_provider_connections{state="healthy"} 0\n');
    expect(metrics.operationalMetricsText(61_000)).toContain("durindoor_provider_health_snapshot_available 0\n");
    expect(metrics.operationalMetricsText(61_000)).not.toContain('durindoor_provider_connections{');
    health.invalidateHealthCache();
    expect(metrics.operationalMetricsText(1000)).not.toContain('durindoor_provider_connections{');
    const { GET } = await import("../../src/app/api/monitoring/metrics/route.js");
    expect((await GET(request())).status).toBe(200);
    expect((await GET(request())).status).toBe(200);
    expect(probe).not.toHaveBeenCalled();
  });

  it("does not let an invalidated in-flight health build republish metrics", async () => {
    const health = await import("../../src/lib/healthMonitor.js");
    let release;
    const pending = health.getHealthPayload({ now: () => 1000, connectionsLoader: () => new Promise((resolve) => { release = resolve; }) });
    health.invalidateHealthCache();
    release([]);
    await pending;
    expect(metrics.operationalMetricsText(1000)).toContain("durindoor_provider_health_snapshot_available 0\n");
  });

  it("uses fixed state domains and omits unusable projections", () => {
    metrics.publishProviderHealth({ healthy: 2, degraded: 1, down: 3, blocked: 0, unconfigured: 0, unknown: 1, "private-id": 100 }, 5000);
    expect(metrics.operationalMetricsText(1000)).toContain('durindoor_provider_connections{state="healthy"} 2\n');
    expect(metrics.operationalMetricsText(1000)).not.toContain("private-id");
    metrics.publishProviderHealth({ healthy: NaN }, 5000);
    expect(metrics.operationalMetricsText(1000)).not.toContain('durindoor_provider_connections{');
  });

  it("fences a late projection publication across module instances without moving cache authority", async () => {
    const oldHealth = await import("../../src/lib/healthMonitor.js");
    let release;
    const pending = oldHealth.getHealthPayload({ now: () => 1000, connectionsLoader: () => new Promise((resolve) => { release = resolve; }) });
    vi.resetModules();
    const newHealth = await import("../../src/lib/healthMonitor.js");
    newHealth.invalidateHealthCache();
    release([]);
    await pending;
    expect(oldHealth.getHealthCacheEntry()).not.toBeNull();
    expect(newHealth.getHealthCacheEntry()).toBeNull();
    expect(metrics.operationalMetricsText(1000)).toContain("durindoor_provider_health_snapshot_available 0\n");
  });

  it("counts gate timeout/abort without changing queue or release behavior", async () => {
    vi.useFakeTimers();
    const gate = await import("../../open-sse/services/concurrencyGate.js");
    await gate.acquireSlot("private-gate", 1);
    const timeout = gate.acquireSlot("private-gate", 1, 25).catch((error) => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await timeout).toBeInstanceOf(gate.ConcurrencyGateTimeoutError);
    const abort = new AbortController();
    const waiting = gate.acquireSlot("private-gate", 1, 25, abort.signal).catch((error) => error);
    expect(gate.getGateStats()["private-gate"]).toEqual({ current: 1, queued: 1 });
    abort.abort();
    expect((await waiting).name).toBe("AbortError");
    expect(gate.getGateStats()["private-gate"]).toEqual({ current: 1, queued: 0 });
    gate.releaseSlot("private-gate");
    expect(gate.getGateStats()).toEqual({});
    expect(metrics.operationalMetricsText()).toContain('durindoor_admission_failures_total{reason="timeout"} 1\n');
    expect(metrics.operationalMetricsText()).toContain('durindoor_admission_failures_total{reason="aborted"} 1\n');
    expect(metrics.operationalMetricsText()).not.toContain("private-gate");
  });
});

describe("explicit runtime recorder", () => {
  it("publishes the sampler only after enable succeeds and permits retry", async () => {
    const perf = await import("node:perf_hooks");
    histogram.enable.mockImplementationOnce(() => { throw new Error("enable failed"); });
    expect(() => metrics.getEventLoopSampler()).toThrow("enable failed");
    expect(globalThis.__durindoorMetricsSampler).toBeUndefined();
    expect(metrics.getEventLoopSampler()).toBe(histogram);
    expect(perf.monitorEventLoopDelay).toHaveBeenCalledTimes(2);
    expect(histogram.enable).toHaveBeenCalledTimes(2);
    expect(metrics.operationalMetricsText()).toContain("durindoor_runtime_recorder_started 0\n");
  });

  it.each(["route-first", "start-first"])("shares %s sampling and retains the original timer on reload", async (order) => {
    vi.useFakeTimers();
    const perf = await import("node:perf_hooks");
    const listeners = ["SIGINT", "SIGTERM", "beforeExit"].map((event) => process.listenerCount(event));
    let route;
    if (order === "route-first") route = await import("../../src/app/api/monitoring/metrics/route.js");
    metrics.startOperationalMetricsRuntime();
    const timer = globalThis.__durindoorOperationalMetrics.runtime.timer;
    const state = globalThis.__durindoorOperationalMetrics;
    const { GET } = route ?? await import("../../src/app/api/monitoring/metrics/route.js");
    expect((await GET(request())).status).toBe(200);
    expect((await GET(request())).status).toBe(200);
    vi.resetModules();
    const reloaded = await import("../../open-sse/services/operationalMetrics.js");
    reloaded.startOperationalMetricsRuntime();
    expect(globalThis.__durindoorOperationalMetrics).toBe(state);
    expect(globalThis.__durindoorOperationalMetrics.runtime.timer).toBe(timer);
    expect(timer.hasRef()).toBe(false);
    expect(perf.monitorEventLoopDelay).toHaveBeenCalledTimes(1);
    expect(histogram.enable).toHaveBeenCalledTimes(1);
    expect(histogram.reset).not.toHaveBeenCalled();
    expect(["SIGINT", "SIGTERM", "beforeExit"].map((event) => process.listenerCount(event))).toEqual(listeners);
  });

  it("stays unknown before boot integration and never starts through scrapes", async () => {
    const { GET } = await import("../../src/app/api/monitoring/metrics/route.js");
    const text = await (await GET(request())).text();
    expect(text).toContain("durindoor_runtime_recorder_started 0\n");
    expect(text).not.toContain("durindoor_event_loop_stalls_total");
  });

  it("uses one timer and existing sampler, bounds events and correlates stalls with admission failures", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const interval = vi.spyOn(globalThis, "setInterval");
    const perf = await import("node:perf_hooks");
    metrics.getEventLoopSampler();
    metrics.startOperationalMetricsRuntime();
    metrics.startOperationalMetricsRuntime();
    metrics.recordAdmissionFailure("timeout");
    now = 7000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(interval).toHaveBeenCalledTimes(1);
    expect(perf.monitorEventLoopDelay).toHaveBeenCalledTimes(1);
    expect(metrics.operationalMetricsText()).toContain("durindoor_event_loop_stalls_total 1\n");
    expect(metrics.operationalMetricsText()).toContain("durindoor_event_loop_stall_max_seconds 6\n");
    expect(metrics.operationalMetricsText()).toContain("durindoor_event_loop_last_stall_admission_failures 1\n");
    for (let i = 0; i < 30; i++) metrics.recordAdmissionFailure("aborted");
    expect(metrics.getOperationalDiagnostics()).toHaveLength(16);
    expect(metrics.getOperationalDiagnostics().at(-1).admissionFailures).toBe(31);
  });

  it("warns once for unusable runtime readings and preserves unknown RSS", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(process, "memoryUsage").mockReturnValue({ rss: Infinity });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    metrics.startOperationalMetricsRuntime();
    now = 7000;
    await vi.advanceTimersByTimeAsync(1000);
    now = 14_000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(warn).toHaveBeenCalledExactlyOnceWith("[metrics] Runtime sampler reading unavailable");
    expect(metrics.operationalMetricsText()).not.toContain("durindoor_event_loop_last_stall_resident_memory_bytes");
    expect(metrics.getOperationalDiagnostics()[0].rss).toBeNull();
  });

  it("warns once for nonfinite/backwards drift readings without inventing stalls", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    metrics.startOperationalMetricsRuntime();
    expect(metrics.operationalMetricsText()).toContain("durindoor_runtime_sampler_reading_available 0\n");
    for (const reading of [Infinity, -1, NaN, 1000, 2000]) {
      now = reading;
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(warn).toHaveBeenCalledExactlyOnceWith("[metrics] Runtime sampler reading unavailable");
    expect(metrics.operationalMetricsText()).toContain("durindoor_event_loop_stalls_total 0\n");
    expect(metrics.operationalMetricsText()).toContain("durindoor_runtime_sampler_reading_available 1\n");
    expect(metrics.getOperationalDiagnostics()).toEqual([]);
  });
});
