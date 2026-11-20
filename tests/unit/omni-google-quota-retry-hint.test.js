import { describe, expect, it } from "vitest";
import { parseRateLimitEvidence } from "../../open-sse/utils/error.js";

const now = Date.parse("2026-01-01T00:00:00Z");
const body = (metadata, type = "type.googleapis.com/google.rpc.ErrorInfo") => JSON.stringify({
  error: { details: [{ "@type": type, reason: "QUOTA_EXHAUSTED", metadata }] }
});
const evidence = (metadata, extra = {}) => parseRateLimitEvidence({ status: 429, now, bodyText: body(metadata), ...extra });

describe("Google quota reset hints", () => {
  it.each([["2h7m23s", 7_643_000], ["45m3s", 2_703_000], ["2h7m", 7_620_000], ["1h0m0.5s", 3_600_500], ["26.66s", 26_660], ["1500ms", 1500], ["12", 12_000]])("reads %s", (delay, ms) => {
    expect(evidence({ quotaResetDelay: delay })).toMatchObject({ state: "cooldown", resetAtMs: now + ms, source: "structured_body" });
  });
  it("prefers a valid timestamp and explicit retry headers", () => {
    const metadata = { quotaResetTimeStamp: new Date(now + 120_000).toISOString(), quotaResetDelay: "2h" };
    expect(evidence(metadata).resetAtMs).toBe(now + 120_000);
    expect(evidence(metadata, { headers: new Headers({ "retry-after": "30" }) })).toMatchObject({ resetAtMs: now + 30_000, source: "retry_after" });
  });
  it("rejects malformed, past and over-ceiling hints while accepting a valid fallback", () => {
    for (const delay of ["2hgarbage", "-1s", "0s", "999999999h", {}, "1h2m3s! "]) {
      expect(evidence({ quotaResetDelay: delay }).resetAtMs).toBeNull();
    }
    expect(evidence({ quotaResetTimeStamp: new Date(now - 1).toISOString(), quotaResetDelay: "2m" }).resetAtMs).toBe(now + 120_000);
    expect(evidence({ quotaResetDelay: "2h" }, { maxDelayMs: 60_000 }).resetAtMs).toBeNull();
    expect(evidence({ quotaResetDelay: "2h" }, { bodyText: body({ quotaResetDelay: "2h" }, "other") }).resetAtMs).toBeNull();
    expect(evidence({ quotaResetDelay: "2h" }, { status: 400 })).toBeNull();
  });
});
