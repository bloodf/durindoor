import { describe, expect, it } from "vitest";
import { formatPxpipeEvent } from "../../src/app/(dashboard)/dashboard/pxpipe/formatPxpipeEvent.js";

// Event shape from src/lib/pxpipe/events.js: appendPxpipeEvent writes
// { ts, provider, model, applied, reason, tokensSavedEst, imageCount, durationMs }.
describe("formatPxpipeEvent", () => {
  it("formats an applied compression event with metrics", () => {
    const line = formatPxpipeEvent({
      ts: Date.UTC(2026, 6, 17, 12, 0, 0),
      provider: "claude",
      model: "claude-sonnet-4-5",
      applied: true,
      imageCount: 3,
      tokensSavedEst: 12500,
      durationMs: 420,
    });
    expect(line).toBe(
      "[2026-07-17T12:00:00.000Z] claude/claude-sonnet-4-5 compressed 3 img, ~12.5K tokens saved in 420ms",
    );
  });

  it("formats a skipped event with mapped reason", () => {
    const line = formatPxpipeEvent({
      ts: Date.UTC(2026, 6, 17, 12, 0, 0),
      provider: "openai",
      model: "gpt-5.6",
      applied: false,
      reason: "below_min_chars",
    });
    expect(line).toContain("openai/gpt-5.6 skipped — Below minimum chars");
  });

  it("tolerates missing fields", () => {
    expect(formatPxpipeEvent({})).toBe("skipped");
  });
});
