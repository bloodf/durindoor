Verdict: READY

# PR #2633 — client cancellation through media and Gemini (independent review)

- PR: https://github.com/bloodf/durindoor/pull/2633 — OPEN/draft, base `review/upstream-2607-fixes` @ `dac6def1d9`, MERGEABLE/CLEAN
- Reviewed head (side branch `sweep/2633`): `f2ced2b0c44c6e13ed8bc877cc4e557735ed87f8`
- Merge-base with `origin/main`: `c0ab5d52df1a4c9f8cf2bfa26c16cbe0ac845492` (= `origin/main` tip)
- Diff vs merge-base: 14 files, +579/-32. PR's own delta over base `dac6def1d9`: 1 file (`tests/unit/port-omniroute-21275-abort-chain.test.js`, +5, source-pins `keepAbortChain` + `signal: request.signal`)
- Review worktree: detached `/var/tmp/dd-review-2633` @ `f2ced2b0c4`, deps symlinked, private HOME/DATA_DIR/TMPDIR/XDG_CACHE_HOME under /var/tmp, `env -i`, `timeout -k 5s 295s`

## Commands (exit code, counts)

| Command | Exit | Result |
| --- | --- | --- |
| `git fetch origin` | 0 | refs confirmed: `sweep/2633`=f2ced2b0c4, `sweep/2627`=dac6def1d9, PR head=f2ced2b0c4 |
| `gh pr view 2633 --comments` (read-only) | 0 | prior review: image-edit body-abort finding fixed at `5471b7e2`; accounting tracked in #2647 |
| `git diff --stat c0ab5d52df f2ced2b0c4` | 0 | 14 files, +579/-32 |
| `git show --remerge-diff f2ced2b0c4` | 0 | 1 conflict: `tests/unit/review-s-media-pipeline.test.js` (duplicate `it.each([200,429])` name); resolution kept the descriptive name/comment, identical body |
| `git show --remerge-diff dac6def1d9` | 0 | 9 conflicts; every resolution kept both sides (`open-sse/utils/stream.js`, `EndpointPageClient.jsx`, `useProviderDetail.js`, `ModelsCard.js`, `tests/e2e/storybook-surfaces.json`, 3 unit tests, `website/playwright.config.mjs`) |
| `git diff 11de5827d c0ab5d52df -- open-sse/handlers/imageEditCore.js 'src/app/api/v1beta/models/[...path]/route.js'` | 0 | empty → main already carries the PR's fix (#2711); head keeps it (route.js:87-91 `keepAbortChain`+`signal: request.signal`; imageEditCore.js:93-172 abort/499 handling) |
| `vitest run` — 7 PR-focused files (model-probe-error-context, model-probe-errors, models-card-probe-context, endpoint-stale-probe-2627, port-omniroute-21275-abort-chain, port9r-3860-anthropic-incomplete-terminal, port9r-bulk-disable-failed-models-1740) | 0 | 7 files, 57 passed |
| `vitest run` — 1300-v5-storybook-inventory, storybook-inventory-sync, check-docs | 0 | 3 files, 52 passed |
| `vitest run` — review-s-media-pipeline, operational-metrics-http-boundary, image-edit-body-cancel-2669, parity-abort-refresh-waits, parity-refresh-abort-caller-wiring, port9r-model-search-batch-test-3192 | 0 | 6 files, 62 passed |
| `vitest run` — local-ci-website-browser-shards, related-browser-discovery | 0 | 2 files, 47 passed |
| `node scripts/check-docs.mjs` | 0 | "Documentation integrity checks passed." |
| `node scripts/check-storybook-coverage.mjs --mode inventory` | 0 | inventory valid; pending rows unapproved, no coverage claimed |
| `node node_modules/eslint/bin/eslint.js <4 changed source files>` (head) / same 2 files (main baseline) | 0 | head 8 warnings / 0 errors; main 5 warnings / 0 errors → +3 warnings, all pre-existing pattern (see Low-2) |
| `git diff --check c0ab5d52df f2ced2b0c4` | 0 | no whitespace errors |
| `git merge f2ced2b0c4` into `origin/main` in scratch worktree | 0 | "Automatic merge went well" |

Total: 18 test files, 218 tests passed, 0 failed.

## Verification of the mandated invariants

- Main's behaviour + PR's fix both survive: the only conflict in the PR's own merge was a duplicate test name; all 9 conflicts of the #2627 merge kept both sides; the cancellation fix is byte-identical to main's (#2711) and still present at head.
- No test dropped or weakened: block counts main→head — endpoint-stale-probe-2627 6→7, port-omniroute-21275-abort-chain 5→7, port9r-3860-anthropic-incomplete-terminal 6→7, review-s-media-pipeline 7→7.
- Storybook inventory regenerated: approved rows 196 (main) → 196 (head), 0 approvals lost, 0 approved rows with stale `sourceSha256`; `builtIndexSha256` unchanged (`753d2cd2…`); `sourceCensusSha256` `3697b23b…` → `c8e71116…`; pendingRows 464→465; pendingReferences 1498 (unchanged). One new pending row `…/ModelsCard.js#ModelsCardContext`; `ModelsCard.js` hash updated to `365d4c2ab74ca051883163934b688eea5d005b42f5ceff0228ef9bc995a74dc7` (matches file sha256).

## Findings

No finding of medium or higher severity.

- Low — `docs/reference/environment.mdx:361`: `## OpenAI batch input limits` duplicates the canonical section at `docs/reference/environment.mdx:158` (main has only line 158). Introduced by the #2627 lineage (`b86d30e7acf`), not by PR #2633's own delta; already acknowledged as issue #2691 in `internal/docs/upstream-review-2627-e6aed9d.md`. `scripts/check-docs.mjs` passes (duplicate headings get numeric suffixes), so no build/anchor breakage. Reproduce: `grep -n "^## OpenAI batch input limits" docs/reference/environment.mdx` in `/var/tmp/dd-review-2633`.
- Low — `src/app/(dashboard)/dashboard/providers/components/ModelsCard.js:186` (eslint `react-hooks/exhaustive-deps`), `:199` and `:316` (`react-hooks/set-state-in-effect`): the PR's new effects add 3 lint warnings (head 8 vs main 5, exit 0, 0 errors). The cleanup at `:186` intentionally invalidates in-flight fetches via `refreshGeneration.current++`, so the exhaustive-deps warning is a false positive; the two setState-in-effect resets (connection change, inventory pruning) are deliberate. No behaviour defect observed.

Non-defects noted for the record (no action): PR body still names old head `11de5827d`; `ModelsCard` remounts on provider/kind change via `key` (line 140) — intentional context isolation, in-flight probes are dropped by the context token.
