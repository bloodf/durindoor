# #1073 — late-May request format defaults

Compared the exact first-parent patches in the pinned OmniRoute source repository with the current integration checkout. The only demonstrated narrow behavior gap is Codex model-suffix precedence when a request already contains a reasoning object.

## Source patches

- [OmniRoute #2326](https://github.com/cheaper-inference/OmniRoute/pull/2326), head [`2aee0203aff995427bb1b0bc3f3ad19b588a9e15`](https://github.com/cheaper-inference/OmniRoute/commit/2aee0203aff995427bb1b0bc3f3ad19b588a9e15), merge [`0f15797e01aac02ad4d11daace0b4caa34bdaa66`](https://github.com/cheaper-inference/OmniRoute/commit/0f15797e01aac02ad4d11daace0b4caa34bdaa66). First-parent change: `chatCore.ts` passes the source format into stream resolution; Claude-format requests without a body `stream` default to non-streaming, while `Accept: text/event-stream` opts into streaming. Explicit body `stream: true|false` wins.
- [OmniRoute #2327](https://github.com/cheaper-inference/OmniRoute/pull/2327), head [`362428cc07da11b8a8f15d2b8ebdfd800c3920d3`](https://github.com/cheaper-inference/OmniRoute/commit/362428cc07da11b8a8f15d2b8ebdfd800c3920d3), merge [`696e16b361405c0cd9af43121ee5b83cb2396e38`](https://github.com/cheaper-inference/OmniRoute/commit/696e16b361405c0cd9af43121ee5b83cb2396e38). First-parent change: fit translated Claude thinking budgets and `max_tokens` beneath the model output cap, retaining answer room and disabling thinking only when the cap cannot fit its minimum.
- [OmniRoute #2335](https://github.com/cheaper-inference/OmniRoute/pull/2335), head [`198f77b523a6adbfecf8d369bbae8e4400f6e95a`](https://github.com/cheaper-inference/OmniRoute/commit/198f77b523a6adbfecf8d369bbae8e4400f6e95a), merge [`0e2d04526c6b08b8a7bf2e2e16e6cdbbf1f5a21d`](https://github.com/cheaper-inference/OmniRoute/commit/0e2d04526c6b08b8a7bf2e2e16e6cdbbf1f5a21d). First-parent change: a Codex model reasoning suffix takes precedence over client-supplied reasoning defaults.

## Local comparison

### Claude stream default

The local resolver starts an ordinary request as non-streaming when `stream` is omitted; explicit `stream: true` opts in, and explicit `stream: false` remains non-streaming ([`streamFlag.js`](../../../open-sse/handlers/chatCore/streamFlag.js), [`resolve-stream-flag.test.js`](../../../tests/unit/resolve-stream-flag.test.js)). This matches #2326's ordinary Claude default and explicit false behavior. The local resolver does not independently opt into streaming merely because the client prefers SSE; the #2326 patch explicitly recognizes `Accept: text/event-stream` for Claude. The shipped local resolver tests establish omitted and explicit body-flag behavior, not this Claude-specific SSE-header case. No broader change is proposed from this comparison.

### Claude thinking budget fit

The local native Claude path clamps `max_tokens` to its output ceiling and, when enabled thinking would meet or exceed that ceiling, raises the output limit within the ceiling and fits the budget below it; if no valid budget fits, it removes thinking ([`claude.js`](../../../open-sse/translator/formats/claude.js)). Existing fixtures cover a budget below `max_tokens` and an over-ceiling native budget ([`translator-helpers-edge.test.js`](../../../tests/unit/translator-helpers-edge.test.js)); custom output-cap coverage also asserts the fitted budget remains below the cap ([`custom-max-output-ceiling.test.js`](../../../tests/unit/custom-max-output-ceiling.test.js)). This is established local behavior, so #2327 does not identify a missing default to port.

### Codex reasoning suffix precedence — demonstrated difference

The local executor strips a recognized suffix from the model. If `body.reasoning` is absent, it uses `reasoning_effort`, then the suffix, then the default; if a reasoning object exists, its `reasoning.effort` is retained and normalized instead ([`codex.js`](../../../open-sse/executors/codex.js)). Existing tests cover suffix mapping when the body has no reasoning object and independently cover normalization of an explicitly supplied reasoning effort ([`codex-fast-capacity.test.js`](../../../tests/unit/codex-fast-capacity.test.js), [`codex-fast-capacity.test.js`](../../../tests/unit/codex-fast-capacity.test.js)). They do not cover the conflict.

The #2335 patch changes precedence to `modelEffort || explicitReasoning || requestReasoningEffort || fallbackReasoningEffort`. Thus a suffix such as `gpt-5.5-xhigh` overrides a client-injected `reasoning.effort: "medium"` locally as well as a legacy `reasoning_effort` value. This is the one concrete discrepancy evidenced by the first-parent patch and current implementation. Preserve the existing suffix parser and supported effort controls; the comparison supports only the precedence adjustment for an already-recognized suffix, not new aliases or reasoning levels.

## Disposition

Record the Codex conflict precedence difference for follow-up. Claude omitted-stream and explicit-false defaults and Claude budget fitting are already represented locally; the SSE Accept-header nuance is bounded and not covered by the existing local stream tests. No product code or tests changed in this report.
