# OmniRoute morning port candidates 1-7

Source: [1073-nov25-am-commits-5.md](./1073-nov25-am-commits-5.md). Exact commit diffs were fetched with `gh api`. This is a partial port; remaining rows need implementation and focused tests.

| Candidate | Upstream | Disposition | Evidence |
| --- | --- | --- | --- |
| 1 | [099024c54de0](https://github.com/cheaper-inference/OmniRoute/commit/099024c54de0303863c1c35d8280f402640b6c6a) | Remaining | Scheduled per-connection checks, automatic visibility marks, and restoration require scheduler, persistence, API and UI work. |
| 2 | [670656c26153](https://github.com/cheaper-inference/OmniRoute/commit/670656c2615344924416f7051bcfd726f743feb7) | Ported in this change | [OAuthModal.js](../../../src/shared/components/OAuthModal.js) opens Cline without an opener and rejects relay events; [test](../../../tests/unit/port-omniroute-cline-callback.test.js) verifies manual exchange. |
| 3 | [6f0ffcec20c8](https://github.com/cheaper-inference/OmniRoute/commit/6f0ffcec20c8488330e21c83546f1f4c36ca8864) | Remaining | [base.js](../../../open-sse/executors/base.js) has no upstream WAF-specific retry; the upstream fix depends on that missing AgentRouter behavior. Verify and implement its intended retry separately. |
| 4 | [339fd9ebed2d](https://github.com/cheaper-inference/OmniRoute/commit/339fd9ebed2d8f476580107c539fa46481417262) | Remaining | The helper detectors and their upstream command parsing prerequisites are absent. |
| 5 | [a2516f9c4b63](https://github.com/cheaper-inference/OmniRoute/commit/a2516f9c4b6364c7a6b569e616ca12faf4f7bb86) | Remaining | Default-off flags depend on the helper implementation in candidates 4 and 6. |
| 6 | [902878cb8f56](https://github.com/cheaper-inference/OmniRoute/commit/902878cb8f5643bf90dc01a96b1c776f806a4e5b) | Remaining | Local helper replies depend on candidate 4 and need integration with the existing bypass handler. |
| 7 | [0c3cf2ecafb0](https://github.com/cheaper-inference/OmniRoute/commit/0c3cf2ecafb05f8efc1afa0319888a766f0b1b13) | Remaining | Same-account re-egress needs bounded retry integration with the proxy pool and quota classification. |
