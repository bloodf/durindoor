# 1073: usage-write contention comparison

Compared [OmniRoute #20226](https://github.com/cheaper-inference/OmniRoute/pull/20226), head `34576107b21443886b8273c372d2b7d848453b93`, merge `186db2e375c76a7eeda8b56cd349246c201faede`, base `60e1f5e8d03038f6ea1c463f8671f9a8529cd014`. Its `src/lib/usage/usageWriteRetry.ts` extends an existing deferred, best-effort locked-write retry to five delays of 1, 2, 4, 8 and 16 seconds. This is distinct from its purged-history rollup watermark/late-row logic (`usagePurge.ts`, `aggregateHistory.ts`, `usagePurgedBefore.ts`) and its single-transaction gamification XP and leaderboard award (`gamification.ts`, `gamification/events.ts`).

DurinDoor has no checked equivalent of that purged-rollup watermark and late-row processing subsystem or gamification XP/leaderboard subsystem. Its `usageRepo.js` instead updates `usageDaily` in the original usage transaction, and `pruneUsageBeforeInTx` removes old history and daily rows and rebuilds the boundary day. Neither upstream component is ported; no schema or migration is introduced.

## Persistence and adaptation

Chat's `saveUsageStats` supplies the event timestamp and calls `saveRequestUsage` best-effort without awaiting it. Native usage's `recordApiKeyUsage` awaits the same repository with `strict: true`, translating failures to `USAGE_ACCOUNTING_FAILED`; accepted-job handling catches that failure separately. MCP also calls the repository best-effort. The repository validates and prices once, then its adapter transaction claims an event receipt and writes history, daily aggregates, lifetime and key totals together; its billing-epoch guard and accepted-job settlement remain in that transaction. Post-commit ring and notification updates stay outside it. Explicit event IDs deduplicate, while absent IDs represent distinct events.

A residual existed when an identified best-effort transaction encountered SQLite contention: the existing catch logged and returned false. The repository now retries that transaction at most three times, after 25, 100 and 250 ms, only for exact `SQLITE_BUSY` from `better-sqlite3`, with a stable event ID and without `strict`. The adapter wraps the callback in better-sqlite3's transaction; rollback precedes a thrown error, and the durable receipt protects replay. Attempt-local post-commit flags are reset on each attempt. The original normalized timestamp, pricing, attribution, event ID and billing epoch are retained. There is no independent queue; the existing asynchronous write owns its bounded delays. Exhaustion and other failures retain the existing logging and return behavior.

Strict accounting remains immediate, preserving the caller's reservation and error contract. Events without an ID, other SQLite adapters (whose exposed error and rollback behavior differs), PostgreSQL, and errors other than the exact busy code are not retried. In particular, ambiguous commit failures and message text are not classified as contention. This intentionally narrower adaptation does not claim to retain every SQLite or PostgreSQL contention failure.

## Evidence

`tests/unit/omni-usage-write-busy-retry.test.js` injects errors inside an isolated local adapter transaction after the writes, exercising rollback before retry. It covers successful retry and duplicate replay, exhaustion, non-retryable error, strict and unidentified events, original timestamp, and single history, daily and key totals. It does not test a remote database or reproduce a live lock. Run:

```sh
rg -q -F 34576107b21443886b8273c372d2b7d848453b93 internal/docs/port-reports/1073-usage-write-busy-retry.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-usage-write-busy-retry.test.js)
```
