import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { canonicalizeProcessStartIdentity } = require("../../src/mitm/processIdentity.js");

describe("MITM process identity", () => {
  it("hashes a long macOS start/executable tuple into the PID-record bound", () => {
    const raw = `Fri Jul 10 10:00:00 2026 /Applications/${"very-long-worktree/".repeat(20)}node`;
    const identity = canonicalizeProcessStartIdentity("darwin", raw);

    expect(identity).toMatch(/^darwin:sha256:[a-f0-9]{64}$/);
    expect(identity.length).toBeLessThanOrEqual(200);
    expect(canonicalizeProcessStartIdentity("darwin", raw)).toBe(identity);
  });
});
