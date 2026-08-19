import { describe, it, expect } from "vitest";
import {
  ANTIGRAVITY_IDE_VERSION,
  ANTIGRAVITY_IDE_USER_AGENT,
} from "../../open-sse/providers/shared.js";

describe("port 9router #3320 — Antigravity IDE fingerprint 2.5.5", () => {
  it("exports the 2.5.5 IDE version constant", () => {
    expect(ANTIGRAVITY_IDE_VERSION).toBe("2.5.5");
  });

  it("builds the matching User-Agent string", () => {
    expect(ANTIGRAVITY_IDE_USER_AGENT).toBe(
      "antigravity/ide/2.5.5 darwin/arm64",
    );
  });
});
