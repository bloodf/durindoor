/**
 * Regression guard for the endpoint dashboard page.
 *
 * Two bugs were introduced by durindoor commit 2ff1c49b7 in
 * src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx:
 *
 *   1. The `const [editKeyPolicy, setEditKeyPolicy] = useState(...)` declaration
 *      was clobbered by the new external-tunnel state, while the Edit modal
 *      (`draft={editKeyPolicy}`) and the edit/save handlers
 *      (`setEditKeyPolicy(...)`, `apiKeyPolicyPatchFromDraft(editKeyPolicy, ...)`)
 *      still reference both identifiers. Opening the Edit-API-Key modal threw
 *      `ReferenceError: editKeyPolicy is not defined`.
 *   2. The Tailscale `updateReachable(...)` calls passed a nonexistent
 *      `setTunnelEverReachableRef` (and, on the other path, the *tunnel* setter)
 *      instead of the Tailscale pair `tsEverReachableRef, setTsEverReachable`.
 *      The status-poll effect threw `setTunnelEverReachableRef is not a function`
 *      once a Tailscale reachable-transition fired.
 *
 * Both bugs only fire on state-/effect-driven code paths (modal open, poll
 * transition) that a static `renderToStaticMarkup` of the default component
 * cannot reach, and this repo carries no jsdom / testing-library harness. So the
 * guard asserts the two source invariants directly — it fails the instant either
 * bug is reintroduced, and passes only when both bindings are correct.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  fileURLToPath(
    new URL(
      "../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("EndpointPageClient regression (2ff1c49b7)", () => {
  it("declares the editKeyPolicy useState binding it references at render/save time", () => {
    // Bug #1: the declaration was accidentally removed.
    expect(SRC).toMatch(
      /const\s+\[\s*editKeyPolicy\s*,\s*setEditKeyPolicy\s*\]\s*=\s*useState\(/,
    );
    // Sanity: the identifiers are actually used (guards against a dead declaration).
    expect(SRC).toMatch(/draft=\{editKeyPolicy\}/);
    expect(SRC).toMatch(/setEditKeyPolicy\(/);
  });

  it("passes the Tailscale ever-reachable pair to updateReachable, never the tunnel/undefined setter", () => {
    // Bug #2: every Tailscale updateReachable call must use tsEverReachableRef +
    // setTsEverReachable. The buggy forms bound setTunnelEverReachableRef
    // (undefined) or setTunnelEverReachable (wrong tunnel setter).
    const tsCalls = [
      ...SRC.matchAll(
        /updateReachable\([^)]*tsEverReachableRef\s*,\s*([A-Za-z0-9_]+)\s*\)/g,
      ),
    ];
    // Both the syncTunnelStatus and loadSettings paths have a Tailscale call.
    expect(tsCalls.length).toBeGreaterThanOrEqual(2);
    for (const m of tsCalls) {
      expect(m[1]).toBe("setTsEverReachable");
    }
    // The undefined ref identifier must not appear anywhere.
    expect(SRC).not.toMatch(/setTunnelEverReachableRef/);
  });
});
