import { describe, expect, it, vi } from "vitest";
import { assertCheckpointComplete } from "../../src/lib/db/helpers/checkpoint.js";

describe("pre-migration checkpoint safety", () => {
  it("accepts only a complete non-busy SQLite checkpoint", () => {
    expect(assertCheckpointComplete([{ busy: 0, log: 4, checkpointed: 4 }], "test")).toMatchObject({ busy: 0 });
    expect(() => assertCheckpointComplete([{ busy: 1, log: 4, checkpointed: 0 }], "test")).toThrow(/busy/);
    expect(() => assertCheckpointComplete(undefined, "test")).toThrow(/no status row/);
  });

  it("aborts an upgrade before schema mutation when checkpointing fails", async () => {
    vi.resetModules();
    const { runMigrationOnce } = await import("../../src/lib/db/migrate.js");
    const adapter = {
      get: vi.fn((sql, params = []) => {
        if (sql.includes("COUNT(*)") && sql.includes("_meta")) return { c: 2 };
        if (sql.includes("SELECT value FROM _meta") && params[0] === "schemaVersion") return { value: "3" };
        if (sql.includes("SELECT value FROM _meta") && params[0] === "appVersion") return { value: "1.0.1" };
        return undefined;
      }),
      all: vi.fn(() => []),
      checkpoint: vi.fn(async () => { throw new Error("checkpoint busy"); }),
      exec: vi.fn(),
      run: vi.fn(),
      transaction: vi.fn((fn) => fn()),
    };

    await expect(runMigrationOnce(adapter)).rejects.toThrow("checkpoint busy");
    expect(adapter.exec).not.toHaveBeenCalled();
    expect(adapter.run).not.toHaveBeenCalled();
  });
});
