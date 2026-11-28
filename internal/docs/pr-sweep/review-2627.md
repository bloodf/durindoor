Verdict: CHANGES

PR: https://github.com/bloodf/durindoor/pull/2627 — "fix: resolve upstream port review findings" (draft, base `main`)
Head: `dac6def1d98bba811a217f41f4f570032fecfcc5` (merge of main `c0ab5d52df` into approved head `b86d30e7acf53e1866486fc0d88ebfd705717c5e`; 9 conflicts)
Merge-base with origin/main: `c0ab5d52df1a4c9f8cf2bfa26c16cbe0ac845492`
PR delta vs merge-base: 14 files, +574 / -32 (the merge-base is the head's second parent, so this is the part not yet on main)

## Commands
Detached worktree at the head; private HOME/DATA_DIR/TMPDIR/XDG_CACHE_HOME under /var/tmp; `env -i PATH="$PATH"`; `timeout -k 5s 295s`.

- `git fetch origin --prune` → exit 0; `git show --remerge-diff dac6def1d9` → exit 0 (9 conflict files); `git diff --stat c0ab5d52df dac6def1d9` → exit 0 (14 files)
- Storybook inventory source-hash check (node, 6105 sha256 digests) → exit 0; 0 mismatched, 0 missing
- Storybook inventory approval diff head vs main (node) → exit 0; 660→661 rows, 0 dropped, 0 approvals changed, 1 pending row added
- `node scripts/check-docs.mjs` → exit 0 (head); exit 0 (main `c0ab5d52df`)
- vitest focused (5 PR test files + 3 related) → exit 0; 8 files, 66 tests passed
- vitest related sweep (13 files) → exit 0; 69 tests passed; vitest issue-mapped sweep (15 files, issues 2609/2613/2615/2620/2693/3860/3863/21275/2712) → exit 0; 101 tests passed
- vitest `unit/website-verify-docker-mounts.test.js` → exit 0; 1 file, 3 tests passed; eslint on the 4 changed source files → exit 0; 0 errors, 8 warnings
- playwright config probe (node, loads the real config) → exit 0 at head, main and PR branch; see finding 1

## Findings

### 1. Medium — Playwright output dir lands in the scratch dir that the config deletes on exit
`website/playwright.config.mjs:68` (`outputDir: join(tmpdir(), "omc-docs", ...)`) is evaluated *after* main's scratch override at `website/playwright.config.mjs:33-37` (`process.env.TMPDIR = mkdtempSync("/tmp/dd-pw-")`, removed on exit by `rmSync(scratch, {recursive:true, force:true})`). The merge combined main's scratch isolation with the PR's `tmpdir()` output dir, so neither side's behaviour survives: main `c0ab5d52df` → `/tmp/omc-docs/playwright-docs-results-<port>` (persists; this is what `website/scripts/verify-docker.sh:52` mounts via `-v "$run_root/test-results:/tmp/omc-docs"`); PR branch alone `b86d30e7a` → `$TMPDIR/omc-docs/playwright-docs-results-<port>` (honours the caller's TMPDIR); head `dac6def1d9` → `/tmp/dd-pw-<random>/omc-docs/playwright-docs-results-<port>`, inside the ephemeral scratch.
Impact: Playwright failure artifacts (traces, videos) are deleted when the run ends and the docker verification mount captures nothing, so `website/scripts/verify-docker.sh` reports success with an empty `test-results` dir. This contradicts main's own comment ("Keep browser scratch private and short, independently of reports").
Repro (exit 0): `cd website && env -i PATH="$PATH" HOME=… TMPDIR=… node -e 'const m=await import("./playwright.config.mjs");console.log(m.default.outputDir)'` → head `/tmp/dd-pw-yW7yxs/omc-docs/playwright-docs-results-42951`, main `/tmp/omc-docs/playwright-docs-results-44361`. Writing a file into the resolved `outputDir` and letting the process exit: at head the file is gone (`/tmp/dd-pw-*/omc-docs` no longer exists), at main it survives.
Fix: capture the report root before the scratch override (`const reportsRoot = join(tmpdir(), "omc-docs")` above line 33) and use it for `outputDir`, or keep main's hardcoded `/tmp/omc-docs`.

### 2. Low — duplicate `## OpenAI batch input limits` section (already tracked, not gating)
`docs/reference/environment.mdx:158` (main's copy, with the `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` paragraph) and `docs/reference/environment.mdx:361` (the PR's stale copy, without it) — the same `##` heading twice on a page the website publishes (`website/source.config.mjs` compiles `../docs/**/*.mdx`), so it renders two anchors. Not a merge conflict: the copies sit in different places, so the merge added the duplicate silently.
Repro: `grep -c "^## OpenAI batch input limits" docs/reference/environment.mdx` → 2 at head, 1 at main. Tracked by #2691 with fix PR #2692 open; `node scripts/check-docs.mjs` passes at head and main, so no gate fails.

## Merge resolutions (9 conflicts) and PR delta
- `open-sse/utils/stream.js` — main's code plus the PR's 2 comment lines; no logic change.
- `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx` — identical to main; the PR's generation-guard fix and the #2620 disable reset (`tunnelMissRef.current = 0; setTunnelReachable(false)`) are both present.
- `src/app/(dashboard)/dashboard/providers/[id]/hooks/useProviderDetail.js` and `.../ModelsCard.js` — identical to the PR branch, which builds on main's `src/shared/utils/modelTestResults.js`; main's inline error state is replaced by `useModelProbeErrors.js`, and `modelsTestError` / `testError` still render. No main-only behaviour lost (full main→head file diff checked).
- `tests/unit/port-omniroute-21275-abort-chain.test.js` — true union: main's `it.each` list (incl. `src/app/api/v1beta/models/[...path]/route.js`) plus the PR's `imageEdit.js` bounded-reader pin.
- `tests/unit/port9r-3860-anthropic-incomplete-terminal.test.js`, `tests/unit/endpoint-stale-probe-2627.test.js` — identical to the PR branch, which is main plus the new cases ("complete tool JSON requires a success terminal", "does not start an old Tailscale probe after a delayed Cloudflare probe completes"). No assertion dropped.
- `tests/e2e/storybook-surfaces.json` — regenerated: all 6105 source hashes match the files at head, 0 approvals dropped or changed vs main, 1 new pending row with `approvedClassification: null`.
- `website/playwright.config.mjs` — main's `reserveLoopbackPort` / `forbidOnly` / scratch block kept, PR's `tmpdir()` output dir added → finding 1. `tests/__baseline__/known-fails.txt` unchanged and empty (0 bytes).

## Issue closures checked
#2615 margin is applied once on all four client routes (`tests/unit/cursor-margin-routes-2615.test.js`, 9 tests pass) and the executor estimate stays raw (`open-sse/executors/cursor.js:47`). #2620 has real polling coverage (`tests/unit/endpoint-probe-polling-2620.test.js`, passes) plus `endpoint-probe-order-2712` and the new #2627 stale probe test. #2609, #2613 and #2693 (probe-error context retirement) are covered by the passing suites above; the #2615, #2620 and #2693 items left open by the earlier `969809bad` review are now addressed on main. No live provider, credential, browser or e2e suite was used; `~/.9router` was never read or written.
