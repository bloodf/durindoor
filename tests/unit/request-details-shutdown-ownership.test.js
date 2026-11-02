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

  it("flushes immediately from a superseded instance that no longer owns listeners (#1407)", async () => {
    const first = await loadRepo();
    await loadRepo();
    await first.saveRequestDetail({ id: "stale-row", model: "m" });
    await vi.waitFor(() => expect(insertedIds()).toEqual(["stale-row"]));
  });

  it("ignores saves after dispose so no timer touches a closed adapter (#1407)", async () => {
    vi.useFakeTimers();
    try {
      const repo = await loadRepo();
      await repo.disposeRequestDetailsRepo();
      await repo.saveRequestDetail({ id: "late-row", model: "m" });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(insertedIds()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps rows of a failed batch and persists them on the next flush (#1407)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const repo = await loadRepo();
    await repo.saveRequestDetail({ id: "retry-row", model: "m" });
    let calls = 0;
    fakeDb.transaction = (fn) => { if (calls++ === 0) throw new Error("db busy"); return fn(); };
    await repo.disposeRequestDetailsRepo();
    expect(calls).toBe(2);
    expect(insertedIds()).toEqual(["retry-row"]);
    errSpy.mockRestore();
  });

  it("drops a batch after bounded failed retries and still terminates dispose (#1407)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.transaction = () => { throw new Error("db down"); };
    const repo = await loadRepo();
    await repo.saveRequestDetail({ id: "doomed-row", model: "m" });
    await repo.disposeRequestDetailsRepo();
    expect(insertedIds()).toEqual([]);
    expect(errSpy.mock.calls.flat().join(" ")).toContain("Dropping 1 rows after 3 failed flush retries");
    errSpy.mockRestore();
  });
});
