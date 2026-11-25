# OmniRoute morning port, candidates 1–10

Status: PARTIAL. The exact upstream diffs were fetched with `gh api`. The remaining candidates require implementation and verification; they are not classified as not applicable. Candidate numbers refer to port-candidate rows in [the source report](1073-nov25-am-commits-1.md).

| Candidate | Upstream commit | Disposition and evidence |
|---:|---|---|
| 1 | [6732e203](https://github.com/cheaper-inference/OmniRoute/commit/6732e203aa66bd773a4702c9daa37fa11e777358) | Remaining. [The local list route](../../../src/app/api/v1/me/sessions/route.js) has no session detail route or upstream filters. |
| 2 | [fcafd8af](https://github.com/cheaper-inference/OmniRoute/commit/fcafd8afbc0afbbb24156d60fe959744bff6ac6c) | Remaining. The local list route lacks time filters; implement UTC normalization with candidate 1. |
| 3 | [65a82d8f](https://github.com/cheaper-inference/OmniRoute/commit/65a82d8fdfa8f4d9329b915d55dc99d270d86bb7) | Remaining. The bounded status and settings behavior requires adaptation to local key limits. Upstream shared-quota functionality is outside this work order. |
| 4 | [25135bc7](https://github.com/cheaper-inference/OmniRoute/commit/25135bc78bb25a5fb239f8b34c8d1ca7ffde1938) | Remaining. [The existing capture route](../../../src/app/api/v1/session-captures/%5Bsession%5D/route.js) is separate from the requested sessions messages endpoint. |
| 5 | [8e8afac4](https://github.com/cheaper-inference/OmniRoute/commit/8e8afac4e07e247df2baacd8c3bd2f63074238b6) | Remaining. [The capture observer](../../../src/sse/utils/messageCapture.js) accepts chat completions and messages paths, not Responses API paths. |
| 6 | [9c93089d](https://github.com/cheaper-inference/OmniRoute/commit/9c93089d9a45e04d1e90c30fab15f1de48c519b7) | Remaining. Capture requires a stored key, but the observer has no explicit noLog gate. |
| 7 | [88bc75c9](https://github.com/cheaper-inference/OmniRoute/commit/88bc75c9046e5f87ea1649a6dcd48235101b5460) | Remaining. Review local usage reset and capture retention together before adding scoped deletion and counts. |
| 8 | [33a2f7a6](https://github.com/cheaper-inference/OmniRoute/commit/33a2f7a604e95bf799f05c8af37d8fe0fceb7786) | Remaining. Claude tool-name capture requires extending the local observer. |
| 9 | [1c4c1639](https://github.com/cheaper-inference/OmniRoute/commit/1c4c16394d80a28fdd8509f92911ee88205e3b26) | Remaining. Verify the storage-only tool names and unchanged client bytes together with candidate 8. |
| 10 | [954553ab](https://github.com/cheaper-inference/OmniRoute/commit/954553ab06b64b37b6fa93f58089614d218099f4) | Already present for supported capture formats. [The chat handler](../../../src/sse/handlers/chat.js) wraps the selected response, and the observer stores once after a complete client-visible response. [The focused test](../../../tests/unit/port-omniroute-client-visible-turn.test.js) checks one translated reply and one stored turn. Responses API capture remains candidate 5. |
