# OmniRoute morning port: reports 3 and 6

The exact commit diffs were fetched with `gh api repos/cheaper-inference/OmniRoute/commits/<sha>`. The merge for row 254 also requires the inherited changes in PR #21100; its file list was fetched separately. This is a partial port: remaining rows need further implementation or verification before disposition.

| Source row | Upstream | Disposition and evidence |
|---|---|---|
| 3 / 105 | ce3d86939c3541860b1336e02b966c0c40b71e05 | **Ported in this change.** [Account fallback](../../../open-sse/services/accountFallback.js) recognizes the CodeBuddy International prose reset and marks the connection unavailable until that time; [focused test](../../../tests/unit/port-omniroute-codebuddy-dated-429.test.js) covers the deadline and provider isolation. |
| 3 / 106 | **Not applicable.** Upstream fixes retry-operation identity, host fingerprinting, and catalog merging. Those paths are absent from [the executor](../../../open-sse/executors/codebuddy-intl.js) and `open-sse/services/codebuddyIntlCatalog.js`. |
| 3 / 114 | **Not applicable.** Agent-session attribution and its resolver are absent from [usage storage](../../../src/lib/db/repos/usageRepo.js); `src/lib/usage/agentSessionAttribution.js` is absent. |
| 3 / 129 | 64e2f23f1ce6d3886c9cbeadd44947de3067d541 | **Remaining.** The restack needs an upgrade-path comparison against [session capture migration](../../../src/lib/db/migrations/032-session-capture.js). |
| 3 / 143 | d883bde1ca518191269a50c550caaf5024f359c2 | **Not applicable.** The stream outcome and proxy-context changes are for upstream's optional turn telemetry; [DurinDoor's executor](../../../open-sse/executors/codebuddy-intl.js) has no turn-reporting side channel. The recovery annotation documents the upstream telemetry wrapper rather than adding independent recovery behavior. |
| 3 / 144 | fb5fe2a5f264c359f537256c3bc9c6e19e349b22 | **Ported in this change.** [Rate-limit parsing](../../../open-sse/utils/error.js) reads the CodeBuddy data reset only for that provider; [the focused test](../../../tests/unit/port-omniroute-provider-reset-fb5fe2a.test.js) covers provider isolation and fallback. |
| 3 / 146 | 614bdfc7afa01a950dff4f91feb7bbe8cd256e53 | **Not applicable.** The discovery branch to extract is absent from `src/app/api/providers/[id]/models/route.js`; `open-sse/services/codebuddyIntlCatalog.js` is absent. |
| 6 / 254 | **Not applicable.** The merge inherits Claude Code helper replies absent from [the bypass handler](../../../open-sse/utils/bypassHandler.js); `open-sse/utils/claudeCodeLocalHelpers.js` is absent. |

## Verification

- `cd tests && timeout 290 node node_modules/vitest/vitest.mjs run unit/port-omniroute-codebuddy-dated-429.test.js unit/review-l-docs.test.js unit/1300-v5-storybook-inventory.test.js unit/model-catalog-consistency.test.js --maxWorkers=2` — 4 files, 11 tests passed.
- The full suite and final check were not run, as requested.
