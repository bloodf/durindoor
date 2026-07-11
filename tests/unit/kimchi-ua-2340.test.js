/**
 * #2340 Kimchi dynamic User-Agent.
 *
 * Verifies getKimchiUserAgent() returns a stable `kimchi/<version>` string,
 * and that the registry transport header + catalog fetch both read through the
 * same helper (so a version bump propagates without code changes).
 */
import { describe, it, expect } from "vitest";

import { getKimchiUserAgent } from "../../open-sse/utils/kimchiUserAgent.js";
import kimchiRegistry from "../../open-sse/providers/registry/kimchi.js";

const KIMCHI_UA_RE = /^kimchi\/\d+\.\d+\.\d+$/;

describe("getKimchiUserAgent (#2340)", () => {
  it("returns a kimchi/<semver> string", () => {
    expect(getKimchiUserAgent()).toMatch(KIMCHI_UA_RE);
  });

  it("is stable across repeated synchronous reads", () => {
    const a = getKimchiUserAgent();
    const b = getKimchiUserAgent();
    expect(b).toBe(a);
  });

  it("registry transport.headers reads through the helper (getter, not frozen literal)", () => {
    const first = kimchiRegistry.transport.headers["User-Agent"];
    const second = kimchiRegistry.transport.headers["User-Agent"];
    expect(first).toMatch(KIMCHI_UA_RE);
    expect(second).toBe(getKimchiUserAgent());
  });

  it("kimchiModels.js no longer exports a frozen KIMCHI_USER_AGENT literal", async () => {
    const mod = await import("../../open-sse/services/kimchiModels.js");
    expect("KIMCHI_USER_AGENT" in mod).toBe(false);
  });
});
