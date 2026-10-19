import { describe, expect, it } from "vitest";
import { matchPattern } from "../../open-sse/providers/pricing.js";

describe("model glob matching", () => {
  it("preserves literal punctuation, case-insensitive wildcards and full-id matching on repeated calls", () => {
    for (let pass = 0; pass < 2; pass++) {
      expect(matchPattern("vendor/model[1m]+.*", "VENDOR/MODEL[1M]+.preview")).toBe(true);
      expect(matchPattern("vendor/model[1m]+.*", "vendor/model1m+.preview")).toBe(false);
      expect(matchPattern("vendor/model[1m]+.*", "prefix/vendor/model[1m]+.preview")).toBe(false);
      expect(matchPattern("exact", "EXACT")).toBe(true);
      expect(matchPattern("exact", "exact-extra")).toBe(false);
      expect(matchPattern("*", "")).toBe(true);
    }
  });

  it("preserves matching after more distinct patterns than the retained cache", () => {
    for (let index = 0; index < 600; index++) {
      expect(matchPattern(`model-${index}*`, `MODEL-${index}-preview`)).toBe(true);
      expect(matchPattern(`model-${index}*`, `other-${index}`)).toBe(false);
    }
    expect(matchPattern("vendor/model[1m]+.*", "vendor/model[1m]+.preview")).toBe(true);
    expect(matchPattern("vendor/model[1m]+.*", "vendor/model1m+.preview")).toBe(false);
  });
});
