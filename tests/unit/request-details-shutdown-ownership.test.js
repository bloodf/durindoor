import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const EVENTS = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
const SLOT = Symbol.for("durindoor.requestDetailsRepo.shutdown");
const REPO = "@/lib/db/repos/requestDetailsRepo.js";

const counts = () => Object.fromEntries(EVENTS.map((e) => [e, process.listenerCount(e)]));
let fakeDb;
let baseline;
let before;
let loaded = [];

async function loadRepo() {
  vi.resetModules();
  vi.doMock("@/lib/db/driver.js", () => ({ getAdapter: async () => fakeDb }));
  vi.doMock("@/lib/db/repos/settingsRepo.js", () => ({
    getSettings: async () => ({ observabilityBatchSize: 100, observabilityFlushIntervalMs: 60_000 }),
  }));
  const mod = await import(REPO);
  loaded.push(mod);
  return mod;
}

function insertedIds() {
  return fakeDb.run.mock.calls.filter(([sql]) => sql.startsWith("INSERT")).map(([, params]) => params[0]);
}

describe("requestDetailsRepo shutdown handler ownership", () => {
  beforeEach(() => {
    process.env.OBSERVABILITY_ENABLED = "true";
    fakeDb = { transaction: (fn) => fn(), run: vi.fn(), get: vi.fn(() => ({ c: 0 })), all: vi.fn(() => []) };
    delete globalThis[SLOT];
    baseline = counts();
    before = Object.fromEntries(EVENTS.map((e) => [e, process.listeners(e)]));
    loaded = [];
  });

  afterEach(async () => {
    for (const mod of loaded) await mod.disposeRequestDetailsRepo?.();
    // Drop anything this test leaked (e.g. against a pre-fix repo) so later tests start clean.
    for (const e of EVENTS) {
      for (const l of process.listeners(e)) if (!before[e].includes(l)) process.off(e, l);
    }
    delete globalThis[SLOT];
    delete process.env.OBSERVABILITY_ENABLED;
    vi.doUnmock("@/lib/db/driver.js");
    vi.doUnmock("@/lib/db/repos/settingsRepo.js");
    vi.resetModules();
  });

  it("restores baseline listener counts across setup/dispose/reset cycles", async () => {
    for (let cycle = 0; cycle < 2; cycle++) {
      const repo = await loadRepo();
      for (const e of EVENTS) expect(process.listenerCount(e)).toBe(baseline[e] + 1);
      await repo.disposeRequestDetailsRepo();
      expect(counts()).toEqual(baseline);
      expect(globalThis[SLOT]).toBeUndefined();
    }
  });

  it("keeps exactly one repo handler per event after 10 reimports", async () => {
    for (let i = 0; i < 10; i++) await loadRepo();
    for (const e of EVENTS) expect(process.listenerCount(e)).toBe(baseline[e] + 1);
    const active = globalThis[SLOT].handler;
    for (const e of EVENTS) expect(process.listeners(e).filter((l) => l === active)).toHaveLength(1);
  });

  it("never removes third-party listeners", async () => {
    const thirdParty = () => {};
    for (const e of EVENTS) process.on(e, thirdParty);
    try {
      for (let i = 0; i < 3; i++) await loadRepo();
      await loaded.at(-1).disposeRequestDetailsRepo();
      for (const e of EVENTS) {
        expect(process.listeners(e)).toContain(thirdParty);
        expect(process.listenerCount(e)).toBe(baseline[e] + 1);
      }
    } finally {
      for (const e of EVENTS) process.off(e, thirdParty);
    }
  });

  it("flushes rows buffered by the previous instance on reimport", async () => {
    const first = await loadRepo();
    await first.saveRequestDetail({ id: "old-row", model: "m" });
    expect(insertedIds()).toEqual([]);
    await loadRepo();
    await vi.waitFor(() => expect(insertedIds()).toEqual(["old-row"]));
  });

  it("flushes buffered rows on dispose", async () => {
    const repo = await loadRepo();
    await repo.saveRequestDetail({ id: "pending-row", model: "m" });
    await repo.disposeRequestDetailsRepo();
    expect(insertedIds()).toEqual(["pending-row"]);
  });
});
