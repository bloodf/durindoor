// Regression for CR-B-2: zenmux-free.js must not hardcode the Anthropic API
// version literal; it must import the single source of truth
// ANTHROPIC_API_VERSION from open-sse/providers/shared.js so a future
// version bump is one-place.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const zenmuxFreePath = fileURLToPath(
  new URL("../../open-sse/executors/zenmux-free.js", import.meta.url),
);
const sharedPath = fileURLToPath(
  new URL("../../open-sse/providers/shared.js", import.meta.url),
);

describe("zenmux-free anthropic-version source of truth", () => {
  const src = readFileSync(zenmuxFreePath, "utf8");

  it("contains no hardcoded anthropic-version literal", () => {
    expect(src).not.toContain('"anthropic-version": "2023-06-01"');
    expect(src).not.toContain('"anthropic-version": "');
  });

  it("imports ANTHROPIC_API_VERSION from providers/shared.js", () => {
    expect(src).toContain(
      'import { ANTHROPIC_API_VERSION } from "../providers/shared.js";',
    );
  });

  it("uses the imported constant in the request headers", () => {
    expect(src).toContain('"anthropic-version": ANTHROPIC_API_VERSION');
  });

  it("shared.js still exports the constant", () => {
    const shared = readFileSync(sharedPath, "utf8");
    expect(shared).toMatch(/export const ANTHROPIC_API_VERSION = "2023-06-01";/);
  });
});

describe("executors/index.js duplicate key regression (CR-B-1)", () => {
  const indexPath = fileURLToPath(
    new URL("../../open-sse/executors/index.js", import.meta.url),
  );
  const indexSrc = readFileSync(indexPath, "utf8");

  it("registers the mimocode executor key exactly once", () => {
    const occurrences = indexSrc.match(/\bmimocode:\s*new MimocodeExecutor\(\)/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("registers the mcode alias key exactly once", () => {
    const occurrences = indexSrc.match(/\bmcode:\s*new MimocodeExecutor\(\)/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });
});
