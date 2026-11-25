# OmniRoute morning port am2-c

Status: PARTIAL. Candidate numbers refer to [the source report](1073-nov25-am-commits-2.md). It has 25 candidates, so candidate 26 does not exist. Remaining work is estimated to exceed one hour.

| Candidate / source row | Upstream commit | Disposition and evidence |
|---|---|---|
| 19 / 92 | Not applicable. The filter requires agent-session attribution absent from [usage storage](../../../src/lib/db/repos/usageRepo.js); the [sessions route](../../../src/app/api/v1/me/sessions/route.js) lists aggregate usage. |
| 20 / 94 | Not applicable. The merge inherits session attribution and status accounting. [Usage storage](../../../src/lib/db/repos/usageRepo.js) lacks attribution and `src/app/api/v1/me/status/route.js` is absent. |
| 21 / 95 | Not applicable. The merge inherits agent-session attribution absent from [usage storage](../../../src/lib/db/repos/usageRepo.js). |
| 22 / 96 | Not applicable. `src/app/api/v1/me/status/route.js` is absent; [usage totals](../../../src/lib/db/helpers/apiKeyUsageTotals.js) do not provide its list-price response. |
| 23 / 97 | Not applicable. The merge inherits session detail and usage-linked turns. [Session capture](../../../src/lib/db/repos/sessionCaptureRepo.js) is a separate store; `src/app/api/v1/me/sessions/[id]/messages/route.js` is absent. |
| 24 / 99 | Not applicable. The merge inherits attribution and session detail. [Usage storage](../../../src/lib/db/repos/usageRepo.js) lacks attribution and `src/app/api/v1/me/sessions/[id]/route.js` is absent. |
| 25 / 100 | [a104888](https://github.com/cheaper-inference/OmniRoute/commit/a10488825667eb847e83113d6eecf9bdc01863ed) | Partially ported in `f631ef33569`: [the provider registry](../../../open-sse/providers/registry/codebuddy-intl.js) sends the CLI user agent and IDE identity, verified by [the focused test](../../../tests/unit/port-omniroute-codebuddy-cli-identity.test.js). The fetched diff also changes request body and correlation handling, catalog discovery, rate limits, and telemetry. These remain to be assessed for a full port. |

The focused identity test and three requested companion files passed before the identity commit. No provider calls were made.
