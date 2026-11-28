# #2034 Z.ai proof candidate completion attempt

Blocked; no completed candidate or qualification claim. No push, PR, merge or main mutation.

Freshly fetched main base: `dc624113dc5728c04a01c1dd49e37f9a1dd80c4b`. Private branch: `auth/2034-zai-proof-20261128-a`.
Preserved worktree: `/var/tmp/zai-2034-20261128-a/candidate`. Partial committed HEAD: `e3379e56ddd878bd5a8614d707cc76f237bfc336`; committed tree: `2f04ec527821bdd3d0335ea34420abf93e9cbd24`. The index is unmerged, so no final candidate tree exists.
Committed base-to-head binary diff SHA-256: `b07914495461e724ac302f1797e31d2446090749ec5be1dbbe2f029b71400dcb`.

The original candidate `/var/tmp/2034-zai-proof-tDSb4Lw9/candidate` remains at its first-pick documentation modify/delete conflict, untouched. This fresh descendant restores only the exact `248dae3e477^` prerequisite document in `8c29ebfdbad04399bea541bcf5a4fe6cd920a80d`. Its content is byte-identical to that source blob; no prerequisite product/test/import/cookie fixture was imported. MIT attribution is retained.

| Source commit | Candidate commit | Source stable patch ID | Candidate stable patch ID |
| --- | --- | --- | --- |
| 248dae3e477a5e39e8fbe30c73e74b5ca02cc613 | 21314e86b3c78ffd7102be7f5ea62da2c2e939cb | 5af9158542cff95845e01a65ba7279f2bfba6dfa | 5af9158542cff95845e01a65ba7279f2bfba6dfa |
| 5e3f21f9b1694b0e53a0a41e6d719e2ee3f70814 | 4be96c5db37681bdc43db2c9baccd618961ca065 | 67f6d0db23c6f9c77376ee38671cb72abd431d48 | 67f6d0db23c6f9c77376ee38671cb72abd431d48 |
| 2e2ef64204b036240968f49af4263baf32148fce | e3379e56ddd878bd5a8614d707cc76f237bfc336 | a50d81ed16216c780ecda385e48460e27ef5d440 | a50d81ed16216c780ecda385e48460e27ef5d440 |
| 7dc700fd16e4398c775dab83055ef496da3e967b | conflicted | c995e1616ab6e93aba07e29b66c4bbb3397efd2c | not committed |
| c1e40b61f6b6eb36434d8f636f8667b88954aa92 | not attempted | bbd8b824aaeafdac34808aec9dd685650d2d1978 | not committed |

The first three patches applied without manual resolutions; stable patch IDs match and per-path blobs are recorded in the private archive. No docs context-only differences arose. No patch was treated as already present merely on assumption: the three successful picks are nonempty, fourth conflicts, fifth was not attempted.

Fourth pick `7dc700fd16e4398c775dab83055ef496da3e967b` has a modify/delete conflict at `tests/unit/cookie-flow-zai-web-2034.test.js`. Main and the partial candidate lack that file. Its source-parent blob is `30c519ff5f11f48c81219427a69faa4699ee6342` (689 lines), introduced by `acaef33ca45dedf2b372856e96fe3f1fd2a27308`. That exact file is the minimal prerequisite identified; importing it requires authorization beyond the documentation-only exception. Index stages and all partial staged changes are preserved. No manual semantic adaptation was made. Fifth-patch fixtures and all source helper/fallback corrections are retained in source evidence, but are not claimed as completed candidate behavior.

Scoped root lint and the four Z.ai suites (source proof, provider helper, cookie flow, fleet), plus `web-session-redirects`, `review-x-executor-send-2`, and `provider-registration-web-batch-a-routes`, were not run: replay stopped before a complete candidate existed. No install, baseline edit, test weakening, full suite, build, browser or live call occurred. Main's shared DeepSeek fixture was inspected and left unchanged; no unrelated integration DeepSeek implementation was imported.

Source LocalStorage public activation remains separate. Live/browser behavior is unsupported or unverified; this is not full parity. No proof TTL, verifier or browser support is asserted. Parent owns later qualification under the latest owner policy.

Private evidence archive: `/home/stormtrooper/checkpoint-evidence/zai-2034-20261128-a`; every `SHA256SUMS` entry was recomputed and verified. It contains raw replay log, source/candidate patches, blob accounting, source authors, prerequisite blobs, conflict stages, diffs and explicit check/provenance gaps. Actual source execution-family verification remains unmet; Git author fields are not execution provenance. No new product resolution was authored. Active conflict worktrees and local branches/objects are retained; no completed candidate dependencies exist to remove.

Committed files in partial candidate:

```text
A	internal/docs/port-reports/cookie-flows/zai-web-2034.md
A	internal/docs/port-reports/fix-zai-source-token-proof-2034-handoff.json
A	internal/docs/port-reports/fix-zai-source-token-proof-2034.md
M	open-sse/executors/zai-web.js
A	open-sse/executors/zai-web/readBody.js
A	open-sse/executors/zai-web/session.js
A	tests/unit/fix-zai-source-token-proof-2034.test.js
```
