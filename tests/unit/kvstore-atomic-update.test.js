import { describe, expect, it } from "vitest";

// customKv.update must serialize concurrent read-merge-writes inside one DB
// transaction so neither PATCH's capability merge is lost (Codex P2 on #331).
describe("kvStore atomic update", () => {
  it("preserves both merges from interleaved updates", async () => {
    const { makeKv } = await import("../../src/lib/db/helpers/kvStore.js");
    const kv = makeKv("test-atomic-" + Date.now());
    await kv.set("k", { capabilities: { a: 1 } });
    await Promise.all([
      kv.update("k", (cur) => ({ ...cur, capabilities: { ...cur.capabilities, b: 2 } })),
      kv.update("k", (cur) => ({ ...cur, capabilities: { ...cur.capabilities, c: 3 } })),
    ]);
    const final = await kv.get("k");
    expect(final.capabilities).toMatchObject({ a: 1, b: 2, c: 3 });
    await kv.clear();
  });

  it("returns undefined and writes nothing for a missing row", async () => {
    const { makeKv } = await import("../../src/lib/db/helpers/kvStore.js");
    const kv = makeKv("test-atomic2-" + Date.now());
    const out = await kv.update("missing", (cur) => (cur ? { ...cur } : undefined));
    expect(out).toBeUndefined();
    expect(await kv.get("missing")).toBeNull();
  });
});
