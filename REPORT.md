# apiKeyUsageTotals missing-table guard report

## Files changed
1. `src/lib/db/repos/apiKeyUsageTotalsRepo.js`
2. `src/sse/services/apiKeyPolicy.js`
3. `src/sse/handlers/chat.js`
4. `tests/unit/api-key-usage-missing-table.test.js` (new)

## Failure mode
`04-dashboard-sse.md` P1 flagged that the `apiKeyUsageTotals` table is not guarded against the table being absent, while per-API-key limit logic in `getApiKeyUsageLimitStatus` (and the chat handler) will also be called on a DB where the F1 migrations have not yet run. The belt-and-braces case is when this PR merges before the F1 migration lands: any SELECT/UPSERT against `apiKeyUsageTotals` throws `SqliteError: no such table: apiKeyUsageTotals`. In `recordApiKeyUsage` and in the SSE chat handler this surfaced as an unhandled exception / 500 rather than a graceful fallback.

## Changes

### `src/lib/db/repos/apiKeyUsageTotalsRepo.js`
All three public functions that touch `apiKeyUsageTotals` now catch only the `no such table: apiKeyUsageTotals` error and return safe defaults; every other error still propagates. This protects callers that read lifetime totals from the dedicated totals table.

```js
function isMissingApiKeyUsageTotalsTable(err) {
  return err?.message?.includes("no such table: apiKeyUsageTotals");
}
```

- `getApiKeyUsageTotals` now returns `{ totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null }` instead of throwing.
- `getAllApiKeyUsageTotals` now returns `[]` instead of throwing.
- `incrementApiKeyUsageSync` now returns silently instead of throwing.

### `src/sse/services/apiKeyPolicy.js`
`recordApiKeyUsage` wraps the `incrementApiKeyUsageSync` call. If the totals table is missing, usage recording is skipped silently; other errors are still thrown so unrelated DB failures are not masked.

### `src/sse/handlers/chat.js`
The call to `getApiKeyUsageLimitStatus` is now wrapped. The current implementation reads `apiKeys` and `usageHistory` (not `apiKeyUsageTotals`), but the wrapper is defensive: if the totals table is missing because of a future/refactored path, the request continues with `{ enforced: false, exceeded: false }`. Any other DB error (including missing `apiKeys`/`usageHistory` or corrupted schema) returns `503 Service Unavailable`, so only a genuinely broken DB aborts the request with an outage status, while the missing-migration case is treated as no limit enforced.

### `tests/unit/api-key-usage-missing-table.test.js`
New test using a temp SQLite file that only creates `apiKeys` and deliberately omits `apiKeyUsageTotals`. Asserts:
- `getApiKeyUsageTotals` returns the safe default.
- `getAllApiKeyUsageTotals` returns an empty array.
- `incrementApiKeyUsageSync` does not throw.
- `recordApiKeyUsage` resolves without throwing.

## Why the chat handler is safer
Before the edit, any `getApiKeyUsageLimitStatus` exception caused the handler to return 500. After the edit, a missing `apiKeyUsageTotals` table is treated as no daily limit (non-fatal), while other failures (e.g. missing `apiKeys`/`usageHistory`, corrupted schema) still emit a 503, clearly distinguishing migration lag from real DB outage.

## Verification note
Per assignment, tests, lint, and format were not run.
