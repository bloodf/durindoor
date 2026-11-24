# 1073: OmniRoute #21159 intake

Disposition: verified gap in the standalone per-handle release contract. This is not a completed port or evidence of a current production lock incident.

Reviewed [OmniRoute PR #21159](https://github.com/cheaper-inference/OmniRoute/pull/21159), open at head `59f6a7893437c6363482561056adcd332e02cc62`, against DurinDoor head `f390505c68c459caa5a7b3bfcda47144db1e5b35`. The upstream diff adds `src/lib/db/exclusiveLockRelease.ts`, updates Bun and Node SQLite adapters, and adds adapter and release tests. The helper refuses to close when transaction state is true or unknown, attempts close without a pragma, and reports the observed handle state, including unreadable state and close failures. Its `CLOSED` result describes one handle, not the whole database. The diff does not wire the helper into a caller.

DurinDoor's `src/lib/db/adapters/betterSqliteAdapter.js`, `nodeSqliteAdapter.js`, and `bunSqliteAdapter.js` expose `close()` and `raw`, but no equivalent adapter-level `open` and `inTransaction` contract or release helper. Their graceful close paths attempt a WAL checkpoint and swallow close errors. `src/lib/db/adapters/sqljsAdapter.js` has a separate close implementation. `src/lib/db/cutover.js` checkpoints the live SQLite handle for its snapshot; that is not the upstream release contract. `tests/unit/db-checkpoint-safety.test.js` covers incomplete checkpoints and migration refusal, not transaction-aware handle release. No `locking_mode` use was found under `src/lib/db`.

If a caller needs this contract, bounded implementation would adapt the relevant SQLite adapters and their close lifecycle, add a per-handle release helper, and test active and unknown transactions, close failures, observed closed state, and a real exclusive-lock holder with a second reader. The SQLite adapters, new helper, focused unit tests, and corresponding documentation are the affected paths. Determine the caller and lifecycle requirements first; the upstream standalone helper establishes no DurinDoor call site. Recheck the upstream head before implementation.

The open DurinDoor PRs checked were #2430, #2112, #1809, and #1784. Their listed changed paths contain no `src/lib/db/` path or SQLite/lock-named path, so no direct overlap with this scope was found. This path check does not establish the contents of unpublished work. No existing report mentioning #21159 or exclusive-lock release was found in `internal/docs/port-reports/`.

## Implementation evidence

Status: implemented on branch `orq/tows9a/port-omni-21159-a1`; not ported until a DurinDoor PR exists and merges. Recorded evidence below is from the branch, not from production.

Upstream head was re-fetched and is still `59f6a7893437c6363482561056adcd332e02cc62` (open, five files: Bun and Node adapter getters, `exclusiveLockRelease.ts`, two test files). Open DurinDoor PRs #2430, #2112, #1809, and #1784 were re-listed; none touches `src/lib/db/` or the files below. Upstream's no-caller scope is kept: no existing DurinDoor caller was found, so none was added.

Changes:

- `src/lib/db/exclusiveLockRelease.js`: `releaseExclusiveLock(adapter)` with the upstream outcome set. Contract in [sqlite-exclusive-lock-release.md](../sqlite-exclusive-lock-release.md).
- `betterSqliteAdapter.js`, `nodeSqliteAdapter.js`, `bunSqliteAdapter.js`: read-only `open` and `inTransaction` getters. Adapter `close()` still swallows driver errors; `open` now follows the driver (better-sqlite3, node:sqlite) or the observed close outcome (bun, which now uses `close(true)` so a pending-query refusal is not silently treated as closed). `sqljsAdapter.js` is unchanged and is refused as an unknown transaction state.
- `tests/unit/exclusive-lock-release.test.js` (16 tests): real better-sqlite3 exclusive holder that blocks a second connection until released, a second process reading after release, open-transaction refusal, live-cursor close failure then retry, no pragma set, node:sqlite state and release, sql.js refusal, and stubbed outcome mapping (unknown state, throwing getters, close-then-throw is `CLOSED`, unreadable witness is not open or closed).

Verification run: `cd tests && npx vitest run unit/exclusive-lock-release.test.js unit/db-checkpoint-safety.test.js unit/db-driver-chain.test.js` passed (3 files, 21 tests). A manual Bun 1.4.5 probe against the real adapter showed `open`/`inTransaction`, a refused open transaction, and `CLOSED` after commit; it is not an automated test because the suite runs on Node.

Known limits: the bundled node:sqlite did not block a second connection while in exclusive mode in this environment, so that driver's test asserts post-release readability only. The full `test:ci` batch was not run. No stored secrets or production gateway were touched.
