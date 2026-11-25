# OmniRoute morning port, candidates 8-13

| Source row | Commit | Disposition and evidence |
|---:|---|---|
| 221 | [26e95d97bd58](https://github.com/cheaper-inference/OmniRoute/commit/26e95d97bd58841656e7e05ebc098f3d0e87faa8) | Ported in this change. The strict helper detectors and their ordered fallback are in [claudeCodeMetaRequests.js](../../../open-sse/utils/claudeCodeMetaRequests.js). The bypass enables each helper only when its environment flag is `true`; `CLAUDE_CODE_LOCAL_COMMAND_PREFIX_ENABLED`, `CLAUDE_CODE_LOCAL_SUGGESTION_ENABLED`, and `CLAUDE_CODE_LOCAL_FILEPATHS_ENABLED` all default off. [Focused tests](../../../tests/unit/port-omniroute-claude-code-helpers.test.js) cover each response and forwarding. |
| 223 | [cd9556bbddaa](https://github.com/cheaper-inference/OmniRoute/commit/cd9556bbddaa88e6df7ddc7a9492e263045b0de9) | Remaining. The JavaScript port needs the missing same-account re-egress feature before its limit reader can be evaluated. |
| 226 | [9decf9bd8bdc](https://github.com/cheaper-inference/OmniRoute/commit/9decf9bd8bdc5a8c686d6dbabb65797be8e03b9a) | Remaining. The scheduled model health check and its ownership marks are absent; implementing the connection-level exclusions requires that scheduler. |
| 233 | [16841cae87ea](https://github.com/cheaper-inference/OmniRoute/commit/16841cae87eac5ed51b1303222da1653a15dbc3d) | Remaining. This merge introduces the missing same-account proxy re-egress feature. DurinDoor has proxy pools but does not retry the same request through a fresh member. |
| 247 | [63399cd8d77a](https://github.com/cheaper-inference/OmniRoute/commit/63399cd8d77a16fa1c75b2bcdef6f739d9439732) | Remaining. The decision refactor depends on the missing re-egress feature in row 233. |
| 248 | [1f118b84e5f9](https://github.com/cheaper-inference/OmniRoute/commit/1f118b84e5f9e03503473c56d53727ed1347fbae) | Remaining. This merge introduces the missing scheduled health-check feature, including the safety changes in row 226. |
