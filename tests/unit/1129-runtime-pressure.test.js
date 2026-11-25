import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:perf_hooks", () => ({ monitorEventLoopDelay: () => ({ enable() {} }) }));

afterEach(() => {
  clearInterval(globalThis.__durindoorOperationalMetrics?.runtime?.timer);
  delete globalThis.__durindoorOperationalMetrics;
  delete globalThis.__durindoorMetricsSampler;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("accepts early timer ticks and correlates a later stall with gate failures", async () => {
  vi.resetModules();
  vi.useFakeTimers();
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const metrics = await import("../../open-sse/services/operationalMetrics.js");
  metrics.startOperationalMetricsRuntime();
  now = 990;
  await vi.advanceTimersByTimeAsync(1000);
  expect(metrics.operationalMetricsText()).toContain("durindoor_runtime_sampler_reading_available 1\n");
  metrics.recordAdmissionFailure("timeout");
  now = 7990;
  await vi.advanceTimersByTimeAsync(1000);
  expect(metrics.getOperationalDiagnostics().at(-1)).toMatchObject({ kind: "stall", delaySeconds: 6, admissionFailures: 1 });
  expect(warn).not.toHaveBeenCalled();
});
