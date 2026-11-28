# Z.ai proof/token candidate final assembly (#2034)

The separate local product artifact is assembled and scoped checks pass. This native report is bookkeeping only: no publication, READY status, merge qualification or full parity is claimed.

## Artifact and provenance accounting

Freshly fetched main base: `dc624113dc5728c04a01c1dd49e37f9a1dd80c4b`.
Candidate branch: `auth/2034-zai-proof-zAbiLR4R`.
Head: `eb93adee35dea216d5c9bf6c3919985103115095`.
Tree: `7f0c0b7d6f5732445920c5132a9926bac32b77c1`.
Base-to-head binary diff SHA-256: `f1fe61fb96c0357b2547c8fb034db08d8c2f9896e3bdcc16d7d21477a83b4663`.

The candidate was assembled in private `/var/tmp/2034-zai-final-zAbiLR4R/candidate`. Its local branch/objects and verified bundle remain after completed-worktree cleanup. Bundle and raw evidence: `/home/stormtrooper/checkpoint-evidence/2034-zai-final-zAbiLR4R`.

Frozen source cutoff supplied: `2026-11-27T23:49:25.752045Z`. The explicitly authorized correction commits and prerequisite blobs postdate that cutoff; only those local immutable objects were used. Source reads disabled lazy fetch and optional locks.

Source base `ff3602026e6e30d1569710efc33f1cfd40349220` and all five direct parent links were verified. Every source/candidate stable patch ID matches exactly, including documentation context; every affected result blob matches its source commit. Inventory of all 1,235 non-merge main patch IDs contains none of these five IDs; this establishes exact patch absence, not semantic absence.

| Immutable source | Candidate commit | Shared stable patch ID |
| --- | --- | --- |
| `248dae3e477a5e39e8fbe30c73e74b5ca02cc613` | `a91658d2242c90513fb73d3456c236a0ff9b7bd3` | `5af9158542cff95845e01a65ba7279f2bfba6dfa` |
| `5e3f21f9b1694b0e53a0a41e6d719e2ee3f70814` | `0be48126ad561080d11fad9fcd79fc832b9c66f3` | `67f6d0db23c6f9c77376ee38671cb72abd431d48` |
| `2e2ef64204b036240968f49af4263baf32148fce` | `6b1b071a37bce42289db35e93e520e8833e1743f` | `a50d81ed16216c780ecda385e48460e27ef5d440` |
| `7dc700fd16e4398c775dab83055ef496da3e967b` | `044d624bd9cac168230695dff3932bf1e4c042a8` | `c995e1616ab6e93aba07e29b66c4bbb3397efd2c` |
| `c1e40b61f6b6eb36434d8f636f8667b88954aa92` | `eb93adee35dea216d5c9bf6c3919985103115095` | `bbd8b824aaeafdac34808aec9dd685650d2d1978` |

The only extra commits restore explicitly authorized exact prerequisites:
- `1116f86e7a58e53e10c3d58b0c1ef2a588d55f68`: document `internal/docs/port-reports/cookie-flows/zai-web-2034.md`, blob `a2c8540496146a2683299d472d258017c8c5ac0e` from `248dae3e477^`; stable patch ID `9202f1f73a2b28693ffae5d6e4636eaf204fc246`.
- `d4c11017b4a80b647a0bf8ea9fdb8698dc401097`: `tests/unit/cookie-flow-zai-web-2034.test.js`, blob `30c519ff5f11f48c81219427a69faa4699ee6342` from `7dc700fd16e^`, introduced by `acaef33ca45dedf2b372856e96fe3f1fd2a27308`; stable patch ID `051fea336ccca7357ae36b2b8705aef33cde2928`.

No wholesale prerequisite commit, integration history, unrelated provider correction, or semantic resolution was imported. MIT attribution in source patches/reports remains intact. Private provenance records source/prerequisite authors and distinguishes owner-attested execution-family verification from archived native execution metadata; no fresh literal execution-family status-field verification is claimed.

## Earlier conflicts and final outcome

Original `auth/2034-zai-proof-tDSb4Lw9` remains at its first-pick modify/delete conflict on the prerequisite document. The later partial candidate `e3379e56ddd878bd5a8614d707cc76f237bfc336` remains audit background with the fourth-pick missing cookie-flow fixture conflict. Both active conflict worktrees were left untouched. This fresh candidate restored only the two authorized prerequisite blobs before replay; all five plain picks then succeeded without conflicts.

Changed paths:
- `internal/docs/port-reports/cookie-flows/zai-web-2034.md`
- `internal/docs/port-reports/fix-zai-source-token-proof-2034-handoff.json`
- `internal/docs/port-reports/fix-zai-source-token-proof-2034.md`
- `open-sse/executors/zai-web.js`
- `open-sse/executors/zai-web/readBody.js`
- `open-sse/executors/zai-web/session.js`
- `tests/unit/cookie-flow-zai-web-2034.test.js`
- `tests/unit/fix-zai-source-token-proof-2034.test.js`
- `tests/unit/fleet-provider-zai-web-acceptance.test.js`
- `tests/unit/provider-registration-web-batch-a-routes.test.js`
- `tests/unit/review-x-executor-send-2.test.js`
- `tests/unit/web-session-redirects.test.js`
- `tests/unit/zai-web-provider.test.js`

## Scoped validation

Own private frozen root and test dependency installs passed. Direct root lint passed: ESLint 0 errors / 349 warnings; anti-slop plugin generation passed without tracked drift; anti-slop 0 diagnostics across 3,407 files. Git diff whitespace check passed and final candidate checkout was clean.

The following explicit Vitest run passed with two workers: 7 files, 158 tests, no skipped tests:
- `fix-zai-source-token-proof-2034.test.js`
- `zai-web-provider.test.js`
- `cookie-flow-zai-web-2034.test.js`
- `fleet-provider-zai-web-acceptance.test.js`
- `web-session-redirects.test.js`
- `review-x-executor-send-2.test.js`
- `provider-registration-web-batch-a-routes.test.js`

Exact source blob preservation retains every source fixture case, helper/fallback correction, mandatory no-proof refusal, and body-only/no-secret proof case. Shared-suite changes are exactly the source Z.ai hunks. Existing main DeepSeek shared fixtures and provider behavior survive without unrelated integration code. Failure baseline is unchanged and empty. No test weakening, skip, baseline addition, fake TTL/verifier/browser support, or manual product adaptation was made.

Evidence includes source/candidate patches, per-path blobs, prerequisite identity, main patch inventory, source authors, actual install/lint/test logs, clean-state check, binary diff and verified Git bundle. SHA256SUMS covers archived evidence and is verified before cleanup. Initial tooling/path discovery preceded the sanitized execution wrapper; the detailed command record discloses this limit. Assembly/install/check commands ran with private sanitized environments and 300-second ceilings.

No full suite, test:ci, local CI runner, build, browser/e2e, Docker or live calls ran. Commitlint, applicable typecheck, build and independent review were not performed by this scoped worker. Parent owns exact-head qualification under the latest owner policy (lint, applicable typecheck, build, changed-related Vitest, commitlint and cross-family review); no full CI/browser/e2e requirement is asserted here.

Source LocalStorage public activation remains separate. Live/browser behavior is unsupported and unverified. Full parity is not established.
