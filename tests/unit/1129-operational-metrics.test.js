import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ admin: vi.fn() }));
const active = vi.hoisted(() => vi.fn());
const histogram = vi.hoisted(() => ({ enable: vi.fn(), count: 1, percentile: vi.fn(() => 40_000_000) }));
vi.mock("node:perf_hooks", () => ({ monitorEventLoopDelay: vi.fn(() => histogram) }));
vi.mock("@/dashboardGuard", () => ({ hasValidCliToken: async () => false, hasValidToken: async () => false, isAdminScopedKey: auth.admin }));
vi.mock("@/lib/db/index.js", () => ({ getActiveRequests: active }));

let metrics, gate, GET;
const scrape = () => GET(new Request("http://localhost/api/monitoring/metrics"));
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  delete globalThis.__durindoorOperationalMetrics;
  delete globalThis.__durindoorMetricsSampler;
  active.mockResolvedValue({ activeRequests: [{ count: 2, account: "private-account" }] });
  auth.admin.mockResolvedValue(true);
  metrics = await import("../../open-sse/services/operationalMetrics.js");
  gate = await import("../../open-sse/services/concurrencyGate.js");
  GET = (await import("../../src/app/api/monitoring/metrics/route.js")).GET;
});
afterEach(() => {
  gate._resetGates();
  clearInterval(globalThis.__durindoorOperationalMetrics?.runtime?.timer);
  delete globalThis.__durindoorOperationalMetrics;
  delete globalThis.__durindoorMetricsSampler;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("authenticated operational metrics", () => {
  it("rejects unauthorized scrapes before reading active requests", async () => {
    auth.admin.mockResolvedValue(false);
    const response = await scrape();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(active).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("durindoor_");
  });

  it("exports observed outcomes, latency, provider snapshot and queue without identifiers", async () => {
    for (const status of [200, 503]) {
      const request = new Request("http://gateway.test/private-path", { headers: { authorization: "Bearer private-token" } });
      const response = await metrics.observeHttpRequest(request, () => new Response("fixture", { status }));
      await response.text();
    }
    metrics.publishProviderHealth({ healthy: 2, degraded: 1, down: 0, blocked: 0, unconfigured: 0, unknown: 0, "private-provider": 9 }, Date.now() + 60_000);
    await gate.acquireSlot("private-gate", 1);
    const waiting = gate.acquireSlot("private-gate", 1);
    try {
      const response = await scrape();
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      for (const line of ["durindoor_active_requests 2", "durindoor_admission_queued_requests 1", "durindoor_http_requests_total 2", "durindoor_http_errors_total 1", 'durindoor_http_requests_completed_total{outcome="completed"} 1', 'durindoor_http_requests_completed_total{outcome="http_error"} 1', 'durindoor_http_request_duration_seconds_bucket{le="+Inf"} 2', "durindoor_http_request_duration_seconds_count 2", "durindoor_provider_health_snapshot_available 1", 'durindoor_provider_connections{state="healthy"} 2', "durindoor_event_loop_delay_p99_seconds 0.04"]) expect(body).toContain(`${line}\n`);
      expect(body).not.toContain("private-");
    } finally {
      gate.releaseSlot("private-gate");
      await waiting;
      gate.releaseSlot("private-gate");
    }
    expect(await (await scrape()).text()).toContain("durindoor_admission_queued_requests 0\n");
    metrics.clearProviderHealth();
    const unavailable = await (await scrape()).text();
    expect(unavailable).toContain("durindoor_provider_health_snapshot_available 0\n");
    expect(unavailable).not.toContain("durindoor_provider_connections{");
  });

  it("exports bounded stall diagnostics and admission correlation", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    metrics.startOperationalMetricsRuntime();
    metrics.recordAdmissionFailure("timeout");
    now = 7000;
    await vi.advanceTimersByTimeAsync(1000);
    const body = await (await scrape()).text();
    expect(body).toContain("durindoor_event_loop_stalls_total 1\n");
    expect(body).toContain("durindoor_event_loop_stall_max_seconds 6\n");
    expect(body).toContain("durindoor_event_loop_last_stall_admission_failures 1\n");
    for (let i = 0; i < 30; i++) metrics.recordAdmissionFailure("aborted");
    expect(metrics.getOperationalDiagnostics()).toHaveLength(16);
  });
});
