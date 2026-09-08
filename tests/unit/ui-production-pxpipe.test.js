import { describe, expect, it, vi } from "vitest";
import {
  fmtTokens,
  formatPxpipeEvent,
  PXPIPE_REASON_LABELS,
} from "../../src/app/(dashboard)/dashboard/pxpipe/formatPxpipeEvent.js";
import {
  fetchPxpipeStatus,
  getPxpipeStatusTone,
  getPxpipeStatusView,
} from "../../src/app/(dashboard)/dashboard/pxpipe/pxpipeStatus.js";

describe("ui-production/pxpipe: formatPxpipeEvent", () => {
  it("renders an applied event with provider/model and savings", () => {
    const line = formatPxpipeEvent({
      ts: Date.UTC(2026, 8, 6, 12, 0, 0),
      provider: "claude",
      model: "claude-sonnet-4-5",
      applied: true,
      imageCount: 3,
      tokensSavedEst: 5400,
      durationMs: 220,
    });
    expect(line).toContain("claude/claude-sonnet-4-5");
    expect(line).toContain("compressed 3 img");
    expect(line).toContain("5.4K tokens saved");
    expect(line).toContain("220ms");
  });

  it("falls back to the mapped reason label for a skipped event", () => {
    const line = formatPxpipeEvent({
      ts: Date.UTC(2026, 8, 6, 12, 0, 0),
      provider: "openai",
      model: "gpt-5.6",
      applied: false,
      reason: "below_threshold",
    });
    expect(line).toContain("openai/gpt-5.6");
    expect(line).toContain(PXPIPE_REASON_LABELS.below_threshold);
  });

  it("falls back to the raw reason when the label is unknown", () => {
    const line = formatPxpipeEvent({ applied: false, reason: "future_reason" });
    expect(line).toContain("future_reason");
  });

  it("handles missing fields without throwing", () => {
    expect(formatPxpipeEvent({})).toBe("skipped");
  });

  it("formats small/mid/large token counts", () => {
    expect(fmtTokens(0)).toBe("0");
    expect(fmtTokens(950)).toBe("950");
    expect(fmtTokens(1_500)).toBe("1.5K");
    expect(fmtTokens(2_500_000)).toBe("2.50M");
  });
});

describe("ui-production/pxpipe: getPxpipeStatusView/Tone", () => {
  it("treats a populated installed/running status as Running", () => {
    expect(getPxpipeStatusView({ installed: true, running: true, enabled: true }).label).toBe("Running");
    expect(getPxpipeStatusTone({ installed: true, running: true }, null)).toBe("text-warning");
  });

  it("elevates a healthy health check to Healthy/success", () => {
    expect(getPxpipeStatusView({ installed: true, running: true, enabled: true }, { healthy: true }).label).toBe("Healthy");
    expect(getPxpipeStatusTone({ installed: true, running: true }, { healthy: true })).toBe("text-success");
  });

  it("flags an explicit API error above every other state", () => {
    expect(getPxpipeStatusView({ error: "PXPIPE daemon is not reachable" }).label).toBe("Unavailable");
    expect(getPxpipeStatusTone({ error: "PXPIPE daemon is not reachable" }, { healthy: true })).toBe("text-warning");
  });

  it("distinguishes 'not installed' (dependency missing) from plain Unavailable", () => {
    const view = getPxpipeStatusView({ installed: false });
    expect(view.label).toBe("Not installed");
    expect(view.dependencyMissing).toBe(true);
  });
});

describe("ui-production/pxpipe: fetchPxpipeStatus", () => {
  it("keeps a successful status payload and clears the error flag", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ installed: true, running: true }),
    }));
    const result = await fetchPxpipeStatus(fetchImpl);
    expect(result).toMatchObject({ installed: true, running: true, error: null, loading: false });
    expect(fetchImpl).toHaveBeenCalledWith("/api/pxpipe/status", expect.objectContaining({ headers: { "Cache-Control": "no-store" } }));
  });

  it("maps a 503 response to an unavailable state with the message", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "daemon offline" }),
    }));
    const result = await fetchPxpipeStatus(fetchImpl);
    expect(result.error).toBe("daemon offline");
    expect(result.loading).toBe(false);
  });

  it("maps a network error to an unavailable state", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network down"); });
    const result = await fetchPxpipeStatus(fetchImpl);
    expect(result.error).toBe("network down");
    expect(result.loading).toBe(false);
  });
});
