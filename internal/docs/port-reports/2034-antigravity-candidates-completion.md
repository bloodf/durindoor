# Antigravity standalone candidate completion (#2034)

Status: both candidates passed the explicit scoped checks below on clean indexes. These are local candidate results only. The predecessor signature assembly remains blocked and is not qualified by this report. No merge authorization or independent review verdict is asserted.

## Frozen scope and dependency order

Source freeze: `2026-11-27T23:49:25.752045Z`. Common base: `dc624113dc5728c04a01c1dd49e37f9a1dd80c4b`. Base tree: `b72c25f3ab7cc7eba224e398fe039d8680061326`. No fetch or later source adoption occurred.

OAuth consists only of the two supplied sign-in/onboarding patches already present in checkpoint `886df9aa50e47cf64e4ef7d9eacb3f049ba39326`. The signature branch starts from that OAuth head, then applies the FULL `4b1737339975876d3b9c01cf5b41d13da14a4749` and `69fdd78e537a0a666bc30ca2af98a7a4c58b1412` prerequisites, followed by the scope patch and four isolation commits in the order below. Integration merges and unrelated feature history are excluded.

## Candidate identities

| Candidate | Local branch | Head | Tree | Dependency base | Binary diff SHA256 against common base |
| --- | --- | --- | --- | --- | --- |
| oauth | `auth/2034-antigravity-oauth-20261128-complete` | `886df9aa50e47cf64e4ef7d9eacb3f049ba39326` | `7f70e433377e47828886f93ed853af8375ec50f8` | `dc624113dc5728c04a01c1dd49e37f9a1dd80c4b` | `0b8fd55f346c59ded9577dd1b78f595a4a8424dcac8936b8bd98ab89b380c39f` |
| signatures | `auth/2034-antigravity-signatures-20261128-complete` | `5dc663bd0676a26f7a97cf29e3b5f460c96f7fbd` | `60f10ac62c45e0edf202caf59cd1d4dfd8d09f76` | `886df9aa50e47cf64e4ef7d9eacb3f049ba39326` | `a30142541ec62deacb71bf0b2862584d89c2ffef38d9a434ed9b4003ed18324e` |

## Ordered commit map and stable patch IDs

| Source | Candidate | Source stable patch ID | Candidate stable patch ID |
| --- | --- | --- | --- |
| `5aae9773fbbd1405e3f2fb61dc0313493559b988` | `eccea984b7be549614ad31a737df5bb45a371f32` | `185a2e4fb448cf9ea9aff761d764c3577c59ca08` | `185a2e4fb448cf9ea9aff761d764c3577c59ca08` |
| `0b9d7f49754553d19308fc4645c702a2882cd9a0` | `886df9aa50e47cf64e4ef7d9eacb3f049ba39326` | `ea15a4b1e1abd5e65b1342bacb5708f5c32f93a6` | `ea15a4b1e1abd5e65b1342bacb5708f5c32f93a6` |
| `4b1737339975876d3b9c01cf5b41d13da14a4749` | `7ef1747d39da3d097991a4edf22faaa55a4cb478` | `cf237620f179df6b23cb1c1f253f3852d842d2ac` | `d891b3cdc4d0c3e9d210432076e3076799bc8e19` |
| `69fdd78e537a0a666bc30ca2af98a7a4c58b1412` | `9a4bb49958acde01ba8ba14f766662f13e6f38a4` | `9e940fb52de0a35a2cc16e24833410302c5f9f1c` | `9e940fb52de0a35a2cc16e24833410302c5f9f1c` |
| `a269ea10663b51b0417a6430b74ac5da23056f6e` | `ccce6240a2ed49abb6e5e4473ceecf2af9433450` | `4ee0924261b46a27550973a39c7b8938cbe403ff` | `4ee0924261b46a27550973a39c7b8938cbe403ff` |
| `fcebdf03a5d3dad47947f7770910c6261ae42a3a` | `228498da0a822c272923ed4ff2fc1cee7e9f64be` | `df16ed24ebdbd4523bfe8a4c9be8f27f87e21260` | `df16ed24ebdbd4523bfe8a4c9be8f27f87e21260` |
| `956eb188d826ce31db887a8470866a1e65b58df7` | `78b41544a44ebfcea26f00742fb7d85ab0aad6d3` | `91384057b4b395d0906dc4684d4a20ed59613257` | `91384057b4b395d0906dc4684d4a20ed59613257` |
| `22c352f6acdf2b21435a4eba8ebe76973d0b1ef6` | `f0dbcd037cff5776b73a0ad6b1e796cc9bf8c03f` | `ae724d247655638038254bb8cd48d72dfe2f9791` | `ae724d247655638038254bb8cd48d72dfe2f9791` |
| `e67f61331e0bb8642529eed89c7c97c4abe1bb4e` | `5dc663bd0676a26f7a97cf29e3b5f460c96f7fbd` | `66f00e9c1638043d5bc81cdee7a296c940eceb13` | `66f00e9c1638043d5bc81cdee7a296c940eceb13` |

The first two rows belong to OAuth; all nine rows belong to the complete signature candidate. All picks retain their original source author metadata and commit messages, including MIT attribution and issue references. Hooks were disabled for mechanical cherry-picks; checks are recorded separately.

## Resolution and source preservation

One mechanical resolution was required while picking `4b173733`: the first import hunk in `open-sse/utils/stream.js` conflicted with the base's additional `applyStreamQuirks` import. The resolution keeps that existing import and takes the source's `antigravityGeminiResponse, formatGoogleRpcStreamError` import. All three index stages, combined diff and staged patch were saved before resolution. No new runtime logic was authored. The actual resolution author is recorded in private provenance; Git identity was not used to infer the author family.

That import context changes the stable patch ID for this one pick. `delta-preservation.json` verifies that every added and removed line, grouped by file, is identical between all nine source patches and their candidate counterparts. Every other stable patch ID matches. The second prerequisite and all five signature picks applied without manual resolution. Grouping, wire normalization, replay guards, account/session signature scope, Claude corrections and persistent-write retry are retained.

The full prerequisite reports and 17-case/29-case protected suites are present, byte-identical to their source blobs. The 20-case scope suite is also byte-identical. The final isolation suite and thought-signature-family suite match their last authorized source blobs; the earlier isolation cases, rename and later regression additions/corrections remain in the ordered source commits. No test case was dropped or weakened. `source-accounting.json` records source-parent, source, base, picked and final blob IDs for every source path, including absent/renamed paths.

## Clean scoped validation

Each command used a credential-free `env -i` allowlist, explicit PATH/LANG/CI, Git no-lazy-fetch/read controls, private HOME/DATA_DIR/TMPDIR/cache/store and a 300-second ceiling. Root and tests dependencies were installed with frozen lockfiles only in these own real worktrees. No borrowed dependency graph was changed.

Root lint ran as direct components: `node node_modules/eslint/bin/eslint.js src` and `node scripts/check-anti-slop.mjs`. Both exit 0 for both candidates: 0 ESLint errors, 349 existing warnings, 0 anti-slop diagnostics (OAuth 3405 files; signatures 3406 files). The tracked pre-bundled plugin and all configured rules were used unchanged; no bundle rebuild or application build ran.

| Candidate | Explicit test files | Passed assertions | Failed / pending | Root lint |
| --- | ---: | ---: | --- | --- |
| oauth | 12 | 108 | 0 / 0 | pass |
| signatures | 16 | 194 | 0 / 0 | pass |

The JSON nested-suite counts are 38 and 54 respectively; these are not test-file counts. Tests ran from each private checkout's `tests/` directory, with its own config, using `node node_modules/vitest/vitest.mjs run <explicit files> --maxWorkers=2 --reporter=json --outputFile=<private log>`. Exact paths and commands are in `checks.json`.

| Explicit file under tests/ | OAuth assertions | Signature assertions |
| --- | ---: | ---: |
| `unit/antigravity-cli-onboarding-wire.test.js` | 3 | 3 |
| `unit/antigravity-default-oauth-profile.test.js` | 32 | 32 |
| `unit/antigravity-gemini-native-response.test.js` | 5 | 5 |
| `unit/antigravity-model-catalog.test.js` | 2 | 2 |
| `unit/antigravity-oauth-cancellation.test.js` | 8 | 8 |
| `unit/antigravity-oauth-client.test.js` | 8 | 8 |
| `unit/antigravity-signature-isolation-completion.test.js` | absent | 19 |
| `unit/antigravity-signature-scope-21439-3366.test.js` | absent | 20 |
| `unit/antigravity-thought-signature-family.test.js` | 7 | 8 |
| `unit/claude-reasoning-response.test.js` | 3 | 3 |
| `unit/cpa-gemini-replay-parity.test.js` | absent | 17 |
| `unit/cpa-gemini-replay-retained.test.js` | absent | 29 |
| `unit/gemini-native-endpoint.test.js` | 13 | 13 |
| `unit/omni-antigravity-claude-wire-shape.test.js` | 3 | 3 |
| `unit/port9r-141-antigravity-onboarding-mode.test.js` | 3 | 3 |
| `unit/provider-signin-antigravity-parity.test.js` | 21 | 21 |

The four added prerequisite/scope/isolation suites are absent from the intentionally narrow OAuth tree and are not claimed collected there. Both candidates passed their existing model/profile, native Gemini, thought-signature-family and Claude suites. Neither index contained conflict markers during checks. Baseline diff and `git diff --check` are empty/passing for both.

## Files and documentation

### oauth

- `internal/docs/port-reports/provider-signin-antigravity-parity.md`
- `src/lib/oauth/services/antigravity.js`
- `tests/unit/antigravity-cli-onboarding-wire.test.js`
- `tests/unit/port9r-141-antigravity-onboarding-mode.test.js`
- `tests/unit/provider-signin-antigravity-parity.test.js`

### signatures

- `internal/docs/port-reports/2034-agy-signature-isolation-completion.md`
- `internal/docs/port-reports/2034-agy-signature-scope-21439-3366.md`
- `internal/docs/port-reports/cpa-gemini-replay-dbe641f.md`
- `internal/docs/port-reports/cpa-gemini-replay-retained-2034.md`
- `internal/docs/port-reports/provider-signin-antigravity-parity.md`
- `open-sse/executors/antigravity.js`
- `open-sse/executors/vertex.js`
- `open-sse/handlers/chatCore.js`
- `open-sse/handlers/chatCore/antigravityGeminiNative.js`
- `open-sse/handlers/chatCore/emptyStreamGuard.js`
- `open-sse/handlers/chatCore/nonStreamingHandler.js`
- `open-sse/handlers/chatCore/sseToJsonHandler.js`
- `open-sse/services/thoughtSignatureStore.js`
- `open-sse/translator/concerns/geminiTrailingModelTurn.js`
- `open-sse/translator/formats/gemini.js`
- `open-sse/translator/request/openai-to-gemini.js`
- `open-sse/translator/response/gemini-to-claude.js`
- `open-sse/translator/response/gemini-to-openai.js`
- `open-sse/utils/antigravityGeminiNative.js`
- `open-sse/utils/stream.js`
- `src/app/api/v1beta/models/[...path]/geminiBridge.js`
- `src/app/api/v1beta/models/[...path]/route.js`
- `src/lib/oauth/services/antigravity.js`
- `tests/unit/antigravity-cli-onboarding-wire.test.js`
- `tests/unit/antigravity-signature-isolation-completion.test.js`
- `tests/unit/antigravity-signature-scope-21439-3366.test.js`
- `tests/unit/antigravity-thought-signature-family.test.js`
- `tests/unit/cpa-gemini-replay-parity.test.js`
- `tests/unit/cpa-gemini-replay-retained.test.js`
- `tests/unit/port9r-141-antigravity-onboarding-mode.test.js`
- `tests/unit/provider-signin-antigravity-parity.test.js`

The included port reports supply the source documentation and attribution: CLIProxyAPI contributors (MIT), including `dbe641f286a489ecb39e3c041c554371e6add864`, `13e06420967b8d1762c7422d689583a1d3b6c6a0`, `54ed2ba2016642abd897456f48d84b9f0fee6632` and `249ea68d71857bcdbca41f65d5d9bc4ed9db96ee`; OmniRoute (MIT) `35e01594ad13a7ffc0cd44d6598f6d862dfcff9f`; 9router (MIT) `829f2a88ea2069d2455ef0004bf29e70e793b3c8`. Existing exclusion of CPA `66f3ad1` is preserved.

## Evidence, predecessor and limits

Private verified archive: `/home/stormtrooper/checkpoint-evidence/agy-complete-2034-20261128`. It includes raw lint/test/install logs, JSON reports, exact commands/environment, both complete binary diffs, all source/candidate patches, source blob accounting, conflict stages, native-history provenance and a verified candidate Git bundle. `SHA256SUMS` covers archive files. Both completed own worktrees/dependencies are removed only after archive verification; their local branches and objects remain. The predecessor active-conflict worktree `/var/tmp/agy-2034-20261128T014140Z/candidate` is untouched, including its existing generated bundle change. No old conflict was aborted, reset, rewritten or deleted.

Only this report is changed on the native branch. No push, PR, merge, main edit, full CI, test:ci, local-ci, run-ci, application build, browser, e2e, Docker, live calls, credential access or baseline changes occurred. No new agents were launched.

Native report bookkeeping gate checks the single authorized native path, exact head/base/tree/hash accounting, source deltas and whitespace only. It is not product qualification. Independent full CI from a clean main checkout and the required independent review remain for the parent; these scoped passes do not replace them.
