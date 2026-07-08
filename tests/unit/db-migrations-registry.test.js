import { describe, expect, it } from "vitest";
import { MIGRATIONS, latestVersion } from "../../src/lib/db/migrations/index.js";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
  });
});
