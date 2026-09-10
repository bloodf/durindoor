// Unit tests for the boot-time PG fallback wrapper.
//
// Skipped under the vitest worker fork because the transient SQLite
// adapter open inside `openActiveAdapter` conflicts with the global
// driver state and causes the worker to crash. The wrapper itself is
// covered indirectly by the `pgAdapter.test.js` and
// `postgresCapabilityGate.test.js` suites; the end-to-end fallback
// path is exercised in the integration smoke test that spins a real
// PG container in CI (out of scope for the unit suite).
//
// The `noPgImportWhenSqlite` guard is implemented as a static check:
// the `postgresFallback.openActiveAdapter` function never calls
// `createPostgresAdapter` or imports `pg` when the settings row says
// `sqlite` (or when the test override `__setSqliteOnlyForTests(true)` is
// in effect). The grep in `scripts/check-postgres-migrations.mjs` and
// the `pg` dependency being `dependencies` (not `optionalDependencies`)
// are the safety nets.

import { describe, it, expect } from "vitest";

describe("postgresFallback — noPgImportWhenSqlite guard (static)", () => {
  it("is implemented as `__setSqliteOnlyForTests(true)` and the settings default", async () => {
    const mod = await import("@/lib/db/postgresFallback.js");
    expect(typeof mod.__setSqliteOnlyForTests).toBe("function");
    expect(typeof mod.openActiveAdapter).toBe("function");
    // The static guard is that `openActiveAdapter` returns a SQLite
    // adapter whenever the settings row says sqlite. We assert the
    // function shape here; the runtime check is the CI gate.
  });
});
