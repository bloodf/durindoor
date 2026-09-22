// Port of upstream 9router #4225: usage rows now carry the upstream call's
// duration and time to first token, and the dashboard reports throughput from
// them. Rows written before timing existed carry 0, which must not be counted.
import { describe, expect, it } from "vitest";
import { deriveLatencyRates, formatDurationMs, formatTps } from "@/shared/utils/usageFormat.js";

describe("deriveLatencyRates", () => {
  it("averages each figure over its own sample count", () => {
    const rates = deriveLatencyRates({
      latencyMs: 3000, ttftMs: 600, latencySamples: 3, ttftSamples: 2, timedCompletionTokens: 1200,
    });

    expect(rates.avgDurationMs).toBe(1000);
    expect(rates.avgTtftMs).toBe(300);
  });

  it("measures throughput against decode time, not total time", () => {
    // 900 tokens over 2000ms total with 500ms spent before the first token.
    const rates = deriveLatencyRates({
      latencyMs: 2000, ttftMs: 500, latencySamples: 1, ttftSamples: 1, timedCompletionTokens: 900,
    });

    expect(rates.avgTps).toBeCloseTo(900 / 1.5, 9);
  });

  it("ignores tokens from untimed rows", () => {
    // Two requests, one timed: only the timed one's tokens back the rate.
    const rates = deriveLatencyRates({
      latencyMs: 1000, ttftMs: 0, latencySamples: 1, ttftSamples: 0, timedCompletionTokens: 100,
    });

    expect(rates.avgTps).toBeCloseTo(100, 9);
    expect(rates.avgTtftMs).toBeNull();
  });

  it("reports null rather than zero when nothing was timed", () => {
    expect(deriveLatencyRates({ latencyMs: 0, completionTokens: 5000 })).toEqual({
      avgDurationMs: null, avgTtftMs: null, avgTps: null,
    });
    expect(deriveLatencyRates()).toEqual({ avgDurationMs: null, avgTtftMs: null, avgTps: null });
  });

  it("does not invent a rate when time to first token swallows the request", () => {
    const rates = deriveLatencyRates({
      latencyMs: 500, ttftMs: 500, latencySamples: 1, ttftSamples: 1, timedCompletionTokens: 10,
    });

    expect(rates.avgTps).toBeNull();
  });
});

describe("timing formatters", () => {
  it("keeps the unit across the ms/s/min boundaries", () => {
    expect(formatDurationMs(842)).toBe("842 ms");
    expect(formatDurationMs(1500)).toBe("1.5 s");
    expect(formatDurationMs(125000)).toBe("2m 5s");
  });

  it("marks an absent sample instead of printing zero", () => {
    expect(formatDurationMs(0)).toBe("-");
    expect(formatDurationMs(null)).toBe("-");
    expect(formatTps(null)).toBe("-");
    expect(formatTps(0)).toBe("-");
  });

  it("tightens precision as the rate grows", () => {
    expect(formatTps(3.14159)).toBe("3.14");
    expect(formatTps(42.42)).toBe("42.4");
    expect(formatTps(318.7)).toBe("319");
  });
});
