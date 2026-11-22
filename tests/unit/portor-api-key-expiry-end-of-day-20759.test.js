import { describe, expect, it } from "vitest";
import {
  endOfLocalDayAfterDays,
  expiryFromSelection,
  hasDayExpiryPreset,
} from "../../src/app/(dashboard)/dashboard/endpoint/apiKeyExpiry.js";

const parts = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()];

describe("API-key expiry end-of-day option (port of OmniRoute #20759)", () => {
  const now = new Date(2026, 10, 19, 15, 30).getTime();

  it("endOfLocalDayAfterDays lands on 23:59:00 local, rolling over months", () => {
    expect(parts(endOfLocalDayAfterDays(7, now))).toEqual([2026, 11, 26, 23, 59, 0, 0]);
    expect(parts(endOfLocalDayAfterDays(30, new Date(2026, 0, 31, 9).getTime()))).toEqual([2026, 3, 2, 23, 59, 0, 0]);
    expect(parts(endOfLocalDayAfterDays(0, now))).toEqual([2026, 11, 19, 23, 59, 0, 0]);
  });

  it("expiryFromSelection with endOfDay ends a day preset at 23:59 local", () => {
    const iso = expiryFromSelection("7", "", now, { endOfDay: true });
    expect(parts(new Date(iso))).toEqual([2026, 11, 26, 23, 59, 0, 0]);
  });

  it("default behaviour stays rolling and never/custom ignore endOfDay", () => {
    expect(expiryFromSelection("7", "", now)).toBe(new Date(now + 7 * 86_400_000).toISOString());
    expect(expiryFromSelection("never", "", now, { endOfDay: true })).toBeNull();
    expect(hasDayExpiryPreset("30")).toBe(true);
    expect(hasDayExpiryPreset("never")).toBe(false);
    expect(hasDayExpiryPreset("custom")).toBe(false);
  });
});
