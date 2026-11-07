import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { monitorEventLoopDelay } from "node:perf_hooks";

const auth = vi.hoisted(() => ({ cli: vi.fn(), session: vi.fn(), admin: vi.fn() }));
const active = vi.hoisted(() => vi.fn());
const histogram = vi.hoisted(() => ({ enable: vi.fn(), percentile: vi.fn(() => 40000000), count: 1 }));
vi.mock("node:perf_hooks", () => ({ monitorEventLoopDelay: vi.fn(() => histogram) }));
vi.mock("@/dashboardGuard", () => ({ hasValidCliToken: auth.cli, hasValidToken: auth.session, isAdminScopedKey: auth.admin }));
vi.mock("@/lib/db/index.js", () => ({ getActiveRequests: active }));

import { GET } from "../../src/app/api/monitoring/metrics/route.js";

beforeEach(() => {
  vi.resetAllMocks();
  active.mockResolvedValue({ activeRequests: [{ count: 2, model: "secret-model", account: "secret-account" }] });
});

afterAll(() => { delete globalThis.__durindoorMetricsSampler; });

describe("operational metrics", () => {
  it("reuses one sampler after module reload", async () => {
    vi.resetModules();
    await import("../../src/app/api/monitoring/metrics/route.js");
    expect(monitorEventLoopDelay).not.toHaveBeenCalled();
    expect(globalThis.__durindoorMetricsSampler).toBe(histogram);
  });
  it("requires credentials even for loopback and emits only bounded aggregate values", async () => {
    const request = new Request("http://localhost/api/monitoring/metrics");
    expect((await GET(request)).status).toBe(401);
    expect(active).not.toHaveBeenCalled();
    auth.admin.mockResolvedValue(true);
    const response = await GET(request);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatch(/durindoor_active_requests 2\n/);
    expect(body).toMatch(/durindoor_process_uptime_seconds [\d.]+\n/);
    expect(body).toContain("durindoor_event_loop_delay_p99_seconds 0.04\n");
    expect(body).not.toMatch(/secret|model|account/);
    histogram.percentile.mockReturnValue(NaN);
    expect(await (await GET(request)).text()).not.toContain("durindoor_event_loop_delay_p99_seconds");
    for (const snapshot of [{}, { activeRequests: null }, { activeRequests: [{}] }, { activeRequests: [{ count: -1 }] }, { activeRequests: [{ count: Infinity }] }]) {
      active.mockResolvedValueOnce(snapshot);
      expect((await GET(request)).status).toBe(503);
    }
    active.mockRejectedValue(new Error("private credential"));
    const failed = await GET(request);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private credential");
  });
});
