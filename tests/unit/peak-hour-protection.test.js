import { describe, expect, it } from "vitest";
import {
  describePeakHourWindow,
  evaluatePeakHourProtection,
  normalizePeakHourProtection,
} from "@/lib/providers/peakHourProtection";

// port(omniroute): provider peak-hour protection windows (OmniRoute
// c11f661a8, #11622), adapted from tests/unit/peak-hour-protection.test.ts.

describe("peak-hour protection", () => {
  it("activates inside weekday UTC windows", () => {
    const state = evaluatePeakHourProtection(
      {
        peakHourProtection: {
          enabled: true,
          mode: "block",
          windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], startUtc: "01:00", endUtc: "04:00" }],
        },
      },
      new Date("2026-08-24T01:30:00.000Z"),
    );

    expect(state.active).toBe(true);
    expect(state.mode).toBe("block");
    expect(state.retryAfter).toBe("2026-08-24T04:00:00.000Z");
    expect(state.retryAfterSeconds).toBe(9000);
  });

  it("honors weekdays and the end boundary", () => {
    const providerSpecificData = {
      peakHourProtection: {
        enabled: true,
        windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], startUtc: "06:00", endUtc: "10:00" }],
      },
    };

    // Saturday (2026-08-22): not a configured day.
    expect(evaluatePeakHourProtection(providerSpecificData, new Date("2026-08-22T06:30:00.000Z"))).toEqual({
      active: false,
    });
    // Exactly at the end boundary: exclusive.
    expect(evaluatePeakHourProtection(providerSpecificData, new Date("2026-08-24T10:00:00.000Z"))).toEqual({
      active: false,
    });
  });

  it("supports daily windows and avoid mode", () => {
    const state = evaluatePeakHourProtection(
      {
        peakHourProtection: {
          enabled: true,
          mode: "avoid",
          windows: [{ name: "Z.ai peak", startUtc: "06:00", endUtc: "10:00" }],
        },
      },
      new Date("2026-08-23T06:30:00.000Z"),
    );

    expect(state.active).toBe(true);
    expect(state.mode).toBe("avoid");
    expect(describePeakHourWindow(state.window)).toBe("Z.ai peak daily 06:00-10:00 UTC");
  });

  it("supports an overnight window that wraps past midnight", () => {
    const config = {
      peakHourProtection: { enabled: true, mode: "block", windows: [{ startUtc: "22:00", endUtc: "02:00" }] },
    };
    expect(evaluatePeakHourProtection(config, new Date("2026-08-23T23:00:00.000Z")).active).toBe(true);
    expect(evaluatePeakHourProtection(config, new Date("2026-08-24T01:00:00.000Z")).active).toBe(true);
    expect(evaluatePeakHourProtection(config, new Date("2026-08-24T12:00:00.000Z")).active).toBe(false);
  });

  it("drops malformed windows but keeps operator intent", () => {
    expect(
      normalizePeakHourProtection({
        enabled: true,
        mode: "avoid",
        windows: [
          { startUtc: "bad", endUtc: "10:00" },
          { days: ["mon", "nope", "mon"], startUtc: "6:00", endUtc: "10:00" },
        ],
      }),
    ).toEqual({
      enabled: true,
      mode: "avoid",
      windows: [{ days: ["mon"], startUtc: "06:00", endUtc: "10:00" }],
    });
  });

  it("returns null for a disabled config with no windows", () => {
    expect(normalizePeakHourProtection({ enabled: false, windows: [] })).toBeNull();
    expect(normalizePeakHourProtection(undefined)).toBeNull();
  });
});
