# OmniRoute morning port, candidates 8-13

Status: COMPLETE

| Source row | Commit | Disposition and evidence |
|---:|---|---|
| 221 | [26e95d97bd58](https://github.com/cheaper-inference/OmniRoute/commit/26e95d97bd58841656e7e05ebc098f3d0e87faa8) | Ported in this change. The strict helper detectors and their ordered fallback are in [claudeCodeMetaRequests.js](../../../open-sse/utils/claudeCodeMetaRequests.js). The bypass enables each helper only when its environment flag is `true`; `CLAUDE_CODE_LOCAL_COMMAND_PREFIX_ENABLED`, `CLAUDE_CODE_LOCAL_SUGGESTION_ENABLED`, and `CLAUDE_CODE_LOCAL_FILEPATHS_ENABLED` all default off. [Focused tests](../../../tests/unit/port-omniroute-claude-code-helpers.test.js) cover each response and forwarding. |
| 223 | [cd9556bbddaa](https://github.com/cheaper-inference/OmniRoute/commit/cd9556bbddaa88e6df7ddc7a9492e263045b0de9) | Not applicable. The TypeScript environment type fix belongs to the absent `src/sse/services/sameAccountEgressRetry.js`. |
| 226 | [9decf9bd8bdc](https://github.com/cheaper-inference/OmniRoute/commit/9decf9bd8bdc5a8c686d6dbabb65797be8e03b9a) | Not applicable. The scheduler and its ownership marks are absent: `src/shared/services/modelHealthCheckScheduler.js` and `src/lib/db/modelHealthAutoHidden.js`. |
| 233 | [16841cae87ea](https://github.com/cheaper-inference/OmniRoute/commit/16841cae87eac5ed51b1303222da1653a15dbc3d) | Not applicable. This merge introduces same-account re-egress, whose `src/sse/services/sameAccountEgressRetry.js` has no local counterpart. |
| 247 | [63399cd8d77a](https://github.com/cheaper-inference/OmniRoute/commit/63399cd8d77a16fa1c75b2bcdef6f739d9439732) | Not applicable. The decision refactor targets the absent `src/sse/services/sameAccountEgressRetry.js` introduced by row 233. |
| 248 | [1f118b84e5f9](https://github.com/cheaper-inference/OmniRoute/commit/1f118b84e5f9e03503473c56d53727ed1347fbae) | Not applicable. This merge introduces the absent `src/shared/services/modelHealthCheckScheduler.js` and `src/lib/db/modelHealthAutoHidden.js`, including row 226. |
