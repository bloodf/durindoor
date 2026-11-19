import { describe, expect, it } from "vitest";
import { getNextBuildCpus } from "../../next-build-cpus.mjs";

describe("Next.js build CPU allowance", () => {
  it.each([
    [24, "3", 2],
    [1, "3", 1],
    [2, "10", 1],
    [10, "invalid", 9],
    [10, "0", 9],
    [10, undefined, 9],
  ])("bounds %i affinity CPUs by CI budget %s to %i workers", (affinity, budget, expected) => {
    expect(getNextBuildCpus(affinity, budget)).toBe(expected);
  });
});
