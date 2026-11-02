import { describe, expect, it } from "vitest";
import { MIGRATIONS, latestVersion } from "../../src/lib/db/migrations/index.js";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SCHEMA_VERSION } from "../../src/lib/db/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../src/lib/db/migrations");

const migrationFiles = readdirSync(migrationsDir).filter(
  (name) => /^\d{3}-.*\.js$/.test(name) && name !== "index.js"
);

describe("db migrations registry", () => {
  it("imports every numeric migration file", () => {
    expect(MIGRATIONS.length).toBe(migrationFiles.length);
  });

  it("has no duplicate migration versions", () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("latestVersion equals the highest registered version", () => {
    const max = Math.max(...MIGRATIONS.map((m) => m.version));
    expect(latestVersion()).toBe(max);
    expect(SCHEMA_VERSION).toBe(max);
  });

  it("keeps the published v4 daily-limit, v5 expiry, and v6 policy sequence", () => {
    expect(MIGRATIONS.filter(({ version }) => version >= 4 && version <= 6).map(({ version, name }) => [version, name])).toEqual([
      [4, "add-daily-token-limit-to-api-keys"],
      [5, "api-key-expiry"],
      [6, "api-key-policy"],
    ]);
  });

  it("registers provider quota persistence after the immutable policy migration", () => {
    expect(MIGRATIONS.find(({ version }) => version === 7)?.name).toBe("provider-quota-snapshots");
    expect(MIGRATIONS.find(({ version }) => version === 8)?.name).toBe("quota-reservations");
  });
});
