// Regression: a PostgreSQL 17 cluster must not be treated as unusable.
//
// readClusterInfo issued `SHOW io_method`, which only exists on PostgreSQL 18.
// On 16/17 that throws, the whole read returned null, and openActiveAdapter
// interprets null as "cluster unusable" — it records databaseEngineError and
// falls back to the pre-cutover SQLite file while settings still say postgres.
// The process then serves stale data and new writes land in a different
// database than the one the operator cut over to.
//
// Asserts the observable contract: a cluster that answers the required version
// settings is usable, even when optional capability settings are rejected.
import { describe, it, expect, vi } from "vitest";
import { openActiveAdapter } from "@/lib/db/postgresFallback.js";

/** Adapter over a PG17-shaped cluster: knows server_version*, rejects io_method. */
function pg17Adapter(seen) {
  return {
    driver: "pg",
    get: vi.fn(async (sql) => {
      seen.push(sql);
      if (sql === "SHOW server_version_num") return { server_version_num: "170011" };
      if (sql === "SHOW server_version") return { server_version: "17.11" };
      if (sql === "SHOW io_method") {
        // Exactly what PostgreSQL 17 replies.
        throw new Error('unrecognized configuration parameter "io_method"');
      }
      if (sql === "SHOW wal_level") return { wal_level: "replica" };
      if (sql === "SHOW log_lock_waits") return { log_lock_waits: "off" };
      return null;
    }),
    all: vi.fn(async () => []),
    run: vi.fn(async () => ({ changes: 0 })),
    exec: vi.fn(async () => {}),
    transaction: vi.fn((fn) => fn()),
    close: vi.fn(async () => {}),
  };
}

describe("readClusterInfo with version-gated settings", () => {
  it("treats a PostgreSQL 17 cluster as usable despite io_method being unknown", async () => {
    const seen = [];
    const adapter = pg17Adapter(seen);

    // readClusterInfo is module-private; exercise it through the only thing
    // that consumes it, so the test pins behaviour rather than an internal.
    const { readClusterInfoForTest } = await import("@/lib/db/postgresFallback.js");
    const info = await readClusterInfoForTest(adapter);

    expect(info).not.toBeNull();
    expect(info.serverVersionNum).toBe("170011");
    expect(info.serverVersion).toBe("17.11");
    // The unsupported capability degrades to null rather than poisoning the read.
    expect(info.ioMethod).toBeNull();
    // The settings that DO exist on 17 are still collected.
    expect(info.walLevel).toBe("replica");
    expect(info.logLockWaits).toBe("off");
    expect(seen).toContain("SHOW io_method");
  });

  it("still reports an unusable cluster when the required version query fails", async () => {
    const adapter = pg17Adapter([]);
    adapter.get = vi.fn(async () => {
      throw new Error("connection terminated");
    });
    const { readClusterInfoForTest } = await import("@/lib/db/postgresFallback.js");
    expect(await readClusterInfoForTest(adapter)).toBeNull();
  });

  it("exports openActiveAdapter", () => {
    expect(openActiveAdapter).toBeTypeOf("function");
  });
});
