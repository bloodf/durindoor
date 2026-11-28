# OmniRoute #21321: Gemini streaming token totals

- **Upstream PR:** [#21321](https://github.com/cheaper-inference/OmniRoute/pull/21321), open at review; title `fix(sse): refresh derived Gemini streaming token totals`.
- **Exact head:** `b612d690463c888b35606f0bee6cc82583ea5f99`.
- **Changed paths:** `open-sse/translator/response/gemini-to-openai.ts`, `tests/unit/gemini-usage-total-fallback.test.ts`, and `changelog.d/fixes/pending-gemini-stream-derived-total.md`.
- **Local comparison:** `origin/main` `29490b783e83176d4d6a4162f76ee3dc79db66ea`; frozen train `train/2` `32a783d76d45d90bf0517015442f43fadd96106c`; both translator blobs match the review checkout. `orq/tp3r51/integration` is `3da9fdee9058d0691c8471ff851bfea7a718f2df`, and its translator blobs also match.

## Verdict: concrete missing behavior — medium severity

The claim that a previously *derived* total feeds back into completion inference does not reproduce locally: `open-sse/translator/concerns/usage.js` derives usage from each raw Gemini metadata snapshot, and `gemini-to-openai.js` does not feed its prior `state.usage` into that extraction. However, the local stream adapter also does not retain the last positive provider-reported total. Each candidate-bearing snapshot replaces `state.usage` with the current `toOpenAIUsage(...)` result (`open-sse/translator/response/gemini-to-openai.js`, usage extraction and assignment near lines 222–224). When the new snapshot omits or has invalid `totalTokenCount`, the Gemini extractor falls back to the current prompt plus completion, overwriting the previously reported total.

**Reproduction by precise trace:** call `geminiToOpenAIResponse` twice with the same state and candidate-bearing chunks. First chunk has `usageMetadata: {promptTokenCount: 80, candidatesTokenCount: 2, totalTokenCount: 83}`. Second cumulative chunk has `{promptTokenCount: 80, candidatesTokenCount: 9}` (or `totalTokenCount: -1`). The final emitted usage is `{prompt_tokens: 80, completion_tokens: 9, total_tokens: 89}` locally; the upstream PR retains the last valid provider total, `83`. The same test with a second snapshot reporting `totalTokenCount: 91` should emit 91, confirming a later valid provider total replaces the retained one.

The upstream change is therefore partly applicable: its per-snapshot derived-total refresh is already inherent in local extraction, but its explicit `geminiReportedTotalTokens` state and preservation of provider authority are missing. A focused regression belongs beside the existing Gemini stream translator tests (for example `tests/unit/gemini-snapshot-dedup.test.js`); no provider or gateway execution is needed to reproduce it. This affects usage totals sent to clients and can affect downstream accounting, but does not establish a billing loss in every consumer.

## Existing claims and scope

`internal/docs/port-reports/omni-review-catalog.md` previously classified #21321 as not applicable because the local translator “handles usage differently”; this review supersedes that broad disposition with the specific partial gap above. The November 27 parity refresh lists this exact head as requiring review. Existing #20279 stream-tail accounting notes cover a broader stream receipt invariant in another accounting layer; they do not document retention of Gemini provider totals in this translator. No exact active claim for this behavior was found. The listed sync-lane PRs and 9router PRs are outside this bounded review. The auth lane’s stated ownership does not overlap this Gemini translator behavior.
