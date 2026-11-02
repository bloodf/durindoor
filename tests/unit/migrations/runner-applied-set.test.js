import { describe, it, expect, vi } from "vitest";
import { applyVersionedMigrations, hasPendingMigrations } from "@/lib/db/migrate.js";

// Minimal adapter backed by a Map for `_meta`. The SQLite and PostgreSQL
// metaStore paths differ only in placeholder syntax, so both are exercised.
function fakeAdapter(isPostgres, meta = {}) {
  const store = new Map(Object.entries(meta).map(([key, value]) => [key, String(value)]));
  return {
    capabilities: { isPostgres },
    store,
    get: (_sql, [key]) => (store.has(key) ? { value: store.get(key) } : undefined),
    run: (_sql, [key, value]) => { store.set(key, value); },
    transaction: (fn) => fn(),
  };
}

function migration(version, ran) {
  return { version, name: `m${version}`, up: () => ran.push(version) };
}

describe.each([["sqlite", false], ["postgres", true]])("versioned migration runner (%s)", (_engine, isPostgres) => {
  vi.spyOn(console, "log").mockImplementation(() => {});

  it("applies a lower version merged after a higher one was already applied", () => {
    const ran = [];
    const db = fakeAdapter(isPostgres);
    applyVersionedMigrations(db, [migration(25, ran), migration(27, ran)]);
    expect(ran).toEqual([25, 27]);
    expect(db.store.get("schemaVersion")).toBe("27");

    const later = [migration(25, ran), migration(26, ran), migration(27, ran)];
    expect(hasPendingMigrations(db, later)).toBe(true);
    const result = applyVersionedMigrations(db, later);
    expect(ran).toEqual([25, 27, 26]);
    expect(result).toEqual({ applied: 1, from: 27, to: 27 });
    expect(JSON.parse(db.store.get("appliedMigrations"))).toEqual([25, 26, 27]);
    expect(hasPendingMigrations(db, later)).toBe(false);
  });

  it("treats a database without the applied set as applied up to schemaVersion and records it", () => {
    const ran = [];
    const db = fakeAdapter(isPostgres, { schemaVersion: 25 });
    applyVersionedMigrations(db, [migration(24, ran), migration(25, ran)]);
    expect(ran).toEqual([]);
    expect(JSON.parse(db.store.get("appliedMigrations"))).toEqual([24, 25]);

    // A gap below the stored max is filled on the next boot.
    applyVersionedMigrations(db, [migration(24, ran), migration(25, ran), migration(27, ran)]);
    applyVersionedMigrations(db, [migration(24, ran), migration(25, ran), migration(26, ran), migration(27, ran)]);
    expect(ran).toEqual([27, 26]);
  });

  it("counts versions an older max-only runner applied above the recorded set", () => {
    const ran = [];
    const db = fakeAdapter(isPostgres, { schemaVersion: 27, appliedMigrations: "[24,25]" });
    applyVersionedMigrations(db, [migration(25, ran), migration(26, ran), migration(27, ran)]);
    expect(ran).toEqual([]);
    expect(JSON.parse(db.store.get("appliedMigrations"))).toEqual([24, 25, 26, 27]);
  });

  it("falls back to schemaVersion when the applied set is malformed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ran = [];
    const db = fakeAdapter(isPostgres, { schemaVersion: 25, appliedMigrations: "not json" });
    applyVersionedMigrations(db, [migration(25, ran), migration(26, ran)]);
    expect(ran).toEqual([26]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
