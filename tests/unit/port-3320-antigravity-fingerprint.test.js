import { describe, it, expect } from "vitest";
import {
  ANTIGRAVITY_IDE_VERSION,
  ANTIGRAVITY_IDE_USER_AGENT,
} from "../../open-sse/providers/shared.js";

// Fingerprint pin. Port of 9router #3320 originally pinned 2.5.5; later ports
// bumped it to 2.11.0 (70f15aa5) and then to the Hub 2.24.0 client identity
// (cff2b1d9 2.22.0, superseded by f172c3c4 hub/2.24.0).
describe("Antigravity Hub fingerprint pin (2.24.0, supersedes 2.11.0)", () => {
  it("exports the 2.24.0 client version constant", () => {
    expect(ANTIGRAVITY_IDE_VERSION).toBe("2.24.0");
  });

  it("builds the matching Hub User-Agent string", () => {
    expect(ANTIGRAVITY_IDE_USER_AGENT).toBe(
      "antigravity/hub/2.24.0 darwin/arm64",
    );
  });
});
