import { describe, expect, it } from "vitest";
import { CLI_TOOLS } from "../../src/shared/constants/cliTools.js";

describe("#2921 — Amp unsupported integration", () => {
  it("flags Amp as unsupported", () => {
    expect(CLI_TOOLS.amp.unsupported).toBe(true);
  });
});
