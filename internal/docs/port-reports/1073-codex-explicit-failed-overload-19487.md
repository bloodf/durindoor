# #1073 — Codex explicit failed overload residual

OmniRoute #19487 (head `ae47a8978f28527dc6b22a36bd61b09aaa2e323a`, merge `c77f9061c61f22278756acf9f19e753a70a15002`) classifies the `currently overloaded` message in a structured error on an explicit `response.failed` SSE frame. The existing Codex peek now sends that failure through its bounded account-fallback path, after context-overflow classification. Existing model-capacity and same-account retry classifications remain in place.

The existing peek already handles SSE without a content-type header, so headerless handling is outside this residual. Successful output uses the existing exact-message detection and replay behavior. The offline synthetic test exercises the nested `response.error.message` shape in a status-200 SSE response; no provider access is needed.
