#!/usr/bin/env node
// CI gate: the parallel PG migration files under
// `src/lib/db/migrations/postgres/` must match what the generator would
// produce. This mirrors the discipline of `scripts/check-registry-index.mjs`.
//
// Exit 0 on match, 1 on mismatch (with instructions to regenerate).

import { spawnSync } from "node:child_process";

const here = new URL(".", import.meta.url).pathname;
const result = spawnSync("node", [`${here}migrate-sqlite-ddl-to-pg.mjs`, "--check"], {
  stdio: "inherit",
  cwd: new URL("..", import.meta.url).pathname,
});
process.exit(result.status ?? 1);
