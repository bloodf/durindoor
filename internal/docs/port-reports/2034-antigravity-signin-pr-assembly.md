# Antigravity sign-in and signature private assembly (#2034)

Status: blocked during plain cherry-pick. This is an unpublished partial checkpoint, with an active conflicted signature patch. No complete candidate or independence verdict is asserted.

## Frozen inputs and checkpoint

- Fetched base: `dc624113dc5728c04a01c1dd49e37f9a1dd80c4b`; tree `b72c25f3ab7cc7eba224e398fe039d8680061326`.
- Private branch: `auth/2034-antigravity-signin-20261128T014140Z`.
- Worktree/evidence run: `/var/tmp/agy-2034-20261128T014140Z`.
- Checkpoint head: `886df9aa50e47cf64e4ef7d9eacb3f049ba39326`.
- Checkpoint tree: `7f70e433377e47828886f93ed853af8375ec50f8`.
- Source freeze: `2026-11-27T23:49:25.752045Z`. No subsequent source adoption.
- Sign-in endpoint: `orq/tp47m5/signin-flow-antigravity-a1` at `5aae9773fbbd1405e3f2fb61dc0313493559b988`.
- Other frozen endpoints: onboarding `0b9d7f49754553d19308fc4645c702a2882cd9a0`, scope `a269ea10663b51b0417a6430b74ac5da23056f6e`, isolation finale `e67f61331e0bb8642529eed89c7c97c4abe1bb4e`.

The first three units each have one feature commit above their integration merge parent. The isolation unit has four successive feature commits (initial isolation, test rename, scoped Claude replay correction, locked-adapter persistence correction). Integration merge parents and their unrelated history were inspected and excluded.

## Source accounting

| Source | Stable patch ID | Disposition / candidate |
| --- | --- | --- |
| `5aae9773fbbd1405e3f2fb61dc0313493559b988` | `185a2e4fb448cf9ea9aff761d764c3577c59ca08` | picked `eccea984b7be549614ad31a737df5bb45a371f32` |
| `0b9d7f49754553d19308fc4645c702a2882cd9a0` | `ea15a4b1e1abd5e65b1342bacb5708f5c32f93a6` | picked `886df9aa50e47cf64e4ef7d9eacb3f049ba39326` |
| `a269ea10663b51b0417a6430b74ac5da23056f6e` | `4ee0924261b46a27550973a39c7b8938cbe403ff` | blocked-conflict |
| `fcebdf03a5d3dad47947f7770910c6261ae42a3a` | `df16ed24ebdbd4523bfe8a4c9be8f27f87e21260` | needed-unattempted-after-blocker |
| `956eb188d826ce31db887a8470866a1e65b58df7` | `91384057b4b395d0906dc4684d4a20ed59613257` | needed-unattempted-after-blocker |
| `22c352f6acdf2b21435a4eba8ebe76973d0b1ef6` | `ae724d247655638038254bb8cd48d72dfe2f9791` | needed-unattempted-after-blocker |
| `e67f61331e0bb8642529eed89c7c97c4abe1bb4e` | `66f00e9c1638043d5bc81cdee7a296c940eceb13` | needed-unattempted-after-blocker |

All seven patches are needed for the requested integrated result. The first two applied without product resolutions; their candidate patch IDs equal their source patch IDs. None is claimed present merely because a branch is an ancestor. `source-accounting.json` records every changed path with immutable source-parent, source and fetched-base blob IDs (including ABSENT), source patch SHA256 and candidate patch IDs. Original binary patches and raw commit metadata are retained.

## Exact blocker and minimal dependency

`a269ea10663b51b0417a6430b74ac5da23056f6e` conflicts in `open-sse/executors/antigravity.js`: the source wraps `normalizeFilteredContents(groupGeminiFunctionResponses(...))` and retains normalization of `function_call`, `function_response`, and `thought_signature`; fetched main maps the contents directly. Choosing the source side would reference an absent helper/import and silently adopt excluded behavior. Choosing the main side would require a new adaptation. Neither resolution was made.

The minimal prerequisite surface is the grouping helper in `open-sse/translator/formats/gemini.js`, its executor import and grouping call from `4b1737339975876d3b9c01cf5b41d13da14a4749`, plus the executor wire-field normalization from `69fdd78e537a0a666bc30ca2af98a7a4c58b1412`. These commits also contain other replay/error behavior and protected test suites; their whole histories are not automatically required or authorized. Their exact patches are archived for the parent to decide a separately reviewed dependency boundary. No prerequisite patch was applied. This identifies the first blocker, not proof that no subsequent blockers exist.

The remaining four isolation feature commits were inspected and retained as evidence but not attempted after this blocker. Earlier tests and all later corrections remain mandatory inputs; no tests, baseline, skips or expectations were weakened.

## Changes, resolutions and evidence

- No product resolution was authored. The initial commit attempt could not discover the committer identity in the private HOME; continuation used the existing repository committer identity via process environment only. Hooks were disabled for mechanical cherry-picks; validation is recorded separately.
- The native branch changes only this report. No push, PR, merge, main mutation, schema or secret rewrite occurred.
- Checkpoint changed files:

  - `internal/docs/port-reports/provider-signin-antigravity-parity.md`
  - `src/lib/oauth/services/antigravity.js`
  - `tests/unit/antigravity-cli-onboarding-wire.test.js`
  - `tests/unit/port9r-141-antigravity-onboarding-mode.test.js`
  - `tests/unit/provider-signin-antigravity-parity.test.js`

Checkpoint binary diff SHA256: `0b8fd55f346c59ded9577dd1b78f595a4a8424dcac8936b8bd98ab89b380c39f`.

The live index also contains the partial scope patch: its report, executor, Vertex executor, both nonstream handlers, signature store, trailing-model-turn helper, Gemini response translator and scope test. `conflict-index`, `conflict-staged`, `conflict-diff`, `conflict-antigravity.js` and `live-files` preserve its exact stages and content; it has no single resolved tree ID.

Port attribution remains in the original source commits and reports: MIT CLIProxyAPI `dbe641f286a489ecb39e3c041c554371e6add864`, sign-in files `sdk/auth/antigravity.go` and `internal/auth/antigravity/auth.go`; MIT OmniRoute `35e01594ad13a7ffc0cd44d6598f6d862dfcff9f`, signature executor/SSE collection/request translator files; MIT 9router `829f2a88ea2069d2455ef0004bf29e70e793b3c8`, Antigravity executor. Prerequisite attribution is retained in its raw commit metadata and patches, including MIT CLIProxyAPI `13e06420967b8d1762c7422d689583a1d3b6c6a0`.

## Validation and limits

Root and tests dependencies were installed with frozen lockfiles into this worktree only, with private store/cache and a credential-free environment (allowlisted PATH, private HOME/DATA_DIR/TMPDIR/cache, Git read controls). Each command had a 300-second timeout. CLI installation was not needed for this explicit inventory. These are staged partial-state results, not clean-checkpoint results.

- Root lint: exit 1. ESLint completed with 0 errors / 349 warnings; anti-slop rejected the preserved executor conflict markers. Root lint internally bundles its anti-slop plugin; no application build command ran.
- Scoped tests: exit 1, 12 explicit test files. JSON recorded 45 passed assertions, 0 failed assertions, 53 pending/unrun assertions, and 5 file-level parse failures due to the unresolved executor. Vitest reports 35 nested suites (30 passed / 5 failed); this is not 35 test files.
- The isolation completion suite is absent from the checkpoint because its four source commits have not been applied; it was not represented as collected or passing.

Exact scoped commands (run from the indicated working directory):

`/var/tmp/agy-2034-20261128T014140Z/candidate`

```text
timeout 300 pnpm run lint
```

`/var/tmp/agy-2034-20261128T014140Z/candidate/tests`

```text
timeout 300 node node_modules/vitest/vitest.mjs run unit/provider-signin-antigravity-parity.test.js unit/antigravity-cli-onboarding-wire.test.js unit/port9r-141-antigravity-onboarding-mode.test.js unit/antigravity-oauth-client.test.js unit/antigravity-oauth-cancellation.test.js unit/antigravity-default-oauth-profile.test.js unit/antigravity-signature-scope-21439-3366.test.js unit/antigravity-thought-signature-family.test.js unit/antigravity-gemini-native-response.test.js unit/gemini-native-endpoint.test.js unit/omni-antigravity-claude-wire-shape.test.js unit/claude-reasoning-response.test.js --maxWorkers=2 --reporter=json --outputFile=/var/tmp/agy-2034-20261128T014140Z/logs/scoped.json
```

Evidence archive: `/home/stormtrooper/checkpoint-evidence/agy-2034-20261128T014140Z`. `SHA256SUMS` covers raw logs, source patches and blob accounting; the copy is verified against those hashes. The native report gate below checks bookkeeping only.

`tests/__baseline__` has no checkpoint or live diff. Docs included by applied commits are the sign-in parity report and its tier correction; scope documentation is staged only; isolation completion documentation remains unapplied. No full CI, build, browser, real-account tests, Docker or publication ran. A parent-run clean-main full checkpoint and cross-family reviews remain required.

The active conflicted worktree and local branch/objects are retained. This is not a completed candidate check, so worktree/dependency cleanup is deferred. Raw logs and checksums are copied to the checkpoint evidence archive and verified; provenance is private and excluded from this committed report.

Native REPORT bookkeeping gate: passed (sole authorized report path, seven source rows, matching applied patch IDs, unchanged baseline and whitespace check). It does not validate product behavior.
