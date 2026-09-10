# feat(db): add opt-in PostgreSQL engine with safe SQLite→PG cutover

## Scope

Opt-in PostgreSQL engine. The default is unchanged (SQLite). A new
`Settings > Database` page in the dashboard lets an operator flip the
runtime to a remote PG cluster, run a strict-order cutover
(test → migrate → mirror → snapshot → flip → record), and roll back
to the most recent cutover snapshot if anything looks wrong.

## Test coverage

```bash
$ npx vitest run unit/db/dialects/postgres/ddl-translator.test.js
# 15 passed
$ npx vitest run unit/db/pgAdapter.test.js
# 19 passed
$ npx vitest run unit/db/postgresCapabilityGate.test.js
# 10 passed
$ npx vitest run unit/db/secrets.test.js
# 11 passed
$ npx vitest run unit/db/cutover.test.js
# 4 passed
$ npx vitest run unit/db/noPgImportWhenSqlite.test.js
# 3 passed
$ npx vitest run unit/api/settings-database-route.test.js
# 6 passed
```

## Doc coverage

- `docs/operations/postgres.md` — operator runbook (PG 16/17/18/19, version policy, cutover, fallback, rollback, secrets, upgrade notes).
- `docs/development/postgres.md` — developer guide (module layout, dialect helper, generator, capability gate, adapter contract, cutover lock, secrets, cross-fork policy).
- `docs/development/postgres-research.md` — Phase 1 research deliverable (24-row per-version feature matrix + 8 `pg` driver gotchas).
- `docs/ARCHITECTURE.md` — Persistence section updated to mention the PG engine and the cutover pipeline.
- `CHANGELOG.md` — entry under 4.0.0.

## Baseline impact

`tests/__baseline__/known-fails.txt` is unchanged. The new tests
(`tests/unit/dialects/postgres/`, `tests/unit/db/{pgAdapter,cutover,
postgresCapabilityGate,secrets,noPgImportWhenSqlite}.test.js`,
`tests/unit/api/settings-database-route.test.js`) are green and
additive.

## Wire-format / migration concerns

- The parallel PG migration set is generated from the SQLite
  migration set and gated by `npm run check:postgres-migrations`.
- `INSERT ... ON CONFLICT(...) DO UPDATE` is used unchanged (PG 9.5+
  supports it).
- JSON columns stay as `TEXT` in PG (no `JSONB`) to match the
  SQLite storage and avoid surprises with `columnCrypto`.
- `INSERT ... ON CONFLICT DO NOTHING` is used by the mirror so
  retries are idempotent.
- The runtime never relies on `standard_conforming_strings=off`,
  `JIT=on`, or `default_toast_compression=pglz`; PG 19 forward-compat
  is preserved.
- `requestDetails` is skipped by default from the mirror; opt in via
  `includeRequestDetails: true` on the cutover request.

## Env-var contract

- `DURINDOOR_PG_URL` — libpq connection string. Wins over the
  secrets file when set.
- `DURINDOOR_PG_SSLMODE` — `disable` / `allow` / `prefer` (default) /
  `require` / `verify-ca` / `verify-full`. Appended to the URL if not
  present.
- `DURINDOOR_PG_PREFERRED_VERSION` — `16` / `17` / `18` (default).

## Fallback semantics

On boot, if `databaseEngine === "postgres"` and the PG cluster is
unreachable (DNS, auth, migrations, etc.), the runtime falls back to
SQLite and records the error in `settings.databaseEngineError`. The
fallback is one-shot per process; repeated PG outages do not loop.

The flip order in the cutover pipeline is strict: PG must open,
migrate, mirror, and verify before SQLite is closed. The settings
write happens after the adapter flip, so a process crash between the
flip and the write leaves `databaseEngine === "sqlite"` for the next
boot.

## Local-check output

```bash
$ npm run check:postgres-migrations
[check-postgres-migrations] OK (20 files in sync)

$ echo "feat(db): add opt-in PostgreSQL engine with safe SQLite→PG cutover" | npx commitlint
# exit 0
```

## Verdict from the `verifier` agent

(populated by Phase 10 in the plan; placeholder in this template)
