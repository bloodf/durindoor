import { describe, expect, it } from "vitest";

import { OpenCodeExecutor, OPENCODE_SESSION_RE } from "../../open-sse/executors/opencode.js";

// OpenCode Zen validates that the 12-hex prefix of a `ses_` id decodes to a
// RECENT inverted timestamp (~(ms * 4096 + counter)). A digest-derived prefix
// is random bits, so Zen refuses it with 403 FreeTierError and every
// non-OpenCode client (curl, Claude Code, omp, pi) is locked out of the free
// tier. The id is minted from the current time and memoized per downstream
// session instead.
const PREFIX_MASK = 0xffffffffffffn;
const decodedUnits = (id) => PREFIX_MASK - BigInt("0x" + id.slice(4, 16));

describe("OpenCode canonical free-tier session id", () => {
  const sessionFor = (providerSessionId, clientTool = "claude") =>
    new OpenCodeExecutor().prepareRequestCredentials({
      credentials: { connectionId: "conn-a" },
      providerSessionId,
      clientTool,
    })._opencodeSession;

  it("encodes a recent timestamp, not hash bits", () => {
    const id = sessionFor("conv-a");
    expect(id).toMatch(OPENCODE_SESSION_RE);

    const nowUnits = (BigInt(Date.now()) * 0x1000n) & PREFIX_MASK;
    const diffMs = Number((decodedUnits(id) - nowUnits) / 0x1000n);
    expect(Math.abs(diffMs)).toBeLessThan(60_000);
  });

  it("is stable for the same downstream session and differs across sessions", () => {
    const first = sessionFor("conv-a");
    expect(sessionFor("conv-a")).toBe(first);
    expect(sessionFor("conv-b")).not.toBe(first);
    expect(sessionFor("conv-a", "codex")).not.toBe(first);
  });

  it("passes an already valid native session through untouched", () => {
    const native = "ses_0123456789abghijklmnopqrst";
    const session = new OpenCodeExecutor().prepareRequestCredentials({
      credentials: { connectionId: "conn-a", rawHeaders: { "x-opencode-session": native } },
      providerSessionId: "conv-a",
      clientTool: "claude",
    })._opencodeSession;

    expect(session).toBe(native);
  });
});
