# 03 - DB and migrations review

**Range:** `cfb25e641..origin/dev`
**Scope:** `src/lib/db/**`, `src/lib/usagePeriods.js`
**Reviewer posture:** skeptic; check for real runtime defects, not style nits.

## Evidence sources

- `read src/lib/db/migrations/index.js`
- `read src/lib/db/migrations/004-api-key-expiry.js`
- `read src/lib/db/migrations/004-daily-token-limit.js`
- `read src/lib/db/migrations/005-api-key-policy.js`
- `read src/lib/db/migrate.js` (lines 1-110)
- `read src/lib/db/schema.js` (lines 1-202)
- `read src/sse/services/apiKeyPolicy.js`
- `git diff cfb25e641..origin/dev -- src/lib/db --stat`

## Confirmed defects

### P0 - Migration registry does not import `004-api-key-expiry.js`

`src/lib/db/migrations/index.js:4-9`:

```js
import m001 from "./001-initial.js";
import m002 from "./002-mcp-gateway.js";
import m003 from "./003-mcp-grant-tools.js";
import m004 from "./004-daily-token-limit.js";

export const MIGRATIONS = [m001, m002, m003, m004].sort((a, b) => a.version - b.version);
```

`src/lib/db/migrations/004-api-key-expiry.js` exists with `version: 4` and an `up(db)` that adds an `expiresAt` column. But the registry imports `004-daily-token-limit.js` (which also has `version: 4`) and never imports `004-api-key-expiry.js`.

Consequence:

- `MIGRATIONS.sort((a, b) => a.version - b.version)` includes only `[001, 002, 003, 004-daily-token-limit]`.
- `latestVersion()` returns `4`.
- A database on version 3 will run `004-daily-token-limit` and stamp `schemaVersion = 4`. It will never run `004-api-key-expiry.js`.
- A database on version 4 will skip all migrations.
- Net effect: the `expiresAt` column is never added by the versioned migration. `syncSchemaFromTables` may add it from the `TABLES` definition if the runtime schema is in sync; verified at `src/lib/db/schema.js:74-86` the `apiKeys.columns` block does not currently include `expiresAt`, so the column never gets added automatically either.

User impact: if any code path reads `keyRecord.expiresAt` (e.g. to enforce expiry), it will return `undefined` and silently treat the key as never expired.

### P0 - Migration registry also misses `005-api-key-policy.js`

`src/lib/db/migrations/005-api-key-policy.js` has `version: 5` and an `up(db)` that:

- Adds the `policy` column to `apiKeys` if missing.
- Backfills `apiKeyUsageTotals` from `usageHistory` so per-key limits do not under-count pre-existing history.

The registry does not import it. `MIGRATIONS` array has length 4, not 5. `latestVersion()` returns `4`.

Consequence:

- A fresh database never gets the `policy` column via the versioned migration.
- A fresh database that uses `syncSchemaFromTables` may pick up `policy` if the TABLES declaration has it; verified at `src/lib/db/schema.js:74-86`, the `TABLES.apiKeys.columns` block does not include `policy`. So the column never appears.
- A pre-existing database (e.g. upgrade-in-place) never gets the historical-usage backfill. The first time a user attaches `maxTokens` to a key, their totals start at 0 and only count post-upgrade usage.

User impact: per-key policy + limits are non-functional. The UI may let users configure them, but the enforcement layer in `src/sse/services/apiKeyPolicy.js:86-107` reads `usage.totalTokens` and `usage.totalCost` from totals that are never backfilled.

### P0 - Two migrations share `version: 4`

`004-api-key-expiry.js:4` declares `version: 4`. `004-daily-token-limit.js:3` declares `version: 4`. Two migrations with the same version is a hard correctness violation of the registry's invariant (`// Versions MUST be unique and monotonically increasing.`).

If the registry did import both, the sort would produce `[..., v4, v4]` and the loop in `runVersionedMigrations` (`src/lib/db/migrate.js:65-75`) would run both pending migrations in array order on a fresh DB. But because both are v4, the loop would set `schemaVersion = 4` after the first one; a subsequent DB upgrading from v3 still runs both. The latent disaster is that v4 is overloaded, so any new v5 migration cannot be ordered relative to the v4 that should have run earlier. The missing import currently hides this, but the version field on each file must still be corrected.

### P1 - `SCHEMA_VERSION` constant is stale

`src/lib/db/schema.js:2` declares `export const SCHEMA_VERSION = 4;`. The actual schema after this window includes columns and tables beyond version 4 (e.g. `policy`, `expiresAt`, `apiKeyUsageTotals`).

User impact: any consumer that reads `SCHEMA_VERSION` to decide "am I up to date?" will think they are current when they are not. (No consumers found in this scan, but the constant is a foot-gun for future code.)

### P1 - `usagePeriods.js` ends with a stray `\\ No newline at end of file` and dead `getChartDayBucketCount`

`src/lib/usagePeriods.js` (last line in diff):

```js
export function getChartDayBucketCount(period) {
  const days = getUsagePeriodDays(period);
  return days;
}
```

- The function name says "chart" but the body just returns the period-days. The function adds no value beyond the underlying `getUsagePeriodDays`. Either dead code or the chart code is missing.
- File ends with no trailing newline (`\\ No newline at end of file` in diff). Minor but signals an unedited line was tacked on without normalization.

### P2 - `usageRepo.js` daily limit enforcement path

Not yet read; deferred to a follow-up review pass. The `005-api-key-policy.js` migration is the higher-priority blocker.

## Bug summary

| Severity | File:line | Issue | Verified? |
|---|---|---|---|
| P0 | `src/lib/db/migrations/index.js:4-9` | `004-api-key-expiry.js` not imported; never runs | yes |
| P0 | `src/lib/db/migrations/index.js:4-9` | `005-api-key-policy.js` not imported; never runs; no backfill of `apiKeyUsageTotals` | yes |
| P0 | `src/lib/db/migrations/004-api-key-expiry.js:4` and `004-daily-token-limit.js:3` | both declare `version: 4` - violates uniqueness invariant | yes |
| P1 | `src/lib/db/schema.js:2` | `SCHEMA_VERSION = 4` is stale | yes |
| P1 | `src/lib/usagePeriods.js` (last lines) | `getChartDayBucketCount` is a no-op wrapper; file lacks trailing newline | yes |

## Source artifacts

- `.omc/review-3days/db.patch` (raw diff)
