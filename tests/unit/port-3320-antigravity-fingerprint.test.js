import { describe, it, expect } from "vitest";
import {
  ANTIGRAVITY_IDE_VERSION,
  ANTIGRAVITY_IDE_USER_AGENT,
} from "../../open-sse/providers/shared.js";

// Fingerprint pin. Port of 9router #3320 originally pinned 2.5.5; the port of
// upstream direct commit 70f15aa5 (PRs #3728/#3732/#3735/#3736/#3737) bumps
// the fingerprint to 2.11.0, so this pin now guards the newer version.
describe("Antigravity IDE fingerprint pin (2.11.0, supersedes #3320 2.5.5)", () => {
  it("exports the 2.11.0 IDE version constant", () => {
    expect(ANTIGRAVITY_IDE_VERSION).toBe("2.11.0");
  });

  it("builds the matching User-Agent string", () => {
    expect(ANTIGRAVITY_IDE_USER_AGENT).toBe(
      "antigravity/ide/2.11.0 darwin/arm64",
    );
  });
});
