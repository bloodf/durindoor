# PostgreSQL engine — developer guide

This guide is for contributors working on the opt-in PG engine
(`feat/postgres-engine`). It covers the dialect helper, the generator,
the steps to add a new migration in both flavors, and the runtime
contract the adapter and the repos depend on.

## Module layout

```
src/lib/db/
├── adapters/pgAdapter.js                    # the pg-based adapter
├── dialects/postgres/
│   ├── translate.js                          # SQLite DDL → PG DDL
│   ├── mirror.js                             # SQLite → PG row mirror
│   ├── snapshot.js                           # cutover snapshot helper
│   └── cutoverLog.js                         # pgCutoverLog table writer
├── cutover.js                                # the test→migrate→flip pipeline
├── postgresFallback.js                       # boot-time fallback wrapper
├── postgresCapabilityGate.js                 # per-version feature matrix
├── secrets.js                                # encrypted PG URL store
└── migrations/postgres/                      # parallel migration set (18 files)
    ├── 000-bootstrap.js
    ├── 001-initial.js
    ├── 002-mcp-gateway.js
    ├── ...
    ├── 017-connection-groups.js
    ├── 018-pg-cutover-log.js
    └── index.js
```

## Adding a new migration (both flavors)

The SQLite migration set is the source of truth. To add a new
migration:

1. Add `00N-name.js` under `src/lib/db/migrations/` following the
   existing pattern. The migration's `up(db)` receives a SQLite
   adapter.
2. Run `node scripts/migrate-sqlite-ddl-to-pg.mjs` to emit the
   parallel PG version. The generator reads the SQLite file, infers
   the version number and the migration kind, and writes the PG
   equivalent. Most additive migrations become a no-op in the PG
   set (the bootstrap already created the table).
3. If the migration is a NO-OP on PG (the schema is already in
   `001-initial.js` or `017-connection-groups.js`), the generator
   writes a version-stamp stub. If it is a NEW column on an
   existing table, edit `001-initial.js` to add the column to the
   `TABLES` entry, then re-run the generator — the column will
   appear in the bootstrap.
4. Run `npm run check:postgres-migrations` to assert the generated
   files are in sync with the source migrations. The CI gate fails
   if they drift.

For the `pgCutoverLog` table specifically: it is a PG-only table.
Its migration is the only one that does not have a SQLite
equivalent. The generator handles it as a special case.

## The DDL translator

`src/lib/db/dialects/postgres/translate.js` is the narrow bridge
between the SQLite declarative schema and PG DDL. The supported
dialects are:

- `INTEGER PRIMARY KEY` / `INTEGER PRIMARY KEY AUTOINCREMENT` →
  `BIGSERIAL PRIMARY KEY`.
- `INTEGER DEFAULT 0/1` (boolean flag) → unchanged. The repos use
  `0/1` truthy checks; mapping at the adapter boundary is a future
  PR.
- `TEXT NOT NULL` / `TEXT` / `TEXT PRIMARY KEY` → unchanged.
- `REAL` → `DOUBLE PRECISION`.
- `datetime('now')` → `CURRENT_TIMESTAMP`.
- `PRAGMA table_info(<name>)` → `information_schema.columns` query.
- `INSERT ... ON CONFLICT(...) DO UPDATE` → unchanged (PG 9.5+).
- `last_insert_rowid()` → `INSERT ... RETURNING id` (handled by the
  adapter, not the translator).
- `CREATE INDEX ... COLLATE NOCASE` → `CREATE INDEX ... LOWER(col)`.
  Partial indexes (`WHERE ...`) are preserved verbatim.

The translator does NOT handle:

- JSONB conversion. JSON columns stay as `TEXT` in PG to match the
  SQLite storage and avoid surprises with `columnCrypto`.
- 18+ features (AIO, skip scan, parallel GIN hints). The capability
  gate enables those at runtime; the DDL does not encode them.

## The capability gate

`src/lib/db/postgresCapabilityGate.js` reads the cluster's
`server_version_num` and per-feature GUCs and computes the effective
enabled-state of every entry in `databasePgFeatures`. The defaults
are baked into `DEFAULT_FEATURES`. To add a new toggle:

1. Add the entry to `DEFAULT_FEATURES` with `{ enabled, requires: ">=N" }`.
2. Update the per-version feature matrix in the canonical plan
   (the `docs/development/postgres-research.md` doc cites the
   primary source for each feature).
3. Update the dashboard's `CapabilityMatrix` sub-component if the
   new feature needs a column it does not already render.
4. Add a unit test to `tests/unit/db/postgresCapabilityGate.test.js`
   that exercises the new entry against cluster majors 16, 17, 18,
   and 19.

## The adapter contract

`src/lib/db/adapters/pgAdapter.js` implements the same interface as
the SQLite adapters. The contract:

- `run(sql, params)` rewrites `?` placeholders to `$1, $2, ...` and
  injects `RETURNING id` for `INSERT` statements targeting tables
  with a `BIGSERIAL` column. The returned `lastInsertRowid` is the
  bigint from the sequence.
- `get(sql, params)` returns the first row as `{col: value}`.
- `all(sql, params)` returns the array of rows.
- `exec(sql)` splits a multi-statement string on `;` + newline.
- `transaction(fn)` implements `BEGIN` / `COMMIT` / `ROLLBACK` with
  savepoint nesting.
- `close()` is idempotent.
- `flush()` and `checkpoint()` are no-ops on PG.
- `capabilities.isPostgres` is `true`; `serverVersionNum` and
  `serverVersion` are populated from `SHOW server_version_num` /
  `SHOW server_version` at connect time.

The adapter accepts a `clientFactory` dependency-injection hook for
the unit tests. Production callers omit it.

## The cutover lock

`src/lib/db/cutover.js` holds an in-process async mutex that
serializes concurrent cutover / rollback invocations. The lock is
released on every code path, including thrown errors, via
`try/finally`. The dashboard's "Cut over to Postgres" button
returns 503 with `Retry-After: 5` when the lock is already held;
the dashboard does not need to retry — it just renders the error.

## Secrets

`src/lib/db/secrets.js` is the only sanctioned reader of the
`postgres-url` secret. The store:

- Encrypts with `columnCrypto.encryptField(plaintext, key)` so the
  AAD is bound to the key name (defence in depth against swap).
- Writes to `DATA_DIR/durindoor-secrets.json` (mode 0600) on POSIX.
- Refuses to return plaintext-looking values that lack the
  encrypted-blob envelope.

Do not call `secretsRead` outside the `resolvePostgresSecret` entry
point. The `GET /api/settings/database` route must not surface the
secret.

## Cross-fork policy

The PG engine is a DurinDoor-owned feature. Do not send a PR to
decolua/9router for this work. Upstream 9router is SQLite-only and
has no plans to add a PG engine. If a future upstream merge
introduces a PG path, the parallel migration set and the adapter
should be re-evaluated against upstream's schema layout before
merging.
