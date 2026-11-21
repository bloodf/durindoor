import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isIntentionalWorkerHandoff } = require("../../cli/src/cli/workerExit.js");

describe("worker ownership boundary for foreground supervision (#5420)", () => {
  it("accepts the reserved handoff only after stale ownership is absent", () => {
    expect(isIntentionalWorkerHandoff(75, 75, false)).toBe(true);
    expect(isIntentionalWorkerHandoff(75, 75, true)).toBe(false);
    expect(isIntentionalWorkerHandoff(0, 75, false)).toBe(false);
  });
});
