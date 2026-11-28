# Z.ai proof/token correction assembly (#2034)

Assembly blocked on the first plain cherry-pick. This is bookkeeping only; no completed product candidate, qualification, publication, or full parity is claimed.

Source snapshot cutoff supplied for this task: `2026-11-27T23:49:25.752045Z`. The five explicitly requested immutable correction commits postdate that cutoff; no additional source refresh was used. Local source object reads used `GIT_NO_LAZY_FETCH=1` and `GIT_OPTIONAL_LOCKS=0`.

Freshly fetched origin/main base: `dc624113dc5728c04a01c1dd49e37f9a1dd80c4b`. Candidate HEAD remains `dc624113dc5728c04a01c1dd49e37f9a1dd80c4b`; committed tree `b72c25f3ab7cc7eba224e398fe039d8680061326`. Branch: `auth/2034-zai-proof-tDSb4Lw9`. Private worktree: `/var/tmp/2034-zai-proof-tDSb4Lw9/candidate`. No candidate commit was created; the index is unmerged, so there is no candidate result tree.

## Exact blocker

`internal/docs/port-reports/cookie-flows/zai-web-2034.md` is deleted on main but modified by the first requested commit. Git reported modify/delete and retained the source file. No resolution, skip, abort, or semantic adaptation was performed. The remaining four commits were not attempted because order is mandatory. The minimal decision concerns this one documentation path; restoring it or accepting its deletion requires an explicit resolution outside this task. No missing product prerequisite is inferred from this documentation conflict.

## Immutable source accounting

Source sequence starts at `ff3602026e6e30d1569710efc33f1cfd40349220`; every requested commit is a descendant and the five form a direct parent chain. MIT attribution to the pinned OmniRoute source is retained in the untouched source patches/reports.

| Source commit | Stable patch ID | Outcome |
| --- | --- | --- |
| `248dae3e477a5e39e8fbe30c73e74b5ca02cc613` | `5af9158542cff95845e01a65ba7279f2bfba6dfa` | First pick conflicted |
| `5e3f21f9b1694b0e53a0a41e6d719e2ee3f70814` | `67f6d0db23c6f9c77376ee38671cb72abd431d48` | Not attempted |
| `2e2ef64204b036240968f49af4263baf32148fce` | `a50d81ed16216c780ecda385e48460e27ef5d440` | Not attempted |
| `7dc700fd16e4398c775dab83055ef496da3e967b` | `c995e1616ab6e93aba07e29b66c4bbb3397efd2c` | Not attempted |
| `c1e40b61f6b6eb36434d8f636f8667b88954aa92` | `bbd8b824aaeafdac34808aec9dd685650d2d1978` | Not attempted |

All five stable patch IDs were checked against every non-merge patch reachable from fetched main; none matched. This proves no exact patch-ID match, rather than claiming semantic absence. Per-path source/main blob IDs (null means absent) are in the private source accounting. Exact source patches, main patch-ID inventory, complete staged/unmerged index and working diffs are archived. There are no candidate commits to compare. No unrelated integration or provider patch was imported. Main DeepSeek files and shared fixtures were not manually changed.

First-pick affected paths:

- `internal/docs/port-reports/cookie-flows/zai-web-2034-handoff.json`
- `internal/docs/port-reports/cookie-flows/zai-web-2034.md`
- `open-sse/executors/zai-web.js`
- `open-sse/executors/zai-web/readBody.js`
- `open-sse/executors/zai-web/session.js`
- `tests/unit/zai-web-source-contract-2034.test.js`

## Validation and retained evidence

Root lint and all seven requested suites were not run: there is no assembled candidate, the required final regression filename is not yet present, and running the first partial patch would not validate the requested sequence. No install, full CI, build, browser, live request, baseline update, test weakening, or skipping was performed. Existing source fixtures and helper/fallback corrections remain preserved in their immutable source objects and archived patches; their successful application is unproved.

Private evidence archive: `/home/stormtrooper/checkpoint-evidence/2034-zai-proof-tDSb4Lw9`. `SHA256SUMS` was recomputed and verified against every archived evidence file. Staged-diff SHA-256: `d8fd0d07faa304c73dcfdae3aae61433ccb7e4e2fe736e2987dde497cfd966a6`. Working-diff SHA-256: `b505bec340e746de2eecf2995d980826efeba05b50188198f20874b384d21b22`. Committed base-to-head diff is empty. The active conflicted worktree and local branch are deliberately preserved; no completed candidate worktree or dependencies exist to remove.

Native execution provenance was inspected privately and archived separately. It contains execution metadata rather than a literal `usedFamily` field; that specific proof requirement remains unmet. No new product resolutions were authored.

Source LocalStorage public activation remains separate. Live/browser behavior is unsupported and unverified. Proof TTL, verifier/browser support, and full parity are not established. Independent review and full CI remain parent responsibilities after assembly is unblocked.

All six first-pick index result blobs (including conflict stage 3) match the first source commit exactly; recorded in `partial-index-blob-check.json`. This verifies the partial application only.
