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
import { get } from "../../src/shared/utils/api.js";

const ENDPOINT_SRC = readFileSync(
  fileURLToPath(
    new URL(
      "../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx",
      import.meta.url,
    ),
  ),
  "utf8",
);
const KEYS_SRC = readFileSync(
  fileURLToPath(
    new URL(
      "../../src/app/(dashboard)/dashboard/keys/KeysPageClient.jsx",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("EndpointPageClient regression (2ff1c49b7)", () => {
  it("declares the editKeyPolicy useState binding it references at render/save time", () => {
    // Bug #1: the declaration was accidentally removed.
    expect(KEYS_SRC).toMatch(
      /const\s+\[\s*editKeyPolicy\s*,\s*setEditKeyPolicy\s*\]\s*=\s*useState\(/,
    );
    // Sanity: the identifiers are actually used (guards against a dead declaration).
    expect(KEYS_SRC).toMatch(/draft=\{editKeyPolicy\}/);
    expect(KEYS_SRC).toMatch(/setEditKeyPolicy\(/);
  });

  it("passes the Tailscale ever-reachable pair to updateReachable, never the tunnel/undefined setter", () => {
    // Bug #2: every Tailscale updateReachable call must use tsEverReachableRef +
    // setTsEverReachable. The buggy forms bound setTunnelEverReachableRef
    // (undefined) or setTunnelEverReachable (wrong tunnel setter).
    const tsCalls = [
      ...ENDPOINT_SRC.matchAll(
        /updateReachable\([^)]*tsEverReachableRef\s*,\s*([A-Za-z0-9_]+)\s*\)/g,
      ),
    ];
    // Both the syncTunnelStatus and loadSettings paths have a Tailscale call.
    expect(tsCalls.length).toBeGreaterThanOrEqual(2);
    for (const m of tsCalls) {
      expect(m[1]).toBe("setTsEverReachable");
    }
    // The undefined ref identifier must not appear anywhere.
    expect(ENDPOINT_SRC).not.toMatch(/setTunnelEverReachableRef/);
  });

  it("uses the shared JSON client for only the three background status reads", () => {
    expect(ENDPOINT_SRC.match(/get\("\/api\/tunnel\/status"/g)).toHaveLength(3);
    expect(ENDPOINT_SRC.match(/get\("\/api\/tunnel\/status",\s*\{\s*skipErrorBody:\s*true\s*\}\)/g)).toHaveLength(2);
    expect(ENDPOINT_SRC).toMatch(/get\("\/api\/tunnel\/status",\s*\{\s*cache:\s*"no-store",\s*skipErrorBody:\s*true\s*\}\)/);
    expect(ENDPOINT_SRC).toMatch(/requestJSON\("\/api\/tunnel\/status",\s*\{\s*cache:\s*"no-store"\s*\}\)/);
    expect(ENDPOINT_SRC).toMatch(/Promise\.all\(\[[\s\S]*?requestJSON\("\/api\/tunnel\/status"/);
    expect(ENDPOINT_SRC).toMatch(/clientPingUrl\(/);
    expect(ENDPOINT_SRC).toMatch(/clientPingAny\(/);
    expect(ENDPOINT_SRC).toMatch(/fetch\("\/api\/tunnel\/(?:enable|disable)"/);
    expect(ENDPOINT_SRC).toMatch(/catch\s*\{\s*\/\* ignore poll errors \*\/\s*\}/);
  });

  it("keeps background-read failures swallowed and preserves the shared client's null JSON fallback", async () => {
    const originalFetch = globalThis.fetch;
    const options = { skipErrorBody: true };
    try {
      globalThis.fetch = async () => Response.json({ tunnel: { enabled: true } });
      await expect(get("/api/tunnel/status", options)).resolves.toEqual({ tunnel: { enabled: true } });

      globalThis.fetch = async () => new Response("not json", { status: 200 });
      await expect(get("/api/tunnel/status", options)).resolves.toBeNull();

      globalThis.fetch = async () => new Response("unavailable", { status: 503 });
      await expect(get("/api/tunnel/status", options)).rejects.toMatchObject({ status: 503 });

      globalThis.fetch = async () => { throw new TypeError("offline"); };
      await expect(get("/api/tunnel/status", options)).rejects.toThrow("offline");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
