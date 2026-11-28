Verdict: READY
PR: #2683 (https://github.com/bloodf/durindoor/pull/2683); platform-independent #2661 work, closes #2684; macOS process groups out of scope.
Reviewed head: b7b31f1cdabaf0c101bc8d5daa662523ff28d349 (merge of origin/main into 5e0420fec70e36950849b6b3999133caf60d36e8).
Old reviewed head: 5e0420fec70e36950849b6b3999133caf60d36e8.
origin/main: c0ab5d52df1a4c9f8cf2bfa26c16cbe0ac845492; merge-base with head: c0ab5d52df1a4c9f8cf2bfa26c16cbe0ac845492.
Prior review comments: `gh pr view 2683 --comments` and `gh api .../pulls/2683/{comments,reviews}` returned no comments and no reviews on GitHub; the earlier sweep's own disposition is `internal/docs/pr-sweep/prepare-2683.md` (Verdict: READY, findings: none) at commit 01f2768459.
Conflicts (4): internal/docs/local-ci.md, scripts/lib/website-shard-server.mjs, tests/unit/website-browser-checkpoint-playwright.test.js, website/playwright.config.mjs. `git show --remerge-diff b7b31f1cda` inspected; no conflict markers remain in the tree.

## Merge resolution (main's behaviour and the PR's fix both survive)

- scripts/lib/website-shard-server.mjs: resolution kept main's implementation; merged blob is byte-identical to main's (`git diff c0ab5d52df b7b31f1cda -- scripts/lib/website-shard-server.mjs` is empty). Main's version is a strict superset of the PR's #2684 fix: it keeps fail-closed `uncertain` verdicts and per-PID re-verified signalling, and adds the ancestry-based `foreign` classification (parseStat ppid/session, `couldBelongToShard`, `serverIdentity`) that the PR head lacked. No main behaviour lost.
- scripts/local-ci.mjs: blob bfdaaa74aab7e981c6e51a3ed8aecadeaace036a is identical in 5e0420fec, c0ab5d52df and b7b31f1cda, so `planWebsiteBrowserShards` (non-empty shard planning, rejects "no non-empty shard plan"), `snapshotShardBaseline`, `unattributedListener` and `uncertain` reporting all survive unchanged.
- tests/unit/website-browser-checkpoint-playwright.test.js (add/add): resolution took the PR's stricter file. No main assertion dropped or weakened — all four `it` blocks of main's version remain and block 1 is strengthened (main's `expect(result.ok).toBe(false)` / `expect(absent.ok).toBe(false)` become `toMatchObject({ ok: false, verification: "procfs" })` and `toMatchObject({ ok: false, verification: "port-only", signalled: [] })`, plus a `vi.fn()` kill mock asserting nothing is signalled).
- Other PR test files are byte-identical in the PR head, main and the merge (browser-shard-cleanup-darwin 3d2e8457, browser-shard-cleanup-procfs e9708c66, browser-shard-cleanup-review 56c6220f, review-x-website-browser-suites c1711a05), so no main regression test was replaced by a weaker one.
- website/playwright.config.mjs: resolution kept the PR's `!process.env.VITEST` scratch guard on top of main's file.
- Generated Storybook inventory: merged blob e2fdd2a3a4fbb0cf6066f0434dd78ef8fcccf0a7 equals main's; approvals kept as main has them. `tests/__baseline__/known-fails.txt` unchanged and empty.

## Findings

No finding of medium or higher. Two low-severity notes:

1. Low — internal/docs/local-ci.md:261-263 (main) vs :264-267 (merged): the conflict resolution took the PR's macOS paragraph wholesale, dropping main's concrete pointer to `sysctl(KERN_PROCARGS2)` / `proc_pidinfo` as candidate native sources. `grep -rn "KERN_PROCARGS2\|proc_pidinfo"` over the merged tree returns nothing. The operational conclusion is preserved (still fail-closed, still awaiting "a validated native process-identity source") and main's 275-line `internal/docs/macos-browser-shard-cleanup.md` is retained and indexed in internal/docs/README.md:211, but it names only `KERN_PROC_PGRP`/`KERN_PROC_SESSION`, so the specific two APIs are lost from the repo. Documentation-only; macOS is out of scope; no behaviour, test or security impact.
2. Informational, pre-existing on origin/main and not caused by this PR: `tests/unit/review-a-contrib-docs.test.js` "indexes every top-level internal Markdown document" fails because internal/docs/README.md does not index `zai-request-proof-provider-isolation-2034.md` (added by main commit 6cc98a05ef, #2731). The PR's diff touches only internal/docs/local-ci.md, tests/unit/website-browser-checkpoint-playwright.test.js and website/playwright.config.mjs, so it neither causes nor fixes this. Since known-fails.txt is empty, the repo's full gate fails on main too.

## Commands (all exit codes as returned)

Each command ran in a detached worktree at b7b31f1cda with symlinked node_modules, a fresh private HOME/DATA_DIR/TMPDIR/XDG_CACHE_HOME under /var/tmp, `env -i PATH="$PATH"` and `timeout -k 5s 295s`. No pnpm/npm/corepack install, no live providers, no browser/e2e/full-inventory run. ~/.9router was never read or written.

- `git fetch origin` + `git fetch origin pull/2683/head`: exit 0.
- `git worktree add --detach /var/tmp/dd-review-2683 origin/pr-2683`: exit 0; node_modules/tests/website/cli symlinks created; both review worktrees removed and symlinks unlinked afterwards.
- `git show --remerge-diff b7b31f1cda`: exit 0; 4 conflicted files, resolution inspected hunk by hunk.
- `git diff c0ab5d52df b7b31f1cda --stat`: exit 0; 3 files, 38 insertions, 23 deletions; no src/ changes.
- `git diff --check c0ab5d52df b7b31f1cda`: exit 0; no whitespace errors.
- `git merge-base origin/main b7b31f1cda`: exit 0; c0ab5d52df1a4c9f8cf2bfa26c16cbe0ac845492.
- `node --check` on website/playwright.config.mjs, scripts/local-ci.mjs, scripts/lib/website-shard-server.mjs: exit 0 for all three.
- `node node_modules/eslint/bin/eslint.js website/playwright.config.mjs scripts/local-ci.mjs scripts/lib/website-shard-server.mjs tests/unit/website-browser-checkpoint-playwright.test.js`: exit 0; 0 errors.
- `vitest run unit/website-browser-checkpoint-playwright.test.js unit/browser-shard-cleanup-procfs.test.js unit/browser-shard-cleanup-darwin.test.js unit/browser-shard-cleanup-review.test.js unit/review-x-website-browser-suites.test.js`: exit 0; 5 files, 51 passed, 0 failed (no exclusions needed at this head).
- `vitest run unit/local-ci.test.js unit/local-ci-parity.test.js unit/local-ci-reporters.test.js unit/local-ci-website-browser-shards.test.js unit/browser-shard-cleanup-unrelated-2715.test.js unit/website-transient-playwright-server.test.js unit/review-x-website-mock.test.js`: exit 0; 7 files, 54 passed, 0 failed.
- `vitest run unit/1300-v5-storybook-inventory.test.js unit/storybook-inventory-sync.test.js unit/related-browser-discovery.test.js`: exit 0; 3 files, 58 passed, 0 failed.
- `vitest run unit/review-a-contrib-docs.test.js`: exit 1; 1 file, 1 failed, 4 passed — the pre-existing main failure described in finding 2, reproduced identically in a detached origin/main worktree (exit 1, 1 failed, 4 passed).
- Scratch-leak probe: `vitest run unit/review-x-website-browser-suites.test.js` at the merged head, counting /tmp/dd-pw-* before/after: 34 → 34 (delta 0). The same command at origin/main: 34 → 35 (delta 1). The PR's `!process.env.VITEST` guard removes a real one-directory-per-run leak that main still has.
- `git worktree remove --force` for both review worktrees: exit 0; no /tmp/dd-pw-* directories newer than the session start (no leak from the review runs).

Not run (out of scope for this review): the full reduced merge gate, the real-Chromium website browser suite, native macOS and service-leak integration behaviour. A full exact-head local CI run with real Chromium remains required before merge, and the documented residual PID-reuse window and scratch directories after abrupt termination are unchanged.
