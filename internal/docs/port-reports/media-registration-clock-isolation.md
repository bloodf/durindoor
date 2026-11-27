# Media registration fixtures: storage isolation

Refs #2034.

## Failure

With two workers, `register-native-01`, `register-native-02`,
`register-native-02-original-contract`, and `provider-media-registration-1127`
failed intermittently. A route returned 500, and the log showed
`SqliteError: database is locked`. The failure only happened when the runner
environment set `DATA_DIR`. The sync worker environment does this.

## Root cause

The fixtures mocked `@/lib/dataDir.js`, but `src/lib/db/paths.js`
`currentDataDir()` returns `process.env.DATA_DIR || DATA_DIR`. An inherited
`DATA_DIR` overrides the mock. Every worker then opened the same
`<DATA_DIR>/db/data.sqlite`. Two more gaps made this worse:

- `provider-media-registration-1127` does not mock the data dir. With
  `DATA_DIR` unset, it created and wrote `~/.9router/db/data.sqlite` in the
  real home directory. Running it with an isolated `HOME` proved this.
- The other three files started with `m.dir = ""`. Paths captured at import
  time, such as `DB_DIR`, therefore resolved relative to the working directory.

## Fix (harness only)

Each of the four files does the following:

1. In `vi.hoisted`, before any application or database import, it creates a
   private `mkdtemp` directory, records whether `DATA_DIR` was set and its old
   value, and sets `process.env.DATA_DIR` to the private directory. It reads
   `fs`, `os`, and `path` through `process.getBuiltinModule` because hoisted
   code runs before the file's imports.
2. In the three register files, `m.dir` starts at that private directory
   instead of `""`. `beforeEach` sets `process.env.DATA_DIR = m.dir` right after
   the existing per-test `mkdtemp`. Each test therefore keeps its own fresh DB,
   which is the same behavior as a run with `DATA_DIR` unset.
3. `afterAll` handles cleanup. The driver keeps its handle on
   `globalThis._dbAdapter`, which outlives a file in a reused fork worker.
   `afterAll` closes that handle and resets its state only when the handle
   points inside this file's own directories. It then restores or deletes only
   `DATA_DIR` and removes the private directory.

What stays the same:

- No case, assertion, deadline, count, or mock answer changed. The only removed
  lines are the vitest import line, which gains `afterAll`, and `dir: ""`.
- Nothing changed in the runtime, runner, config, worker count, or retries.
- `tests/unit/register-native-02-original-contract.test.js` was merged from the
  accepted commit `6e7afef8f2` before the fix. It keeps all 68 cases.

## Clock race

No clock or timer change was made. None of the runs below produced a 400, 401,
402, 429, or 504 status mismatch. Every failure was the SQLite lock, which
surfaced as a 500. Following the "storage first; clock only if independently
reproducible" rule, the fake-clock `settle()` loop and the existing deadlines
are unchanged.

## Evidence

Command, with all four files and two workers:

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/register-native-01.test.js \
  unit/register-native-02.test.js unit/register-native-02-original-contract.test.js \
  unit/provider-media-registration-1127.test.js --maxWorkers=2
```

| Run | `DATA_DIR` | Result |
| --- | --- | --- |
| before, 3 files, x2 | shared scratch dir | 168/169 both runs; `register-native-02 > fal video > uses the canonical identity…` got 500, `database is locked` |
| before, 4 files, x2 | shared scratch dir | run 1 237/237; run 2 236/237, same 500 and lock |
| before, 1127 alone | unset, isolated `HOME` | passes, but creates `$HOME/.9router/db/data.sqlite` |
| after, 4 files, x3 | shared scratch dir | 237/237 each, 0 lock lines, shared dir left empty |
| after, 4 files | unset, isolated `HOME` | 237/237, nothing written under `HOME`, no leftover private dirs |

## Mutation checks

Each mutation was applied to the runtime temporarily, run, and reverted. None
was committed.

| Mutation | Caught by |
| --- | --- |
| Agnes `boundedFetch` timer no longer aborts (`http.js`) | `register-native-01`: "the per-request deadline tears down the socket and keeps the job as accepted" fails |
| Adobe expired pasted token accepted (`auth.js`) | `1127`: "an expired pasted token is refused with 401 before anything is sent" fails |
| fal uncertain failure not tagged as an accepted job (`job.js`) | `register-native-02` and `-original-contract`: "records an accepted job once if polling loses the result" and "an exhausted job deadline is a 504 recorded once as accepted, never resubmitted" fail |
| Fixture isolation removed (pre-fix files) | the lock returns; see the "before" rows |
