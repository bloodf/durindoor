# OmniRoute morning port candidates 1-7

Source: [1073-nov25-am-commits-5.md](./1073-nov25-am-commits-5.md). Exact commit diffs were fetched with `gh api`.

Status: **COMPLETE**.

| Candidate | Upstream | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | [099024c54de0](https://github.com/cheaper-inference/OmniRoute/commit/099024c54de0303863c1c35d8280f402640b6c6a) | Not applicable | Scheduled per-connection model health checks are out of scope; upstream scheduler `src/shared/services/modelHealthCheckScheduler.ts` and persistence `src/lib/db/modelHealthAutoHidden.ts` have no local counterparts. |
| 2 | [670656c26153](https://github.com/cheaper-inference/OmniRoute/commit/670656c2615344924416f7051bcfd726f743feb7) | Ported in this change | [OAuthModal.js](../../../src/shared/components/OAuthModal.js) opens Cline without an opener and rejects relay events; [test](../../../tests/unit/port-omniroute-cline-callback.test.js) verifies manual exchange. |
| 3 | [6f0ffcec20c8](https://github.com/cheaper-inference/OmniRoute/commit/6f0ffcec20c8488330e21c83546f1f4c36ca8864) | Ported in this change | [base.js](../../../open-sse/executors/base.js) retries AgentRouter content-blocked responses with bounded backoff; [test](../../../tests/unit/port-omniroute-waf-retry.test.js) checks provider scope. |
| 4 | [339fd9ebed2d](https://github.com/cheaper-inference/OmniRoute/commit/339fd9ebed2d8f476580107c539fa46481417262) | Already present | [claudeCodeMetaRequests.js](../../../open-sse/utils/claudeCodeMetaRequests.js) contains the detectors and command parsers. |
| 5 | [a2516f9c4b63](https://github.com/cheaper-inference/OmniRoute/commit/a2516f9c4b6364c7a6b569e616ca12faf4f7bb86) | Already present | [bypassHandler.js](../../../open-sse/utils/bypassHandler.js) uses the three helper flags, with coverage in [the helper tests](../../../tests/unit/port-omniroute-claude-code-helpers.test.js). |
| 6 | [902878cb8f56](https://github.com/cheaper-inference/OmniRoute/commit/902878cb8f5643bf90dc01a96b1c776f806a4e5b) | Already present | [bypassHandler.js](../../../open-sse/utils/bypassHandler.js) invokes the local helper detectors and [the helper tests](../../../tests/unit/port-omniroute-claude-code-helpers.test.js) exercise the replies. |
| 7 | [0c3cf2ecafb0](https://github.com/cheaper-inference/OmniRoute/commit/0c3cf2ecafb05f8efc1afa0319888a766f0b1b13) | Not applicable | Same-account proxy re-egress is out of scope; upstream `src/sse/services/sameAccountEgressRetry.ts` has no local counterpart. |
