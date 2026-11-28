# Retain failed signature overwrites (#2034)

Base: `4e1250681c23ee41036a66b78eaf02df15b4cca8`.
The store's last modifying ancestor is
`e67f61331e0bb8642529eed89c7c97c4abe1bb4e` (locked-adapter write retention).
The supplied independent review identifies assembled candidate
`5dc663bd0676a26f7a97cf29e3b5f460c96f7fbd` and maps its last patch to that
native ancestor. This work changes the current unit ancestor; it does not claim
an exact assembled-candidate checkout or a fresh upstream comparison.
Source freeze: 2026-11-27T23:49:25.752045Z. No upstream fetch was performed.
Existing upstream attribution and MIT licensing remain unchanged.

## Before and after

First copied the supplied read-only `stale-signature-repro.test.js` into the
new regression test path and ran it before editing production code. It used
only a disposable local SQLite database and injected SQLITE_BUSY on UPSERT,
while reads remained available. Actual output:

```text
CASE A read -> "NEW-A"
CASE B read -> "OLD-B"
CASE B stale (read returned OLD-B) -> true
CASE C read -> "NEW-C"
AssertionError: expected 'OLD-B' to be 'NEW-B'
Tests: 1 failed | 2 passed (3)
```

The shell printed the captured output successfully; the Vitest report itself
records the failed assertion. Raw evidence is in
`/var/tmp/agy2034-4e125-tmp/before.log`.
The original review artifact and SUMMARY.txt were read only.

After the change, case B reads and persists `NEW-B`; stale is false.
The expanded regression file has 11 ordinary passing tests. Alongside the five
protected suites the initial focused run passes 6 files / 104 tests, all
ordinary passing cases. Raw initial focused output:
`/var/tmp/agy2034-4e125-tmp/final.log`.

## Behavior

Each failed UPSERT retains the complete newest row regardless of an older
persisted row's presence or matching signature text. Successful rows clear
pending state independently. Deferred writes check entry identity after
adapter acquisition, so an older capture cannot overwrite a newer synchronous
or pending capture, or resurrect a cleared capture. Cold readers recheck pending
state after asynchronous boundaries. Synchronous keyed cold reads also prefer
pending rows over stale persisted rows.

A failed retry returns the retained row through the existing provenance and
expiry checks. It does not pretend SQLite succeeded. Retries preserve original
createdAt, expiresAt, account, family, primary and owner fields; no TTL is
restarted. Expired pending replacements remain pending until successful write
or eviction so an older, longer-lived persisted row cannot reappear after a
failed retry. One cold read performs at most one retry after awaiting an
existing attempt; there are no retry loops, sleeps or timers. The existing
2000-key pending bound remains: eviction can discard undurable captures.

Regression coverage includes missing-old control, open adapter + failed
overwrite + recovered retry, closed adapter + older row, delayed concurrent
writes and reader, persistent failure with bounded attempts and cleanup,
identical signature text with changed account, family/session isolation,
original expiry and prevention of expired-row resurrection, capture during
read adapter acquisition, clear cancellation, and pending queue capacity.

## Validation and limits

Essential frozen root and tests installs used this checkout's own node_modules
and `/var/tmp/agy2034-4e125-store`; no borrowed dependency graph was changed.
Commands ran through `env -i` with explicit PATH/LANG/CI and private HOME,
DATA_DIR, TMPDIR and cache under `/var/tmp/agy2034-4e125-*`, with timeout 300.
No provider or publisher credentials were passed.

From `tests/`, direct Node Vitest command (two workers):

```sh
node node_modules/vitest/vitest.mjs run \
  unit/antigravity-signature-stale-writeback-2034.test.js \
  unit/antigravity-signature-isolation-completion.test.js \
  unit/antigravity-thought-signature-family.test.js \
  unit/antigravity-signature-scope-21439-3366.test.js \
  unit/cpa-gemini-replay-parity.test.js \
  unit/cpa-gemini-replay-retained.test.js --maxWorkers=2
```

Direct Node ESLint passed on the changed JS and test file. The existing
anti-slop plugin was bundled with its direct Node build script, then direct
Node oxlint ran with `.oxlintrc.json`, `--threads=2` and the same file paths:
zero warnings/errors (one applicable file; existing config excludes tests).
No rules were disabled. `git diff --check` passed. The five protected test
files have no diff against the base; no failure baseline was changed.

No live database, provider, production data, browser, full inventory, build,
Docker, hosted Actions, push or merge was exercised. This is a scoped local
result; standalone assembly, independent review and the parent reduced gate
remain outside this change.

## Gate correction

The follow-up gate exposed a regression in the persisted-reader abstraction:
`port9r-5894-antigravity-persisted-signatures.test.js` supplies persisted rows
through `makeKv`, while the first patch queried the adapter directly. The
existing cold replay assertion failed locally too (1 failed / 2 passed),
returning the default signature instead of `PERSISTED_SIGNATURE`.
Raw reproduction: `/var/tmp/agy2034-4e125-tmp/gate-before.log`.

Cold reads now use `signatureKv.get` again and still recheck pending rows after
that await. Deferred writes retain their post-open identity guard. This keeps
the persistence abstraction and latest-row protection together. The report's
validation sentence was also rewritten to remove wording flagged by the gate.
No existing tests were edited.

Follow-up validation: the six previously listed suites plus both
`port9r-5894-antigravity-persisted-signatures.test.js` and
`port9r-antigravity-persisted-signatures-5894.test.js` pass together:
8 files / 110 tests, using the same direct Node command and two workers.
Raw output: `/var/tmp/agy2034-4e125-tmp/gate-after.log`.
Scoped direct Node ESLint, configured oxlint and `git diff --check` pass.
The five protected suites remain byte-unchanged against the original base.
