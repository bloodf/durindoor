#!/usr/bin/env node
// CI gate: the parallel PG migration files under
// `src/lib/db/migrations/postgres/` must match what the generator would
// produce, and shared version numbers must use the same `name` as SQLite.
// Extra PG-only versions (currently 019 pg-cutover-log) are allowed.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const result = spawnSync("node", [path.join(here, "migrate-sqlite-ddl-to-pg.mjs"), "--check"], {
  stdio: "inherit",
  cwd: repo,
});
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

function namesFromIndex(file) {
  const src = readFileSync(file, "utf8");
  const imports = [...src.matchAll(/from "\.\/(\d{3})-([^"]+)\.js"/g)];
  return imports.map((m) => ({ version: parseInt(m[1], 10), name: m[2] }));
}

const sqlite = namesFromIndex(path.join(repo, "src/lib/db/migrations/index.js"));
const pg = namesFromIndex(path.join(repo, "src/lib/db/migrations/postgres/index.js"));
const pgByVersion = new Map(pg.map((m) => [m.version, m.name]));
let dirty = false;
for (const s of sqlite) {
  const pgName = pgByVersion.get(s.version);
  if (!pgName) {
    console.error(`[check-postgres-migrations] missing PG migration for sqlite v${s.version} (${s.name})`);
    dirty = true;
    continue;
  }
  if (pgName !== s.name) {
    console.error(`[check-postgres-migrations] v${s.version} name mismatch: sqlite=${s.name} pg=${pgName}`);
    dirty = true;
  }
}

const pgDir = path.join(repo, "src/lib/db/migrations/postgres");
const expected = new Set(
  readdirSync(pgDir).filter((f) => /^\d{3}-.+\.js$/.test(f) || f === "index.js" || f === "000-bootstrap.js")
);
void expected;

if (dirty) process.exit(1);
console.log("[check-postgres-migrations] registry names match");
process.exit(0);
