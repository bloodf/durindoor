import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const captureTest = readFileSync(new URL("./1131-capture-storage.test.js", import.meta.url), "utf8");
const geminiTest = readFileSync(new URL("./gemini-web-provider.test.js", import.meta.url), "utf8");

describe("test stability regressions", () => {
  it("resets capture fixture state before each case", () => {
    expect(captureTest).toMatch(/beforeEach\(\(\) => \{[\s\S]*?DELETE FROM "sessionCaptureTurns"[\s\S]*?DELETE FROM apiKeys[\s\S]*?DELETE FROM settings WHERE id = 1/);
  });

  it("waits for Gemini contexts to close before asserting teardown", () => {
    expect(geminiTest).toMatch(/await vi\.waitFor\(\(\) => \{[\s\S]*?expect\(context\.closed\)\.toBe\(true\)/);
  });
});
