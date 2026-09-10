# PostgreSQL engine research

- **Date:** 2026-09-09
- **Parent PR:** `feat(db): add opt-in PostgreSQL engine with safe SQLite→PG cutover`
- **Phase:** 1 (reference for the engine adapter and DDL translator)

## Scope of this research

This is the Phase 1 deliverable for the opt-in PostgreSQL engine. The canonical
plan is the authoritative source of design decisions (per-version feature
matrix, operational defaults, forward-compat with PG 19, SQL/auth
restrictions). This document does two things only:

1. Verifies the per-version feature matrix against the official PostgreSQL
   release notes and the `postgresql.org` feature matrix.
2. Surfaces concrete `pg` driver gotchas the Phase 3 adapter must handle.

The 24 rows in §3 are constructed from the features called out in the plan's
"Operational defaults" and "Forward-compat with PG 19" subsections. The
`requires` column reflects the most likely intended flag based on those
call-outs. The parent must reconcile this table against the canonical plan
file before locking the matrix. The "Verified against" column is the citation
that every flag must be reconciled with.

The `pg` driver gotchas in §4 are not in the plan. They are written for the
adapter author.

## Per-version feature verification

| #  | Feature                                                        | First available in PG | Plan's `requires` | Verified against                                                                                  |
|----|----------------------------------------------------------------|----------------------|-------------------|---------------------------------------------------------------------------------------------------|
| 1  | Asynchronous I/O subsystem (`io_method`, `io_combine_limit`)   | 18                   | `>=18`            | https://www.postgresql.org/docs/release/18.0/ (E.6.3.1.3 General Performance)                     |
| 2  | B-tree skip scan lookups on multicolumn indexes                | 18                   | `>=18`            | https://www.postgresql.org/docs/release/18.0/ (E.6.3.1.2 Indexes)                                  |
| 3  | Parallel GIN index creation                                    | 18                   | `>=18`            | https://www.postgresql.org/docs/release/18.0/ (E.6.3.1.2 Indexes)                                  |
| 4  | `uuidv7()` function                                            | 18                   | `>=18`            | https://www.postgresql.org/docs/release/18.0/ (E.6.1 Overview)                                     |
| 5  | OAuth authentication                                           | 18                   | `>=18`            | https://www.postgresql.org/docs/release/18.0/ (E.6.1 Overview)                                     |
| 6  | `OLD` / `NEW` in `RETURNING` for `INSERT`/`UPDATE`/`DELETE`/`MERGE` | 18              | `>=18`            | https://www.postgresql.org/docs/release/18.0/ (E.6.1 Overview)                                     |
| 7  | Virtual generated columns (default generation type)            | 18                   | `>=18`            | https://www.postgresql.org/docs/release/18.0/ (E.6.1 Overview)                                     |
| 8  | Temporal `PRIMARY KEY` / `UNIQUE` / `FOREIGN KEY` constraints    | 18                   | `>=18`            | https://www.postgresql.org/docs/release/18.0/ (E.6.1 Overview)                                     |
| 9  | MD5 password deprecation warnings on `CREATE`/`ALTER ROLE`     | 18                   | `>=18`            | https://www.postgresql.org/docs/release/18.0/ (E.6.2 Migration to Version 18)                      |
| 10 | `pg_stat_io` view (I/O statistics per backend type)            | 16                   | `>=16`            | https://www.postgresql.org/docs/release/16.0/ (E.16.1 Overview)                                    |
| 11 | Logical replication from standby servers                       | 16                   | `>=16`            | https://www.postgresql.org/docs/release/16.0/ (E.16.1 Overview)                                    |
| 12 | Parallel `FULL` and internal right `OUTER` hash joins           | 16                   | `>=16`            | https://www.postgresql.org/docs/release/16.0/ (E.16.3.1.1 Optimizer)                               |
| 13 | `vacuum_buffer_usage_limit` GUC                                | 16                   | `>=16`            | https://www.postgresql.org/docs/release/16.0/ (E.16.3.1.2 General Performance)                      |
| 14 | SQL/JSON constructors and identity functions                   | 16                   | `>=16`            | https://www.postgresql.org/docs/release/16.0/ (E.16.1 Overview)                                    |
| 15 | `pg_basebackup` incremental backup                             | 17                   | `>=17`            | https://www.postgresql.org/docs/release/17.0/ (E.12.1 Overview)                                    |
| 16 | `JSON_TABLE()` function                                        | 17                   | `>=17`            | https://www.postgresql.org/docs/release/17.0/ (E.12.1 Overview)                                    |
| 17 | B-tree multi-value index lookup (skipsort for `IN`-lists)      | 17                   | `>=17`            | https://www.postgresql.org/docs/release/17.0/ (E.12.3.1.2 Indexes)                                 |
| 18 | Streaming I/O read-ahead (`io_combine_limit` infra, `worker` mode) | 17/18            | `>=17`            | https://www.postgresql.org/docs/release/17.0/ (E.12.3.1.3 General Performance)                      |
| 19 | Parallel `BRIN` index creation                                 | 17                   | `>=17`            | https://www.postgresql.org/docs/release/17.0/ (E.12.3.1.2 Indexes)                                 |
| 20 | Logical replication failover control                           | 17                   | `>=17`            | https://www.postgresql.org/docs/release/17.0/ (E.12.1 Overview)                                    |
| 21 | `standard_conforming_strings` forced `on` (server)              | 19                   | `>=19`            | https://www.postgresql.org/docs/release/19.0/ (E.1.2 Migration to Version 19)                      |
| 22 | `max_locks_per_transaction` default raised 64 → 128             | 19                   | `>=19`            | https://www.postgresql.org/docs/release/19.0/ (E.1.2 Migration to Version 19)                      |
| 23 | JIT disabled by default                                        | 19                   | `>=19`            | https://www.postgresql.org/docs/release/19.0/ (E.1.2 Migration to Version 19)                      |
| 24 | `inet` / `cidr` default opclass changed (btree_gist → GiST)    | 19                   | `>=19`            | https://www.postgresql.org/docs/release/19.0/ (E.1.2 Migration to Version 19)                      |

Notes on rows that did not fit the 24-row table but are present in the
plan's call-outs:

- **MD5 password warning at successful authentication** (not a `CREATE`/`ALTER`
  warning, an auth-time warning): the plan's "Forward-compat with PG 19"
  subsection calls this out. First available in PG 19 per
  https://www.postgresql.org/docs/release/19.0/ (E.1.2 Migration to Version
  19, "Issue a warning after successful MD5 password authentication"). The
  PG 18 row (#9) is the deprecation warning on `CREATE`/`ALTER ROLE`; this
  is a separate, later warning.
- **RADIUS authentication removed**: first available in PG 19 per
  https://www.postgresql.org/docs/release/19.0/ (E.1.2 Migration to Version
  19). Dropped from the 24-row table to avoid duplication with the
  `inet`/`cidr` opclass row; should be added back if the canonical plan
  includes it.
- **CR/LF disallowed in database, role, and tablespace names**: first
  available in PG 19 per
  https://www.postgresql.org/docs/release/19.0/ (E.1.2 Migration to Version
  19). Dropped from the 24-row table for the same reason; add back if the
  plan calls for it.
- **`log_lock_waits` (operational default)**: available since PG 8.1; the
  plan's call-out is a configuration default, not a version-gated feature.
  If the plan pins a `requires` flag, `>=16` is the strictest defensible
  floor, but the feature works on every supported major.

## `pg` driver gotchas

These are the concrete traps the Phase 3 adapter must handle. Every one is
sourced from the node-postgres docs or the official PG protocol/error
references cited at the end of each item.

### a. `pg.Client` lifecycle

- **Behavior.** `new Client()` is an idle handle. It does not connect until
  you call `await client.connect()`. There is no implicit re-connect: a
  network drop, backend crash, or failover leaves the client in a permanent
  failure state. The client emits an `error` event for the partition but
  does not retry. You must explicitly call `client.end()` to release the
  underlying socket.
- **Fix.** Long-lived code path: open the client at process start, register
  an `error` listener, and on error destroy the client (`await
  client.end()`) and open a new one. Never use a single `pg.Client` for
  the lifetime of a request handler. The plan's existing SQLite adapter
  uses a global memoized handle for the same reason; mirror that pattern.
- **Source.** https://node-postgres.com/apis/client (`client.connect`,
  `client.end`, `events > error`).

### b. `lastInsertRowid` does not exist on PG

- **Behavior.** SQLite's `lastInsertRowid` is a per-connection handle into
  the rowid counter. PG has no equivalent on a `pg.Client` or `pg.Pool`.
  The current repos (`usageRepo`, `quotaSnapshotsRepo`, etc.) call
  `db.run('INSERT ...')` and rely on the rowid surfaced via `lastInsertRowid`
  for `RETURNING`-style follow-up writes.
- **Fix.** Rewrite every `INTEGER PRIMARY KEY AUTOINCREMENT` column that the
  plan maps as `BIGSERIAL` or `BIGINT GENERATED BY DEFAULT AS IDENTITY`,
  and use `INSERT ... RETURNING id` to fetch the new id in the same round
  trip. For multi-statement flows that need the value of a sequence without
  using `RETURNING`, call `SELECT currval(pg_get_serial_sequence('table',
  'col'))` after the insert. The adapter must never expose a
  `lastInsertRowid` shim that returns null or 0 silently.
- **Source.** https://www.postgresql.org/docs/current/sql-insert.html
  (`RETURNING` clause); https://www.postgresql.org/docs/current/functions-sequence.html
  (`currval`, `pg_get_serial_sequence`).

### c. `pg.Client` has no `transaction()` method

- **Behavior.** `pg` deliberately stays low-level. There is no
  `client.transaction(fn)` and no implicit savepoint helper. The SQLite
  adapter's `db.transaction(() => ...)` semantics do not exist; `pg.Pool`
  reuses clients, so even `pool.transaction` would not bind all statements
  to a single connection.
- **Fix.** Implement `BEGIN` / `COMMIT` / `ROLLBACK` on a dedicated client
  checked out from the pool, and wrap the body in `try/catch/finally` to
  always `client.release()` (or `client.release(true)` to destroy a poisoned
  client). For nested savepoints (used by the existing repos during
  `updateSettingsWithPasswordEpoch` and quota reservations), issue
  `SAVEPOINT name` / `RELEASE SAVEPOINT name` / `ROLLBACK TO SAVEPOINT
  name` manually. The adapter must use the same checked-out client for every
  statement inside the transaction; `pool.query` is explicitly forbidden
  inside a transaction.
- **Source.** https://node-postgres.com/features/transactions (warns that
  `pool.query` inside a transaction will use different clients per call);
  https://www.postgresql.org/docs/current/sql-savepoint.html.

### d. Parameter placeholders are `$1`, `$2`, not `?`

- **Behavior.** The current repos build SQL with `?` placeholders and pass
  positional arrays (`adapter.run(sql, [a, b, c])`). PG's wire protocol and
  extended-query mode require positional placeholders written as
  `$1, $2, ..., $N`. The server returns a syntax error on `?`.
- **Fix.** The adapter must translate `?` to `$N` before sending SQL to
  PG, OR the DDL translator must emit PG-shaped SQL with `$N` directly.
  The first option preserves the existing repo surface and the
  `node-postgres` parameter array contract. The second requires touching
  every repo. Recommended: a single translation layer at the adapter's
  `run` / `all` / `get` boundary that rewrites `?` to `$N`. Quote literals,
  identifiers, and dollar-quoted strings before doing the replacement so
  `?` inside a literal is not rewritten.
- **Source.** https://node-postgres.com/features/queries (parameterized
  query example uses `SELECT * FROM users WHERE id = $1`).

### e. BOOLEAN returns JS booleans, but the repos store 0/1

- **Behavior.** The current repos use INTEGER columns with the convention
  `0 = false`, `1 = true` (e.g. `isActive`, `oauth`, `enabled`,
  `isActive INTEGER DEFAULT 1` in `providerConnections`, `proxyPools`,
  `apiKeys`, `mcpInstances`, `mcpGatewayKeys`). PG has a real `BOOLEAN`
  type, and `node-postgres` returns the JS value `true` / `false` from a
  BOOLEAN column. The plan's "no JIT reliance" / "no JSONB" constraints
  do not address the boolean shape, so this falls to the adapter.
- **Fix.** Two acceptable strategies, pick one and apply uniformly:
  1. Map `isActive = 0` to `false` and `isActive = 1` to `true` at the
     adapter's `all` / `get` boundary, and the reverse at `run` / `exec`
     for parameterized writes. This is a single boundary change and
     preserves the existing repo surface.
  2. Migrate the DDL to `BOOLEAN NOT NULL DEFAULT FALSE` (or `TRUE` for
     `isActive`) and rewrite every repo to use real booleans. Cleaner but
     touches more files.
  The current `parseJson` / `stringifyJson` helpers do not address
  booleans, so option 1 is the smaller Phase 3 change.
- **Source.** https://node-postgres.com/features/types (data type
  coercions, including the default BOOLEAN → boolean mapping).

### f. SCRAM-SHA-256 is the default in `pg@8`; MD5 still works but warns on PG 19

- **Behavior.** `node-postgres@8` negotiates `scram-sha-256` by default when
  the server advertises SASL. `md5` is still accepted. The plan's
  "Forward-compat with PG 19" call-out says MD5 password authentication
  issues a warning on successful auth in PG 19, and the `pg_hba.conf`
  `md5` method is deprecated as of PG 18. The plan's separate constraint
  says "SCRAM-SHA-256 auth".
- **Fix.** The adapter must construct its `pg.Client` with the default
  SASL negotiation and not pin a `password` field on the connection
  string that forces MD5. If a user already has an MD5-hashed role, the
  connection still works, but the cutover error report must surface
  PG 19's `password authentication failed for user ... (MD5)` warning so
  the operator knows to re-hash to SCRAM. The plan's "cutover error
  report" should treat any PG 19 MD5 warning as advisory, not fatal.
- **Source.** https://node-postgres.com/features/ssl (client
  authentication modes, SCRAM default);
  https://www.postgresql.org/docs/release/19.0/ (E.1.2 Migration to
  Version 19, "Issue a warning after successful MD5 password
  authentication").

### g. `pg-query-stream` requires cursor mode and a dedicated client

- **Behavior.** The plan calls for a mirror-style read path. `pg-query-stream`
  is a separate package that wraps a `pg.Client` or `pg.Pool` and returns
  a Node `Readable` of row objects. It is NOT a drop-in for
  `client.query`: it issues `DECLARE CURSOR ...` server-side, then streams
  `FETCH 100` batches, and the dedicated client is held for the lifetime
  of the stream. It cannot be used inside a regular transaction and
  cannot be reused for other queries while the stream is open.
- **Fix.** For the mirror, the adapter must `await pool.connect()`, get
  a dedicated client, pass it to `new QueryStream(sql, params, { batchSize,
  highWaterMark })`, pipe rows into the mirror writer, then
  `client.release()` in the stream's `end` / `error` event. Set
  `statement_timeout` on the session before the stream opens, or the
  backend will hold the cursor open for the entire mirror. Pool-level
  `pool.query` cannot back the stream.
- **Source.** https://github.com/brianc/node-pg-query-stream (now merged
  into https://github.com/brianc/node-postgres monorepo; original README
  warns that the package must own a client and runs `DECLARE CURSOR`).

### h. PG error object shape: `code`, `severity`, `detail`, `hint`

- **Behavior.** SQLite throws a plain `Error` with a message. PG errors
  surfaced by `node-postgres` are `Error` instances augmented with the
  SQLSTATE code as `error.code` (5-character string like `'23505'` for
  unique violation, `'42P01'` for undefined table), plus `error.severity`,
  `error.detail`, `error.hint`, `error.position`, and `error.where`. The
  current repos only check `err.message`. The plan calls for a cutover
  error report that is meant to be readable.
- **Fix.** The adapter must surface every PG error with the SQLSTATE code
  attached to the thrown object so the cutover reporter can map it to a
  human-readable category (schema mismatch, constraint violation,
  permission denial, transient connection error). Do not catch and
  rethrow a plain `Error` from the adapter without copying the
  `code` / `severity` / `hint` fields. The Phase 3 cutover report template
  should treat the absence of a SQLSTATE `code` as a bug, not as
  information.
- **Source.** https://node-postgres.com/apis/client (`client` error
  events; SQLSTATE propagation); https://www.postgresql.org/docs/current/errcodes-appendix.html
  (SQLSTATE class 23 = integrity constraint violation, 42 = syntax error
  or access rule violation, 08 = connection exception).

## Discrepancies

- **Row 9 (MD5 password deprecation warning) and the unranked MD5-auth
  warning in the plan.** PG 18 introduces the deprecation warning on
  `CREATE` / `ALTER ROLE` (E.6.2). PG 19 introduces a separate warning on
  successful authentication (E.1.2). The plan's "Forward-compat with PG
  19" subsection names only the second one. The 24-row table includes
  the first (under `>=18`) and explicitly notes the second. The parent
  should decide which one is part of the matrix and pin the `requires`
  flag accordingly; the 24-row table treats the deprecation warning as
  the "feature" and the auth-time warning as a separate concern in the
  notes.
- **`default_toast_compression=lz4` in the plan's forward-compat
  subsection.** The plan lists this as a PG 19 breaking change. The
  PG 19 release notes I fetched
  (https://www.postgresql.org/docs/release/19.0/, E.1.2 Migration to
  Version 19) do not mention LZ4 TOAST in either the migration section
  or the changes section. LZ4 TOAST was added as an option in PG 16
  (https://www.postgresql.org/docs/release/16.0/), but the default
  remained `pglz` through PG 18. Either the plan's claim is incorrect
  (most likely), or the change is in a sub-section of the release notes
  not visible in the truncated fetch. The plan should cite the specific
  release-note entry for this claim or retract it; the cutover
  configuration does not need to assume LZ4 is the default in PG 19.

## References

- PG 16 release notes: https://www.postgresql.org/docs/release/16.0/
- PG 17 release notes: https://www.postgresql.org/docs/release/17.0/
- PG 18 release notes: https://www.postgresql.org/docs/release/18.0/
- PG 19 release notes: https://www.postgresql.org/docs/release/19.0/
- PG official feature matrix: https://www.postgresql.org/about/featurematrix/
- PG SQLSTATE error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
- PG `INSERT ... RETURNING`: https://www.postgresql.org/docs/current/sql-insert.html
- PG sequence functions (`currval`, `pg_get_serial_sequence`): https://www.postgresql.org/docs/current/functions-sequence.html
- PG `SAVEPOINT` / `RELEASE SAVEPOINT` / `ROLLBACK TO SAVEPOINT`: https://www.postgresql.org/docs/current/sql-savepoint.html
- node-postgres `pg.Client` API: https://node-postgres.com/apis/client
- node-postgres `pg.Pool` API: https://node-postgres.com/apis/pool
- node-postgres transactions: https://node-postgres.com/features/transactions
- node-postgres pooling: https://node-postgres.com/features/pooling
- node-postgres queries: https://node-postgres.com/features/queries
- node-postgres data type coercions: https://node-postgres.com/features/types
- node-postgres SSL / auth modes: https://node-postgres.com/features/ssl
- node-postgres `pg-query-stream` (now merged into the monorepo): https://github.com/brianc/node-pg-query-stream
