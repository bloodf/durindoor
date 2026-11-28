# #2034 Z.ai proof fixture prerequisite

This branch carries one exact prerequisite blob onto the previously gated candidate. It is mechanical source assembly only; no product logic or test assertions were changed.

## Provenance

- Base commit: `babb84acfae234255b6830c694d3cba5b85b065c` (`auth/2034-zai-provider-proof-isolation-candidate`).
- Source commit: `fda0d35c0eae7e26444eb436682d99579761e4fd`.
- Source path: `tests/unit/helpers/cookiePublicFlow2034.js`.
- Source blob: `3ac4504379112cf34bf49ff28046699c297314b1`; target file hashes to the same blob.
- The frozen range from original `dc624113dc5` through base contains 12 commits. Its full binary diff SHA-256 is `566772bf96c89fea307fdbf96e1d946fffeeca7520403de0912924f598aedefb`; its base tree is `b72c25f3ab7cc7eba224e398fe039d8680061326`, and base-candidate tree is `f980814601344d45a446a34c29f5a1646ed2be85`.
- Source attribution is limited to the exact source commit and blob above; no source ancestry was picked.

## Static prerequisite check

The base has two literal imports of `./helpers/cookiePublicFlow2034.js`: `tests/unit/zai-legacy-proof-envelope-isolation-2034.test.js` and `tests/unit/zai-request-proof-provider-isolation-2034.test.js`. The fixture's relative, alias, and dynamic literal import targets were checked against the candidate tree. All resolve, including `tests/utils/requestDetailsCleanup.js`, the proxy fetch utility, database entry point, cookie-import pairing and ingest routes, provider listing, public chat and messages routes, and usage module. No missing import closure was found. This is a path-resolution check, not an assertion/runtime result.

## Scope and limits

The change adds only `tests/unit/helpers/cookiePublicFlow2034.js` relative to the base; the 12 frozen commits and their tests remain unchanged. No product code, import resolution, or tests were rewritten. The source-lineage evidence page contains historical validation results and identifies the helper blob used for those runs. A separate reviewer reported 105 passing tests against a 179-test baseline, with differential/fuzz evidence, after restoring the fixture in that review context. Neither that report nor the source-lineage results are execution on this candidate head. The two new proof suites and previous Z.ai suites were not executed here because no intact read-only dependency graph in a private exact tree with isolated environment was established. The parent final-head gate and review remain separate; this work makes no readiness or merge claim.

The incremental patch SHA-256 for the fixture path relative to the base is `b26c7cc66f561dd917b25b00788388c7ac930209d9e0650b98d8a51e8889622e`. The resulting branch head and tree are recorded in the task completion report. The branch's only native report is this file.
