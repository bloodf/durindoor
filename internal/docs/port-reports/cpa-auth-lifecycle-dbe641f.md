# Credential lifecycle and persistence parity — #2034

## Source and comparison

Read pinned public sources from router-for-me/CLIProxyAPI (MIT) at
`dbe641f286a489ecb39e3c041c554371e6add864`. Attribution: CLIProxyAPI
contributors. The re-enable reconciliation, shutdown drain and quota-release
fencing rules are adapted from these MIT sources; no Go code is copied.

| Commit | Subject | Disposition |
| --- | --- | --- |
| [`42b13fff`](https://github.com/router-for-me/CLIProxyAPI/commit/42b13fff47716a92bd504acfa034e9bb0c65a2a8) | reconcile disabled-era and orphaned unavailable flags | Ported to the store's re-enable transition; routing already equivalent |
| [`6021aba9`](https://github.com/router-for-me/CLIProxyAPI/commit/6021aba94ea110946747d88bebf0b2fc86c501bb) | write auth files atomically | Equivalent: credentials are rows written in one transaction |
| [`32c0c459`](https://github.com/router-for-me/CLIProxyAPI/commit/32c0c459b0bccaa6438b2ee6335554219251b80d) | wait for in-flight auto-refresh saves during shutdown | Ported to the SIGTERM/SIGINT cleanup |
| [`37caab7d`](https://github.com/router-for-me/CLIProxyAPI/commit/37caab7d768e27c99d2305cba1b5f99bb494f49c) | release credential_quota on completed operator verify | Retention verified; no release path exists to port |
| [`ee8b3f0c`](https://github.com/router-for-me/CLIProxyAPI/commit/ee8b3f0ca03b0394b1e238971151497b7d0fdc04) | validate absent auth file snapshots under mutation lock | Equivalent: no file snapshots; refresh commits are compare-and-swap |
| [`e1e87409`](https://github.com/router-for-me/CLIProxyAPI/commit/e1e87409f39273d99823b03b3153892f9f7542ef) | session cache TTL checks on virtual time | Test-only; local session affinity TTL covered on fake timers |

EasyCLIProxyAPI `29567ead8164a00724dfdc2087f02a23895636ee` is unchanged.
The OmniRoute `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` six-commit delta is
docs and catalog checks only, with no auth runtime change. Neither needs a port.

## Local model

DurinDoor has no auth JSON files, file watcher, plugin scheduler or `Manager`
conductor. A credential is a `providerConnections` row. Disable is
`isActive: false`. Status is `testStatus` with `lastError`, `errorCode` and
`lastErrorAt`. Routing gates are deadlines: `modelLock_*`, `quotaLockout`,
and the legacy `rateLimitedUntil`. Durable reauth is `testStatus:
"reauth_required"` or `errorCode: "REAUTH"`. Every credential write goes
through `applyProviderConnectionPatchInTx`. It runs `QUOTA_WRITE_LOCK_SQL`
(`UPDATE _meta ... WHERE key = 'schemaVersion'`) before reading the row. On
SQLite that takes the writer lock. On Postgres (`pgAdapter.transaction`, a
synchronous BEGIN/COMMIT bridge) the same UPDATE row-locks `_meta` until commit.
Concurrent credential writers serialize on both engines.

## 42b13fff — re-enable and orphaned unavailability

CPA clears disabled-era `Unavailable`/`LastError` on a disabled-to-enabled
transition. It keeps `StatusError` for unresolved sign-in or rejected-token
failures. It also stops a stale `Unavailable` flag with no deadline from
blocking selection.

Existing local behavior:

- Selection (`src/sse/services/auth.js`) never reads `testStatus`. It filters
  on live model locks, quota lockout, quota preflight, RPM/RPD and peak-hour
  gates. An orphaned `"unavailable"` label already does not block routing. A
  new test pins this down: a row labelled `"unavailable"` whose lock expired is
  selected; a row labelled `"active"` with a live lock is not.
- `mergeProviderConnection` clears status and error fields on re-enable only
  when automatic-disable metadata exists (Qoder code 112). It cleared them
  unconditionally, including a `reauth_required` pin or a 401 recorded after
  the disable. That is the CPA bug class: re-enable erasing an unresolved
  sign-in failure.

Change (`src/lib/db/repos/connectionsRepo.js`, `reconcileReenabledConnection`):
on an `isActive` false-to-true patch that sets no `testStatus` and carries no
replacement credential,

- an unresolved auth failure keeps its `testStatus`, `lastError`, `errorCode`
  and `lastErrorAt`. That covers a durable reauth pin, `needsReauth`,
  `"expired"`, or a 401/403 other than the automatic-disable event itself
  (`lastErrorAt === autoDisabledAt`). Patch fields still win.
- otherwise, a `"unavailable"` label with no live model lock, quota lockout or
  rate limit is reset to `null`. Error history stays visible, matching the
  existing port9r #1448 display contract.
- cooldown deadlines are never read for clearing and never written.

The reconciliation sits in the repository merge that every writer uses,
leaving `mergeProviderConnection` and its existing tests unchanged.
Replacement credentials (`replacesCredential`, the reconnect path in
`src/lib/oauth/flowCompletion.js`) skip it, because a new sign-in already writes
`testStatus: "active"` and clears its own state.

CPA's file-snapshot reload reconciliation and `MergeRefreshedAuth` disabled
status handling have no counterpart. No reload re-imports status, and a local
refresh commit never writes `isActive` or `testStatus`.

## 6021aba9 — atomic auth file writes

The Go change replaces truncate-and-write with temp-file, fsync and rename. It
applies to every token file. DurinDoor stores credentials in SQLite (WAL) or
Postgres. A credential patch is one `UPDATE` inside a transaction that also
validates provider identity, Codex workspace and refresh context. A thrown
check rolls back the whole patch. A new test forces an identity violation
after the merge and confirms the stored tokens are unchanged. No auth JSON
file writer exists, none is added, and no secret is rewritten.

## 32c0c459 — drain refresh persistence on shutdown

The cleanup (`src/shared/services/initializeApp.js`) used to stop the
background scheduler and call `process.exit(0)` without waiting. A refresh
whose provider call had already rotated a single-use refresh token could lose
its store write. The next start then fails with `invalid_grant`.

Changes:

- `open-sse/services/refreshSerializer.js`: `trackRefreshPersistence(promise)`
  and `drainRefreshPersistence({ timeoutMs })`. The drain waits for tracked
  operations, including those registered while it runs. It is bounded by its
  deadline, never rejects and never calls back into refresh code. A drain
  started inside a tracked operation is released at the deadline instead of
  deadlocking on itself (CPA's hook reentrancy concern). The deadline timer
  is intentionally not `unref`'d. An unref'd timer let a drain with nothing
  else on the event loop hang until process exit.
- `src/shared/services/providerCredentials.js`: each request-path refresh
  operation, which contains its store write, is tracked.
- `src/sse/services/backgroundTokenRefresh.js`: each background refresh is
  tracked. `stopBackgroundTokenRefresh()` now also stops a running tick from
  starting another account or sleeping between accounts.
- Cleanup awaits the drain for at most 5 s after stopping the scheduler and
  logs the count of writes still pending. The existing `cleanupInProgress`
  guard makes a second signal a no-op, so concurrent shutdowns cannot both
  run teardown. CPA's `shutdownRefreshWaiters` bookkeeping is unnecessary here.

CPA's per-job `autoRefreshInFlight` counter and context-carried release hook
are not copied. Tracking the operation promise covers both the refresh and
its persistence.

## Concurrent refresh, deletion and supersession (ee8b3f0c, 32c0c459)

ee8b3f0c fences watcher file snapshots so a stale snapshot cannot register a
deleted or replaced auth. With no file snapshots, the local risk is a late
refresh commit. Existing guards already prevent it:

- `refreshAndUpdateCredentials` commits with `expectedRefreshContext`. A deleted
  row returns `null` (`PROVIDER_CONNECTION_NOT_FOUND`), and `upsert` only runs
  on a row read under the lock. A reconnect changes the context, so the late
  result is refused (`refreshed: false`).
- An unrecoverable refresh re-reads the row. It reports deletion, defers to a
  winning rotation, and pins reauth only under the original context.

Residual, not changed here: the GitHub Copilot token write in
`checkAndRefreshToken` (`src/sse/services/tokenRefresh.js`) is unguarded and
writes the caller's `providerSpecificData` snapshot. A reconnect landing
during the Copilot exchange could have that late write restore old routing
metadata and a Copilot token minted from the replaced GitHub token. A deleted
row is not recreated. An atomic fence needs a
`shouldCommitConnection` option on that call. The unchanged
`tests/unit/port9r-proxy-refresh-884.test.js` asserts the exact two-argument
call shape, so this lane leaves it as a follow-up. A non-atomic pre-read would
only narrow the window.

## 37caab7d — credential_quota release

CPA lets a completed, account-pinned operator inference verify release a live
`credential_quota` cooldown. Registration epoch and credential version fence
it, and the cooldown sequence must predate the verify. Ordinary traffic never
releases it.

DurinDoor's credential-wide quota state is `quotaLockout`. Releases today:

- Expiry. `clearProviderConnectionFallbackState` (ordinary request success)
  clears only an expired lockout and never an active or indefinite one.
- An explicit operator `PUT { quotaLockout: null }` (operator-gated).

The connection test (`testSingleConnection`) is a key or token check, not an
inference verify. It writes `"active"`, `"unknown"` for skipped/unverified
checks, or `"error"`. `resetHealthStateOnActivation` keeps `quotaLockout` and
live model locks. `test-models` writes no credential state. With no completed
inference verify that records an outcome, there is no release to port.
Inventing one would broaden routing behavior. Tests confirm ordinary success,
a skipped test and a passing test all keep a live lockout and live model lock.
They also confirm ordinary success clears only an expired lockout.

## e1e87409 — virtual-time TTL

The local counterpart is `src/sse/services/auth/sessionAffinity.js`.
`getSessionAffinity` refreshes `lastUsed`, and a sweep interval evicts entries
idle past `sessionTtlMs`. A fake-timer test advances past the original
deadline inside the refreshed one, then past the refreshed TTL. No wall-clock
sleeps are involved.

## Not ported

Go plugin scheduler, YAML/file watcher, `RegisterFileSnapshotIfAbsent`,
model-registry projection and `MergeRefreshedAuth` field merging have no
DurinDoor runtime counterpart.

## Evidence

`tests/unit/cpa-auth-lifecycle-parity.test.js` uses disposable HOME/DATA_DIR,
real SQLite, mocked executors and no provider network. It covers re-enable,
orphaned and live cooldown, deletion and supersession races, persistence
failure, transactional rollback, quota retention, shutdown drain (bounded,
reentrant, background stop, SIGTERM ordering) and fake-time TTL.
Existing tests are unchanged and the failure baseline is untouched.

All commands ran with umask 077 and `env -i` (explicit PATH/LANG/CI only),
using a private `/var/tmp` HOME, DATA_DIR, TMPDIR, cache and package store:

- Requested evidence command: `cd tests && test -f unit/cpa-auth-lifecycle-parity.test.js && node node_modules/vitest/vitest.mjs run unit/cpa-auth-lifecycle-parity.test.js --maxWorkers=2`.
  The result is recorded in the commit body.
- Mutation check: with `connectionsRepo.js`, `initializeApp.js` and
  `backgroundTokenRefresh.js` reverted, the re-enable, orphan, background
  stop and SIGTERM ordering tests fail.
- Unchanged neighbor suites run: Qoder auto-disable, port9r #1448, background
  refresh, MCP shutdown (2), network-observation init, reauth fallback guard,
  provider credentials, GitHub/GHE Copilot (3), proxy refresh #884, fallback
  state repository, OrcaRouter lifecycle, Codex identity (2), Qoder queue scope.
- The store ran on `node:sqlite`, because the native `better-sqlite3` build was
  not compiled in the private install. No full CI, e2e, browser, Docker or
  live account was used.
