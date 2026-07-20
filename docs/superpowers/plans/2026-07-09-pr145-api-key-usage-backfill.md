# PR 145 API-Key Usage Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make API-key lifetime policy totals available and historically accurate when upgrading a schema-v5 SQLite database or importing legacy JSON usage.

**Architecture:** Put the idempotent table creation and history reconciliation in one migration helper. Migration 006 invokes it for existing SQLite upgrades; the one-time legacy JSON path invokes the same helper after importing API keys and usage so execution order cannot leave an empty rollup.

**Tech Stack:** JavaScript ESM, SQLite through the repository adapter, better-sqlite3 test fixtures, Vitest.

## Global Constraints

- Do not rewrite existing API key secret strings.
- Do not modify `tests/__baseline__/known-fails.txt` unless removing entries for tests fixed in this PR.
- Runtime behavior changes require unit tests and documentation.
- The API-key totals table uses columns `apiKeyId`, `totalTokens`, `totalCost`, `totalRequests`, and `updatedAt`.
- Historical totals match `usageHistory` rows by exact `usageHistory.apiKey = apiKeys.key` and aggregate prompt plus completion tokens, cost, and request count.
- Migration and legacy-import reconciliation must be idempotent.
- Follow Conventional Commits; subject length is at most 100 characters and body lines are at most 200 characters.

---

### Task 1: Reconcile lifetime API-key totals at both migration boundaries

**Files:**

- Create: `src/lib/db/migrations/apiKeyUsageTotalsBackfill.js`
- Modify: `src/lib/db/migrations/006-api-key-policy.js`
- Modify: `src/lib/db/migrate.js`
- Modify: `tests/unit/db-api-key-policy-roundtrip.test.js`
- Modify: `REPORT.md`

**Interfaces:**

- Consumes: the existing DB adapter methods `exec(sql)`, `all(sql, params?)`, and `run(sql, params?)`.
- Produces: `ensureAndBackfillApiKeyUsageTotals(db)`, an idempotent helper that creates the rollup table and replaces each API key's totals with aggregates from `usageHistory`.

- [ ] **Step 1: Write the failing schema-v5 upgrade test**

Add a test to `tests/unit/db-api-key-policy-roundtrip.test.js` that creates `tempDir/db/data.sqlite` with better-sqlite3 before importing the app DB modules. Seed `_meta.schemaVersion = 5`, one API-key row, and two `usageHistory` rows for that exact key. Boot the real adapter and assert:

```js
expect(db.get(`SELECT value FROM _meta WHERE key = 'schemaVersion'`).value).toBe("6");
expect(db.get(`SELECT totalTokens, totalCost, totalRequests FROM apiKeyUsageTotals WHERE apiKeyId = ?`, [keyId])).toEqual({
  totalTokens: 42,
  totalCost: 0.75,
  totalRequests: 2,
});
```

The fixture must use the real schema-v5 column shapes needed by migration 006 and additive schema sync. Do not mock migration functions.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd tests
npx vitest run --config vitest.config.js unit/db-api-key-policy-roundtrip.test.js
```

Expected: the new upgrade test fails because migration 006 returns when `apiKeyUsageTotals` does not yet exist; schema sync creates an empty table only after the migration is stamped.

- [ ] **Step 3: Add the shared idempotent reconciliation helper**

Create `src/lib/db/migrations/apiKeyUsageTotalsBackfill.js` with an exported `ensureAndBackfillApiKeyUsageTotals(db)` function. It must:

```js
db.exec(`
  CREATE TABLE IF NOT EXISTS apiKeyUsageTotals (
    apiKeyId TEXT PRIMARY KEY,
    totalTokens INTEGER DEFAULT 0,
    totalCost REAL DEFAULT 0,
    totalRequests INTEGER DEFAULT 0,
    updatedAt TEXT
  )
`);
```

Then aggregate every API key with a `LEFT JOIN usageHistory ON usageHistory.apiKey = apiKeys.key`, using `COALESCE(SUM(promptTokens + completionTokens), 0)`, `COALESCE(SUM(cost), 0)`, and `COUNT(usageHistory.id)`. Replace one rollup row per API key with a single stable `updatedAt` timestamp for the reconciliation run.

- [ ] **Step 4: Invoke the helper at both ordering boundaries**

In `006-api-key-policy.js`, replace the table-existence early return and inline reconciliation with `ensureAndBackfillApiKeyUsageTotals(db)` after adding `apiKeys.policy`.

In `migrate.js`, invoke the same helper inside the legacy-import transaction immediately after `importLegacyUsage(adapter, legacyUsage)`. At that point `importLegacyMain` has inserted API keys and `importLegacyUsage` has inserted history, so the rollup reflects imported data before the transaction commits.

- [ ] **Step 5: Verify GREEN for the schema-v5 test**

Run the same focused Vitest command. Expected: the full file passes and the new test reports the seeded totals exactly.

- [ ] **Step 6: Add and verify the legacy JSON regression test**

Add a test that writes `db.json` with one API key and `usage.json` with two history rows for its exact key into `tempDir`, boots the real adapter, and asserts the same totals in `apiKeyUsageTotals`. Run the focused file and verify all tests pass.

- [ ] **Step 7: Document the corrected execution order**

Append a short `API-key policy review follow-up` section to `REPORT.md` explaining that versioned migrations run before additive schema sync, migration 006 now creates and reconciles the rollup itself, and legacy JSON import reconciles again after inserting historical rows.

- [ ] **Step 8: Run task verification**

Run:

```bash
cd tests
npx vitest run --config vitest.config.js unit/db-api-key-policy-roundtrip.test.js unit/db-migrations-registry.test.js unit/apiKeysRepo-policy.test.js
cd ..
git diff --check d55f07d4b..HEAD
git diff --exit-code origin/dev...HEAD -- tests/__baseline__/known-fails.txt
```

Expected: all focused tests pass; whitespace check passes; the failure baseline is unchanged.

- [ ] **Step 9: Commit and self-review**

Commit all five task files with:

```bash
git add src/lib/db/migrations/apiKeyUsageTotalsBackfill.js src/lib/db/migrations/006-api-key-policy.js src/lib/db/migrate.js tests/unit/db-api-key-policy-roundtrip.test.js REPORT.md
git commit -m "fix(db): backfill API key policy usage totals"
```

Confirm the commit contains no generated files, dependency files, secrets, or changes outside this task.
