// Port of decolua/9router#3917: the quota colour policy (`> 70` green, `>= 30`
// yellow, else red) lives once in ProviderLimits/utils.js; the progress bar,
// the table, getStatusColor and getStatusEmoji all read it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import {
  quotaStatusLevel,
  getStatusColor,
  getStatusEmoji,
  QUOTA_STATUS_HEALTHY_ABOVE,
  QUOTA_STATUS_WARNING_AT_OR_ABOVE,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const DIR = new URL("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/", import.meta.url);
const source = (name) => readFileSync(new URL(name, DIR), "utf8");

describe("port9r #3917 quota status thresholds", () => {
  it("pins the boundaries", () => {
    expect(QUOTA_STATUS_HEALTHY_ABOVE).toBe(70);
    expect(QUOTA_STATUS_WARNING_AT_OR_ABOVE).toBe(30);
    expect(quotaStatusLevel(100)).toBe("green");
    expect(quotaStatusLevel(70.1)).toBe("green");
    expect(quotaStatusLevel(70)).toBe("yellow");
    expect(quotaStatusLevel(30)).toBe("yellow");
    expect(quotaStatusLevel(29.9)).toBe("red");
    expect(quotaStatusLevel(0)).toBe("red");
  });

  it("colour and emoji accessors agree with the level at every step", () => {
    const EMOJI = { green: "\u{1F7E2}", yellow: "\u{1F7E1}", red: "\u{1F534}" };
    for (let p = 0; p <= 100; p += 0.5) {
      const level = quotaStatusLevel(p);
      expect(getStatusColor(p), `colour at ${p}%`).toBe(level);
      expect(getStatusEmoji(p), `emoji at ${p}%`).toBe(EMOJI[level]);
    }
  });

  it.each(["QuotaProgressBar.js", "QuotaTable.js"])("%s reads the shared policy instead of restating it", (name) => {
    const src = source(name);
    expect(src).toMatch(/import\s*\{[^}]*quotaStatusLevel[^}]*\}\s*from\s*"\.\/utils"/);
    expect(src).toMatch(/TONE_BY_LEVEL\[quotaStatusLevel\(/);
    expect(src).not.toMatch(/remaining\s*>=?\s*(70|30)\b/);
  });
});
