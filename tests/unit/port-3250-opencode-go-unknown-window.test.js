import { describe, expect, it } from "vitest";
import { parseOpenCodeGoUsage } from "../../open-sse/services/usage/opencode-go.js";

const window = (percent, status = "ok") => ({ status, percent, resetsAt: "2026-08-12T19:57:51.596Z" });

describe("port(upstream): #3250 - OpenCode Go windows the parser does not know", () => {
  it("lists a new window after the known ones and counts it toward the limit", () => {
    const parsed = parseOpenCodeGoUsage({ usage: { daily: window(100, "rate-limited"), weekly: window(10), rolling: window(0) } });
    expect(Object.keys(parsed.quotas)).toEqual(["Rolling", "Weekly", "Daily"]);
    expect(parsed.quotas.Daily).toMatchObject({ used: 100, remainingPercentage: 0, resetAt: "2026-08-12T19:57:51.596Z" });
    expect(parsed.limitReached).toBe(true);
  });

  it("does not let an unknown key overwrite a known window", () => {
    const parsed = parseOpenCodeGoUsage({ usage: { Rolling: window(100), rolling: window(5) } });
    expect(parsed.quotas.Rolling.used).toBe(5);
    expect(Object.keys(parsed.quotas)).toEqual(["Rolling"]);
    expect(parsed.limitReached).toBe(false);
  });
});
