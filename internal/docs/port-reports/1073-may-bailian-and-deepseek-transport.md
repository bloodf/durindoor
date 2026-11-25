# #1073 May Bailian endpoint and DeepSeek replay dispositions

## Source pins

- OmniRoute #2150: merge [`6e2c5e2d4c6b07a9ddd4e24008058c30bab817fd`](https://github.com/cheaper-inference/OmniRoute/commit/6e2c5e2d4c6b07a9ddd4e24008058c30bab817fd), compared with its first parent. The relevant changes remove `?beta=true` from Bailian Coding Plan Messages URL construction and reshape its model list.
- OmniRoute #2231: merge [`67f713d3a52025824cd5c3e23c9597447b320e3f`](https://github.com/cheaper-inference/OmniRoute/commit/67f713d3a52025824cd5c3e23c9597447b320e3f), compared with its first parent. It narrows DeepSeek replay target recognition from any model containing `deepseek` to a DeepSeek provider or model beginning with `deepseek` (optionally after `/`), and hoists the V4 sanitizer regex into a constant.

## #2150 — equivalent Bailian URL behavior; catalog disposition

Local [`bailian-coding-plan.js`](../../../open-sse/providers/registry/bailian-coding-plan.js) sets the Messages endpoint inline as `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic/v1/messages`, with no `urlSuffix`. [`DefaultExecutor.buildUrl`](../../../open-sse/executors/default.js) returns that registered endpoint verbatim. This is equivalent to the pinned URL normalization result without the beta query. The local registry also retains bearer auth and Claude format; these local transport contracts remain authoritative.

Offline assertions in [`omniroute-simple-a-review-fixes.test.js`](../../../tests/unit/omniroute-simple-a-review-fixes.test.js) cover Bailian bearer auth and Claude format. The pinned commit's catalog reshaping does not establish a compatibility gap: the local registry already contains several of those IDs and has its own current entries. No catalog, price, or model change is proposed from the older metadata.

**Disposition:** existing equivalent for endpoint construction; no actionable gap.

## #2231 — inapplicable helper changes; local structured replay coverage

The pinned first-parent tree defines `isDeepSeekReplayTarget` in `open-sse/translator/index.ts` and applies it to translator-side reasoning replay. That helper and the changed `responseSanitizer.ts` are not present in this local source layout. The local [`open-sse/translator/index.js`](../../../open-sse/translator/index.js) has no corresponding DeepSeek replay target predicate; the pinned sanitizer refactor therefore has no local counterpart to port.

Local structured replay is exercised at the executor boundary by [`deepseek-thinking-history-parity.test.js`](../../../tests/unit/deepseek-thinking-history-parity.test.js): synthetic assistant/tool turns retain tool IDs, arguments, ordering, and reasoning placeholders on the DeepSeek OpenAI Chat route. That is relevant existing coverage, but it does not implement the pinned translator's broad model-substring predicate. The pinned recognition change is consequently inapplicable to this differently structured local implementation; changing provider/model recognition here would not be justified by the source diff.

**Disposition:** justified inapplicability for the translator predicate and sanitizer refactor; preserve existing executor replay and routing contracts.
