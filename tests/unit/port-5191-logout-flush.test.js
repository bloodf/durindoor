import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ row: null, driver: "sql.js", flush: vi.fn() }));
vi.mock("../../src/lib/db/driver.js", () => {
  const adapter = {
    get: () => mocks.row,
    run: (_sql, [data]) => { mocks.row = { data }; },
    transaction: (fn) => fn(),
    flush: mocks.flush,
    get driver() { return mocks.driver; },
  };
  return { getAdapter: async () => adapter, getAdapterSync: () => adapter };
});

const { updateSettings } = await import("../../src/lib/db/repos/settingsRepo.js");

beforeEach(() => {
  mocks.row = null;
  mocks.driver = "sql.js";
  mocks.flush.mockReset();
});

describe("9router#5191 dashboard session revocation reaches disk", () => {
  it("flushes before reporting a new session epoch", async () => {
    mocks.flush.mockImplementation(() => expect(JSON.parse(mocks.row.data).passwordSessionEpoch).toBe("epoch-B"));
    await updateSettings({ passwordSessionEpoch: "epoch-B" });
    expect(mocks.flush).toHaveBeenCalledOnce();
  });

  it("rejects when the revocation cannot be persisted, so logout does not report success", async () => {
    mocks.flush.mockImplementation(() => { throw new Error("disk full"); });
    await expect(updateSettings({ passwordSessionEpoch: "epoch-B" })).rejects.toThrow("disk full");
  });

  it("does not force a checkpoint on a native adapter", async () => {
    mocks.driver = "better-sqlite3";
    await updateSettings({ passwordSessionEpoch: "epoch-B" });
    expect(mocks.flush).not.toHaveBeenCalled();
  });

  it("leaves unrelated settings writes on the adapter's own schedule", async () => {
    await updateSettings({ requireLogin: true });
    expect(mocks.flush).not.toHaveBeenCalled();
  });
});
