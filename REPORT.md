# DB migrations fix report

## Scope
Fix the migration registry collision and missing imports described in P0 #13, #14, #15 of the consolidated 3-day review (`05-fix-plan.md`).

- `src/lib/db/migrations/index.js` did not import `004-api-key-expiry.js` or `005-api-key-policy.js`, and two migrations declared `version: 4`.
- `SCHEMA_VERSION` was stale at `4`.
- `TABLES.apiKeys` lacked `policy` and `expiresAt`, so `syncSchemaFromTables` would not auto-create those columns.

## Files changed
1. `src/lib/db/migrations/004-api-key-expiry.js` — unchanged, version stays `4`.
2. `src/lib/db/migrations/004-daily-token-limit.js` → renamed to `005-daily-token-limit.js`, version changed `4` → `5`.
3. `src/lib/db/migrations/005-api-key-policy.js` → renamed to `006-api-key-policy.js`, version changed `5` → `6`.
4. `src/lib/db/migrations/index.js` — added imports for `004-api-key-expiry`, `005-daily-token-limit`, `006-api-key-policy`.
5. `src/lib/db/schema.js` — bumped `SCHEMA_VERSION` `4` → `6`; added `policy` and `expiresAt` columns to `TABLES.apiKeys`.
6. `tests/unit/db-migrations-registry.test.js` — new.

## Renamed migration files
- `src/lib/db/migrations/004-daily-token-limit.js` → `src/lib/db/migrations/005-daily-token-limit.js` (version `4` → `5`).
- `src/lib/db/migrations/005-api-key-policy.js` → `src/lib/db/migrations/006-api-key-policy.js` (version `5` → `6`).

## `MIGRATIONS` import list

### Before
```js
import m004 from "./004-daily-token-limit.js";

export const MIGRATIONS = [m001, m002, m003, m004].sort((a, b) => a.version - b.version);
```

### After
```js
import m004 from "./004-api-key-expiry.js";
import m005 from "./005-daily-token-limit.js";
import m006 from "./006-api-key-policy.js";

export const MIGRATIONS = [m001, m002, m003, m004, m005, m006].sort((a, b) => a.version - b.version);
```

## `SCHEMA_VERSION`

### Before
```js
export const SCHEMA_VERSION = 4;
```

### After
```js
export const SCHEMA_VERSION = 6;
```

## `TABLES.apiKeys.columns` keys

### Before
```js
columns: {
  id: "TEXT PRIMARY KEY",
  key: "TEXT UNIQUE NOT NULL",
  name: "TEXT",
  machineId: "TEXT",
  isActive: "INTEGER DEFAULT 1",
  allowedCombos: "TEXT",
  dailyLimitTokens: "INTEGER",
  createdAt: "TEXT NOT NULL",
},
```

### After
```js
columns: {
  id: "TEXT PRIMARY KEY",
  key: "TEXT UNIQUE NOT NULL",
  name: "TEXT",
  machineId: "TEXT",
  isActive: "INTEGER DEFAULT 1",
  allowedCombos: "TEXT",
  dailyLimitTokens: "INTEGER",
  policy: "TEXT",
  expiresAt: "TEXT",
  createdAt: "TEXT NOT NULL",
},
```

## New test file assertions
`tests/unit/db-migrations-registry.test.js` imports `MIGRATIONS` and `latestVersion` from `src/lib/db/migrations/index.js`, reads the migrations directory with `fs.readdirSync`, filters files matching `/^\d{3}-.*\.js$/` (excluding `index.js`), and asserts:

1. `MIGRATIONS.length` equals the number of numeric migration files in `migrations/`.
2. No two migrations share a version (Set size equals array length).
3. `latestVersion()` equals the highest migration version (`Math.max(...MIGRATIONS.map(m => m.version))`).

## Verification status
Ran the new registry test after the orchestrator fixed `node_modules` symlinks:

```
cd tests && npx vitest run --config vitest.config.js unit/db-migrations-registry.test.js

 RUN  v4.1.9 /home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-v2-migrations/tests
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  199ms
```

All three assertions pass. No lint or format was run.

## API-key policy review follow-up

Versioned migrations run before additive schema sync. Migration 006 now creates and reconciles `apiKeyUsageTotals` itself, so schema-v5 upgrades retain historical totals before the migration is stamped. Legacy JSON import reconciles again after inserting API keys and usage history, before its transaction commits.
