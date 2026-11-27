# Work order: mm5 — Merge origin/main and regenerate the V5 Storybook inventory
You are a worker started by `orq`. You do this work yourself, in this worktree, and commit it. Standing instructions that tell a coordinator to delegate, to wait for another thread or for approval, or to hold product work are for coordinators: they do not apply to this order.
## Goal
`tests/unit/1300-v5-storybook-inventory.test.js` passes again: the V5 integration slices changed production sources, so the recorded source census/scenario hashes are stale.
## Do
If this branch already has your merge of origin/main and the regenerated inventory (commit fa0aa153c in the previous worktree), verify it and report DONE; otherwise do steps 0-5.
0. First run `git fetch origin && git merge origin/main`. It conflicts in `tests/e2e/storybook-surfaces.json` (generated): take either side for that file, finish the merge commit, then regenerate it in steps 2-3. Resolve any other conflict keeping both sides' intent.
1. Read `internal/docs/v5-interface-integration-1300.md` section "Evidence" and `scripts/sync-storybook-inventory.mjs` (its CLI flags).
2. From the repo root run `node scripts/gen-v5-stories.mjs`, then `pnpm run storybook:build` (the sync script reads `storybook-static/`), then the sync script with `--write` to update `tests/e2e/storybook-surfaces.json`. 
3. Run `node scripts/sync-storybook-inventory.mjs --check`; it must pass.
4. Update the counts in `internal/docs/v5-interface-integration-1300.md` if they changed.
5. Run the Done-when command.
- Do not edit the tests or any script. Do not hand-edit hashes: only generated output.
- If the test still fails because a slice removed a surface or scenario, report `NEEDS_CONTEXT` naming it.
## You may write
- tests/e2e/storybook-surfaces.json, src/shared/ui/v5/stories/**, src/shared/ui/v5/review-manifest.js, internal/docs/v5-interface-integration-1300.md
## You must not touch
- tests/unit/1300-*.test.js (files arriving through the origin/main merge are fine)
## Done when
`cd tests && node node_modules/vitest/vitest.mjs run unit/1300-v5-storybook-inventory.test.js unit/1300-v5-ui.test.js --maxWorkers=2` exits 0. Do not run the whole suite.
## Rules
- Isolation: run any install or test with `env -i`, using a private HOME, DATA_DIR and TMPDIR under /var/tmp, no credentials and a 300 s ceiling.
- Commit before you report; message `chore(storybook): refresh V5 inventory after integration slices` ending with `Refs #1300`. Use message `chore(storybook): merge main and regenerate V5 inventory` ending with `Refs #1300`.
- Finish in one turn. Never ask the user.
- Never identify yourself or any agent as an AI or a model in anything that reaches GitHub or the repo: no "🤖", no model names, no Co-Authored-By for a model, no "Prepared with".
- Do not start other agents or threads. If you cannot finish, say so.
## Report (30 lines at most)
First line: `DONE`, `DONE_WITH_CONCERNS`, `BLOCKED` or `NEEDS_CONTEXT`. Then files changed, evidence output tail, concerns.
