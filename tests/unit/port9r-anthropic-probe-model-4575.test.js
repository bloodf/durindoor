// Port of decolua/9router #4575: Anthropic connection probes use a current model, not retired claude-3-haiku.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { ANTHROPIC_VALIDATION_MODEL } from "../../src/shared/constants/anthropicValidation.js";

const PROBE_FILES = [
  "src/app/api/providers/[id]/test/testUtils.js",
  "src/app/api/providers/validate/route.js",
  "src/lib/providerHealthProbe.js",
  "src/app/api/providers/providerProbe.js",
];

describe("Anthropic validation probe model", () => {
  it("is a current, non-retired Haiku id", () => {
    expect(ANTHROPIC_VALIDATION_MODEL).toMatch(/^claude-haiku-4/);
  });

  it.each(PROBE_FILES)("%s no longer hardcodes the retired claude-3-haiku probe", (file) => {
    const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    expect(src).not.toContain("claude-3-haiku-20240307");
    expect(src).toContain("ANTHROPIC_VALIDATION_MODEL");
  });
});
