# PostgreSQL engine — operator runbook

The opt-in PostgreSQL engine lets DurinDoor run against a remote
PostgreSQL cluster instead of the local SQLite file. The default is
unchanged (SQLite). This runbook covers the full lifecycle: bring-up,
version policy, the cutover pipeline, the boot-time fallback, the
rollback story, and the PG 18 → 19 upgrade notes.

## Version policy

| Major | Supported | Default | Notes |
| --- | --- | --- | --- |
| 16.x  | yes (floor) | — | EOL 2028-11-09. No AIO, no skip scan, no parallel GIN. |
| 17.x  | yes | — | Parallel GIN, streaming I/O, vacuum memory rewrite, NOT NULL elimination. |
| 18.x  | yes | yes (docker profile) | AIO subsystem (2-3x sequential-scan speedup), B-tree skip scan. |
| 19.x  | forward-compat | — | Beta 3 as of 2026-08-13. Not the GA target. |

The runtime reads the cluster's `server_version_num` at boot and
auto-disables features whose `requires` floor exceeds the cluster's
major. The operator can pin a `databasePgVersion` cap in the dashboard
to opt out of features the cluster does not have.

## Quick start

```bash
# 1. Start a PG 18 cluster (profile-gated so default `docker compose up` is unchanged)
docker compose --profile postgres18 up -d

# 2. Set the connection URL in .env
echo 'DURINDOOR_PG_URL=postgres://durindoor:durindoor@postgres18:5432/durindoor' >> .env
# Optional: pin the SSL mode and the version cap
echo 'DURINDOOR_PG_SSLMODE=prefer' >> .env
echo 'DURINDOOR_PG_PREFERRED_VERSION=18' >> .env

# 3. Restart DurinDoor so it boots the PG adapter
docker compose restart durindoor

# 4. From the dashboard: Settings > Database > "Test connection"
#    Expected log line:
#      [DB] Driver: pg | engine: postgres
```

## Cutover pipeline

The dashboard action "Cut over to Postgres" runs:

1. `testConnection(url)` — transient `pg.Client`, `SELECT 1`. Fail-fast.
2. Open the persistent PG adapter; run the parallel migration set.
3. Open a fresh SQLite adapter (read-only-ish) for the mirror source.
4. `runMirror(sqlite, pg, { includeRequestDetails })` — every table
   in chunks of 500, per-table transactions, row-count assertion.
   `requestDetails` is skipped by default (can be GB; opt in via
   `includeRequestDetails: true`).
5. `snapshotSqlite()` — copy `data.sqlite` to
   `DATA_DIR/db/backups/data.sqlite.postgres-cutover-<ts>.sqlite` (mode
   0600). Best-effort: warn on failure, continue.
6. `setActiveAdapter(pg)` — flip the runtime to PG.
7. Persist `databaseEngine: "postgres"` in the settings row.
8. Append a row to `pgCutoverLog` on the target cluster.

The flip order is strict: PG opens, migrates, mirrors, and verifies
BEFORE SQLite is closed. The settings write happens after the
adapter flip, so a process crash between step 6 and step 7 leaves
`databaseEngine === "sqlite"` for the next boot.

Failure at any step keeps SQLite live and records the error in
`databaseEngineError` and (when the cluster is reachable) the
`pgCutoverLog`.

## Boot-time fallback

If the runtime is started with `databaseEngine: "postgres"` and the
PG cluster is unreachable (DNS failure, auth error, etc.), the
runtime logs:

```
[DB] Driver: pg | engine: postgres
[DB][migrate] applied #18 pg-cutover-log
[DB] Driver: pg | engine: postgres
```

then the `postgresFallback` wrapper closes the failed PG adapter and
returns a fresh SQLite adapter. The `databaseEngineError` setting
records the failure so the operator sees the cause in the dashboard.

The fallback is one-shot per process. Repeated PG outages do not
loop; the operator sees `databaseEngineError` in the dashboard and
acts.

## Rollback

The dashboard "Switch back to SQLite" action restores the most
recent cutover snapshot (`DATA_DIR/db/backups/data.sqlite.postgres-cutover-*`)
into the live `data.sqlite` path, reopens the SQLite adapter, and
flips `databaseEngine` back to `"sqlite"`. The PG cluster is left
untouched.

Manual rollback (operator shell):

```bash
# List available snapshots
ls -lh ~/.9router/db/backups/data.sqlite.postgres-cutover-*.sqlite

# Restore the most recent one
SNAP=$(ls -t ~/.9router/db/backups/data.sqlite.postgres-cutover-*.sqlite | head -1)
cp -a "$SNAP" ~/.9router/db/data.sqlite

# Edit settings row to flip back to sqlite (or call the API)
# Restart DurinDoor
docker compose restart durindoor
```

## Secrets handling

The PG connection URL is held in one of three places, in precedence
order:

1. The env var `DURINDOOR_PG_URL` (always wins at boot). This is
   the documented override for operators that prefer env-var-driven
   configuration.
2. `settings.postgresUrl` (encrypted blob in the canonical
   `settings` row, decrypted with the same AES-256-GCM master key
   that the column-level credential encryption uses). The dashboard
   "Test connection" button with `persist: true` writes the URL
   here. This is the supported path for interactive use and the
   default for the dashboard.
3. The legacy `DATA_DIR/durindoor-secrets.json` file (mode 0600) is
   read-only after this revision. Pre-v2 installs that already saved
   a connection to the file keep working; new writes go only to
   the settings row.

The settings row carries the redacted connection info (host, port,
database, user, sslmode, authSource) but NEVER the password. The
`GET /api/settings/database` route never returns the secret. The
`DURINDOOR_PG_URL` env var is the only environment-level knob; the
rest of the operator workflow is dashboard-driven and persists to
the settings row, so a fresh install never needs an env var.

## PG 18 → 19 upgrade notes

When the cluster is upgraded from PG 18 to PG 19 (Beta 3, GA
expected Sep/Oct 2026), the runtime continues to work unchanged. The
breaking changes that DO matter for a DurinDoor install:

- `max_locks_per_transaction` doubles (64 → 128). The lock table
  allocation changed in lockstep, so this is a no-op for existing
  workloads.
- `RADIUS` auth is removed. We never used it.
- MD5 password authentication issues a warning on every successful
  login (`md5_password_warnings` controls it). The `pg` library uses
  SCRAM-SHA-256 by default when both sides support it; configure the
  connection string to require SCRAM.
- `inet` / `cidr` default opclass changes from `btree_gist` to GiST.
  We do not use these types.
- CR/LF in database, role, and tablespace names is disallowed. We
  do not have `\r\n` in any identifier.

The recommended operator upgrade path uses `pg_upgrade --swap
--jobs=$N` (PG 18+ parallel upgrade). The cutover log records the
pre-upgrade snapshot, so a rollback to PG 18 is always possible.

## PG 19 features (forward-compat toggles)

The `databasePgFeatures` map includes 19-only features that default
to `enabled: false`. Once the cluster is on PG 19 and the operator
flips the relevant toggle to `true`, the runtime honors them. The
matrix:

- `onConflictDoSelect` (reverted from PG 19 before GA)
- `forPortionOf` (temporal `UPDATE`/`DELETE`)
- `waitForLsn` (read-your-writes on replicas)
- `pgPlanAdvice` (plan stabilization)
- `parallelAutovacuum` (workers on indexes)
- `repack` (online table repacking)
- `onlineChecksumToggle` (data checksums without restart)

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Driver: pg` log but runtime is on SQLite | PG connect failed; `databaseEngineError` is set | Inspect the error; fix the URL or the cluster |
| `pg_isready` fails | Cluster not started or wrong port | `docker compose ps postgres18` and `docker compose logs postgres18` |
| Cutover stuck at "mirroring usageHistory" | `requestDetails` is huge; opt in only when needed | Set `includeRequestDetails: false` (the default) |
| `JSONB column type mismatch` | Plan is to use `TEXT`, not `JSONB`; should not occur | Report as a bug; the DDL translator keeps JSON as TEXT |
| `cutover log: type` constraint violation | Operator passed an unknown `type` value | The dashboard only emits `cutover` / `rollback` / `test`; report if seen otherwise |
