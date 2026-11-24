# Account availability from OmniRoute 3588f5ca

Status: local implementation, not a completed port. No PR link is recorded.

The [row 91 comparison and its correction](1073-nov24-row-91-complete.md) identified two parts in [upstream commit 3588f5ca](https://github.com/cheaper-inference/OmniRoute/commit/3588f5ca79d8ce2d5ba0a1ffc98906d687338b5e). On 2026-11-24, the commit was fetched from `omniroute-upstream` and its complete diff was inspected: the account fallback change, its tests, changelog fragment and mutation-test configuration.

At local HEAD `1952fceab062f4c467ad292a5bfab86bf440452e`, the exported `filterAvailableAccounts` checked exclusions, quota lockouts and cooldowns but did not check account status. It accepted `banned`, `expired` and `credits_exhausted`. The only repository references were its definition, the public export, and an existing unit test; this change does not claim a current routing effect.

The local change checks `status` against the existing terminal-state set, which also includes `deactivated`, with the same case and whitespace normalization used by `isTerminalAccount`. It leaves `testStatus` and `isActive` untouched, preserving this function's existing behavior for those fields. Nonterminal statuses, exclusions, quota lockouts and cooldowns retain their prior rules.

The provider-alias portion is deferred. DurinDoor lacks upstream's shared provider breaker and its `recordProviderFailure` and `clearProviderFailure` functions. A future port of that subsystem must resolve aliases before clearing its failure deduplication state.

The open PR list was checked on 2026-11-24. Of 13 open PRs, [#2484](https://github.com/bloodf/durindoor/pull/2484) also changes `accountFallback.js`, but its diff addresses Cline cooldowns and model-scoped failures, not `filterAvailableAccounts`. No availability-filter overlap was found in the changed-file lists, including paginated results.

Verification: `node node_modules/vitest/vitest.mjs run unit/account-availability-terminal.test.js --maxWorkers=2` from `tests/`, with private `HOME`, `DATA_DIR` and cache directories, passed 12 tests. An initial attempt imported the broad public index and failed during module loading; the focused test imports the defining module, and the public re-export was verified in source. This is focused evidence, not the full local CI gate.

The same command with `unit/port9r-quota-lockout-5462.test.js` passed 7 existing tests. `git diff --check` passed.
