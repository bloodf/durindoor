# OmniRoute port tail A

Status: **PARTIAL**. This covers the first ten port-candidate rows in [the intake report](1073-nov25-open-prs-and-tail.md), in order. The exact PR file diffs were fetched with `gh api repos/cheaper-inference/OmniRoute/pulls/<number>/files --paginate`; the exact head commit diffs were also fetched with `gh api repos/cheaper-inference/OmniRoute/commits/<sha>`. Remaining rows need implementation or further investigation; they are not final dispositions. The remaining scope exceeds the work order's approximately one-hour threshold.

| Source | Disposition | Evidence or remaining work |
|---|---|---|
| #21173 `a061be50d28d3c56fd3cc41172dfdb24a3223630` | Remaining | Compare the exact route authorization changes with local [embeddings](../../../src/app/api/v1/embeddings/route.js) and [web fetch](../../../src/app/api/v1/web/fetch/route.js), including management-route isolation. |
| #21172 `287d78b5c39f3d8af083ef9d75339aad8f8667cf` | Already present | [usageRepo.js, formatLogDate and getRecentLogs](../../../src/lib/db/repos/usageRepo.js) includes date and time in each log; [RequestLogger.js, parseLogParts](../../../src/shared/components/RequestLogger.js) displays that field. [The focused test](../../../tests/unit/port-omniroute-21172-log-date.test.js) covers entries across midnight. |
| #21166 `8ebae5e265c06a66e3ace8c1ebd433a2b1d555ec` | Remaining | The intake's `src/lib/usage/callLogRotation.js` is absent in this checkout. Determine whether any local call-log storage has an equivalent resumable directory scan before concluding applicability. |
| #21164 `33a23e7efa3d1b329049f70539e995585498391f` | Remaining | Trace the local speech provider dispatch and adapt the upstream Vercel TTS executor if applicable. |
| #21163 `6019655f24770f900b9e43d8a60dd8f5f497d15c` | Remaining | Determine the local equivalent of upstream's connection cap and implement request lifetime accounting if applicable. |
| #21159 `59f6a7893437c6363482561056adcd332e02cc62` | Remaining | Review the SQLite adapter contract and the [earlier intake](1073-omni-21159-intake.md), then implement and test transaction-aware release if applicable. |
| #21138 `47755e06d07a7e1fd5791b33e30c447ce59cd086` | Remaining | Trace Antigravity quota eligibility and per-connection settings before adapting the override. |
| #21094 `47d3d9d306c851b3a512c69de578f1feb6d15973` | Remaining | Compare the local [free model catalog](../../../open-sse/config/freeModelCatalog.js) with upstream count and facts contracts. |
| #21089 `2e3d5ac3ad13b512041924edb4a4b91911ed2510` | Remaining | Trace non-stream combo timeout and first-output observation before adapting the upstream change. |
| #21087 `88b90a7320bed293697fc06c6873d4654a003727` | Remaining | [keepalive.js](../../../src/sse/handlers/chat/keepalive.js) currently wraps streaming requests. Design and test the delayed non-streaming JSON keepalive, including cancellation and late errors. |
