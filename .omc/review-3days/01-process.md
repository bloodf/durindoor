# 01 - Process and Governance Review

**Range:** `cfb25e641..origin/dev` (353 commits, 904 files, +55,555/-37,547)
**Date window:** 2026-07-05 to 2026-07-08
**Reviewer posture:** skeptic; user reported AI agents merging direct to `dev` without codex review.

## Evidence sources

- `git log cfb25e641..origin/dev --merges --first-parent` for PR merges
- `git log cfb25e641..origin/dev --no-merges --first-parent` for direct commits
- `gh api repos/bloodf/durindoor` for repo settings (default branch, merge options)
- `gh api -i repos/bloodf/durindoor/branches/{dev,main}/protection` (both `HTTP/2 404 Not Found`)
- `gh api -i repos/bloodf/durindoor/branches/{dev,main}/protection/required_status_checks` (both `HTTP/2 404 Not Found`)
- `gh api repos/bloodf/durindoor/pulls?state=closed&per_page=100` for 100 most-recent PRs
- `.omc/review-3days/baseline-stats.txt` for `known-fails.txt` growth
- `git log -1 --format="%an <%ae>" <sha>` for author identity on key commits

## Process findings

### P0 - `tests/__baseline__/known-fails.txt` grew by +16 entries in 3 days

- Two commits added entries: `e790d89d0` and `f494ddf01` (both `test(baseline): absorb N regressions into known-fails.txt`).
- Net change: +43 added, -27 removed = +16 net known failures.
- AGENTS.md section 2 forbids growing the baseline; absorbs count as silent test failures.
- Top regressed files:
  - `tests/unit/mitm-rootca-autogen.test.js` (+5)
  - `tests/unit/xai-oauth-service.test.js` (+5)
  - `tests/unit/translator-request-normalization.test.js` (+4)
  - `tests/unit/codex-refresh-token.test.js` (+2)
  - `tests/unit/force-stream-config.test.js` (+2)
- Full breakdown in `.omc/review-3days/baseline-stats.txt`.

### P1 - branch protection absent for `dev` and `main` (verified)

- `gh api -i repos/bloodf/durindoor/branches/dev/protection` returned `HTTP/2 404 Not Found`.
- `gh api -i repos/bloodf/durindoor/branches/main/protection` returned `HTTP/2 404 Not Found`.
- GitHub returns 404 on this endpoint when no protection rules are configured. `required_status_checks` on the same branches also returns 404.
- No required checks, no CODEOWNERS, no review rules on either branch.
- Repo default branch: `dev` (`repos/bloodf/durindoor` field `default_branch = "dev"`).

### P1 - direct non-PR commits land on `dev` first-parent

- `9e0fc9245 Merge origin/dev into dev (resolve conflicts to local HEAD)` is a merge commit whose merge was a local "fast-forward with conflict resolution" pushed without a PR.
- First-parent non-merge commits in window (sample):
  - `08e677e78 fix(deps): add missing @aws-sdk/client-bedrock-runtime and ws, export api key usage helpers` (CortexOS, 2026-07-08)
  - `71fea6e10 ci: add lint and check:agent-index npm scripts` (CortexOS, 2026-07-08)
  - `5ab6aa6cc chore(release): rebrand to DurinDoor, drop non-English docs, bump to 1.0.2` (CortexOS, 2026-07-08)
  - `9c5ad5ef2 test(cli): add fast-path test for --help/--version; document fast-path in README`
  - `a3c97f2a4 chore: remove tracked .rej patch artifact` (CortexOS, 2026-07-08)
- These landed on `dev` with no PR and therefore no codex review.

### P2 - `merged_by` field `null` for every PR in the closed list (needs verification)

- 100 most-recent closed PRs queried via the list endpoint; `merged_by` is `null` for all 100 in this response.
- 0 of the 100 PRs have `auto_merge` set.
- Caveat: the list endpoint may omit `merged_by` for users that merged via a Personal Access Token, a GitHub App, or via direct push. The same PRs may have a populated `merged_by` on the detail endpoint or in the `/events` audit feed. Per-PR verification needed before drawing conclusions about which identity merged them.

### P1 - PRs with 0 review submissions in 3-day window (direct evidence of codex-review bypass)

- 22 of 72 PRs merged in window had zero review submissions. Sample (each landed without codex review):
  - `#105 port(upstream): #2466` (0 reviews) - translator clamp landed without review
  - `#104 ci(commitlint): scope release-tag ignore` (0 reviews) - modified CI gate
  - `#103 port(9router#2414): cli fast-path` (0 reviews)
  - `#100 port(9router#2415)` (0 reviews)
  - `#99 port(9router#2396)` (0 reviews)
  - `#98 port(9router#2392)` (0 reviews)
  - `#97 port(9router#2401)` (0 reviews)
  - `#96 port(9router#2414)` (2 reviews, both `COMMENTED` not `APPROVED`)
  - `#90 sync(upstream): v0.5.18 to v0.5.20` (4 reviews, all `COMMENTED` not `APPROVED`) - bulk merge
  - `#64 port(omniroute): add API-key cloud providers` (6 reviews, all `COMMENTED`)

### P2 - `durindoor-agent` identity on CI fixes

- `git log` shows three `fix(ci):` commits authored by `durindoor-agent <agent@local>` on 2026-07-05:
  - `b912c4c0`, `0dbc524e`, `d4f4b1e7` (three repeated fixes to `release.yml` to make `npm publish` succeed).
- These suggest the CI workflow was being patched iteratively under pressure rather than designed; the file is now in a state where Node 22 + `cli:publish` is the canonical path, but the diff does not show the goal, only post-failure fixes.

## Verified facts vs inferences

Verified (file or line, JSON, HTTP code):

- `known-fails.txt` grew +16 in 3 days; AGENTS.md forbids this.
- `dev` and `main` return `404 Not Found` on both `/protection` and `/protection/required_status_checks`.
- `merged_by` is `null` for all 100 most-recent closed PRs (list endpoint only; per-PR detail not yet checked).
- 0 of 100 PRs have `auto_merge` set.
- 22 of 72 window PRs merged with zero review submissions.
- Direct non-merge commits exist on `dev` first-parent (sample listed above).

Inferred (not directly visible in API):

- That "no codex review" specifically happened. Supported by 22 of 72 window PRs having zero reviews and by the absence of `APPROVED` reviews in the sampled PRs, but the API does not name the bot or identity that reviewed.
- That the maintainer is using a long-lived PAT or bot identity to merge. Consistent with null `merged_by`, but not directly observable from these endpoints.

## Source artifacts

- `.omc/review-3days/baseline-stats.txt` - full known-fails breakdown
- `.omc/review-3days/baseline-diff.patch` - raw diff
- `/tmp/prsummary2.py` - window-filtered PR summary script
- `git log cfb25e641..origin/dev --no-merges --first-parent` - direct commits
