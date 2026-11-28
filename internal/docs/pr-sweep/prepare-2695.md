Verdict: READY

# PR #2695 merge preparation

- PR: #2695 `fix(storybook): reconcile Firefly review story inventory`, branch `fix/firefly-story-inventory-2694`
- Old head: `7ed2d35ff3ce00ff729df635fd360275dd1ca597`
- New `sweep/2695` head: `c862b331c653458a2c4a03e24f000688818efb87` (existing merge; no extra commits needed)
- origin/main used: `c0ab5d52df1a4c9f8cf2bfa26c16cbe0ac845492` (unchanged after the final fetch)
- Net diff against main: only `internal/docs/v5-interface-integration-1300.md` (+2 lines)

## Conflicts

One, in `tests/e2e/storybook-surfaces.json` (`inventoryReconciliation`): census hash, pending and retained-approved counts.
The merge took main's side (464 pending, 196 retained approved; the old PR head had 452 and 197).
`src/` and `storybook-surfaces.json` are identical to main, so main's approvals are preserved exactly.
This run re-ran the generator, Storybook build, sync write and check on the merged head; the tree stayed clean.
So the Firefly stories and inventory match the generator (#2694).

## Commands in this run (on `c862b331c6`)

Test, build and script runs used `env -i`, fresh private HOME/DATA_DIR/TMPDIR/XDG_CACHE_HOME/CACHE_DIR and `timeout -k 5s 295s`.
The three node_modules paths were symlinks to the main checkout; nothing was installed.

| Command | Exit | Result |
| --- | --- | --- |
| `git fetch origin` (start and end) | 0 | refs unchanged between them |
| `git worktree add <tmp> sweep/2695` | 0 | side worktree created |
| `node scripts/gen-v5-stories.mjs` | 0 | 206 surfaces, 1218 scenarios; no diff |
| `node_modules/.bin/storybook build` (shell shim, run directly) | 0 | build passed |
| `node scripts/sync-storybook-inventory.mjs --write` | 0 | 196 approved retained, 464 pending rows, 1498 pending references; no diff |
| `node scripts/sync-storybook-inventory.mjs --check` | 0 | passed |
| `node scripts/check-storybook-coverage.mjs --manifest tests/e2e/storybook-surfaces.json --index storybook-static/index.json --mode inventory` | 0 | inventory valid; no coverage claimed |
| `node scripts/check-docs.mjs` | 0 | passed |
| `node scripts/check-agent-index.mjs` | 0 | up to date |
| `node scripts/gen-registry-index.mjs --check` | 0 | up to date |
| `node scripts/gen-provider-catalog.mjs --check` | 0 | up to date |
| `cd tests && node node_modules/vitest/vitest.mjs related --run ../internal/docs/v5-interface-integration-1300.md --maxWorkers=2` | 0 | no related tests (Markdown-only diff; not a failure per work order) |
| `cd tests && node node_modules/vitest/vitest.mjs run unit/1300-v5-storybook-inventory.test.js unit/storybook-inventory-sync.test.js unit/v5-int-05-provider-stories.test.js --maxWorkers=2` | 0 | 3 files; 31 passed, 0 failed |
| `node node_modules/@commitlint/cli/cli.js --from=origin/main --to=HEAD` | 1 | MODULE_NOT_FOUND: commitlint not installed; range not machine-verified |
| `git diff --check origin/main...HEAD` | 0 | clean |
| `git merge-base --is-ancestor origin/fix/firefly-story-inventory-2694 sweep/2695` | 0 | fast-forward |
| `git merge-base --is-ancestor origin/main sweep/2695` | 0 | contains main |
| `git diff --quiet origin/main sweep/2695 -- tests/e2e/storybook-surfaces.json src` | 0 | identical to main |
| `git worktree remove <tmp>/tree` (after removing the three symlinks) | 0 | branch kept |

Also read-only: `gh pr view 2695` (exit status masked by a pipe; returned head `7ed2d35ff3`, state OPEN).

ESLint on changed src files: not applicable, none differ from main.
Not run here: root lint, typecheck, app and CLI builds (outside this order's step 4). The merge gate still needs them, plus commitlint for range and PR title.

## Findings

- Info, `internal/docs/v5-interface-integration-1300.md:13`: the PR's generated changes are already on main, so only this note remains.
  `git log -S'FireflyBrowserPanel' origin/main -- src/shared/ui/v5/review-manifest.js tests/e2e/storybook-surfaces.json` lists #2682 and #2688.
- Info, PR body: its base, head, approval counts and "adds wrapper/manifest/two references" text predate this merge.
  Reproduce: `git diff --stat origin/main...sweep/2695`.
- Gate gap: commitlint is unverified (command and exit above). By inspection, `7ed2d35ff3` uses type `fix` with a short subject; the other commit is a Git merge commit.
