# #1073: late-May existing response metadata comparison

Scope: static comparison of the exact first-parent patches for OmniRoute #2350, #2355, and #2477 with the current integration at `99b3f7fc78`. This report records compatibility behavior and existing local coverage; it does not propose a new port. No provider traffic was used.

## Source revisions

| Change | PR head | Merge commit | First-parent change |
| --- | --- | --- | --- |
| Existing OpenAI-shaped usage counters | [`#2350`](https://github.com/cheaper-inference/OmniRoute/pull/2350) | `26da869b0e6ab2f03fd2a3da036b26b6eb4090bf` | `d6d585e20099744d5a67d71a4595d56b9ffc5765` |
| Client-format stream errors | [`#2355`](https://github.com/cheaper-inference/OmniRoute/pull/2355) | `8c311bdc7ddd5b14084593332797ca569114cb04` | `f6364427ce835b4e8a2bfa682450057271cc985d` |
| Rebuilt embeddings response headers | [`#2477`](https://github.com/cheaper-inference/OmniRoute/pull/2477) | `5f1f8d869efdf7a0065389af9845cc6fd9b9d740` | `731e766136cfc18abc94a8987a4821d85577cda5` |

The source patches were read from `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git` as merge-to-first-parent diffs. The source fixes are metadata handling only: they neither alter token charging nor require upstream requests.

## Existing usage counters (#2350)

The source patch adds flat `usage.cached_tokens` and `usage.reasoning_tokens` as fallbacks in both non-stream OpenAI-shaped response extraction and streaming usage extraction. Existing nested cache and reasoning detail fields retain priority; the DeepSeek `prompt_cache_hit_tokens` fallback remains ahead of the new flat cache field. Prompt, completion, and total counts are not changed by these additions, and the patch contains no pricing or charge adjustment.

The current integration uses `open-sse/handlers/chatCore/requestDetail.js` and shared usage canonicalization rather than the source extractor layout. Its non-stream path accepts OpenAI-shaped usage and canonicalizes it. It deliberately recognizes DeepSeek's flat `prompt_cache_hit_tokens` as an inclusive cache count only when valid and when higher-priority cache detail is absent; reported zero and exclusive cache accounting are preserved. `tests/unit/omni-deepseek-nonstream-cache-read.test.js` asserts those boundaries and verifies projected counts. The source patch's generic flat cache/reasoning fallback is not needed to handle that DeepSeek port, and no charging behavior should be inferred from exposing additional optional metadata.

Local evidence: [`requestDetail.js`](../../../open-sse/handlers/chatCore/requestDetail.js), [`usageTracking.js`](../../../open-sse/utils/usageTracking.js), [`omni-deepseek-nonstream-cache-read.test.js`](../../../tests/unit/omni-deepseek-nonstream-cache-read.test.js), [`request-detail-usage.test.js`](../../../tests/unit/request-detail-usage.test.js).

## Client-specific stream errors (#2355)

The source patch passes the selected client response format into its stream controller. On a mid-stream transport failure it emits a Responses `response.failed` event for both Responses format names, a Claude `error` event for Claude, and the established Chat Completions error chunk followed by `[DONE]` otherwise. The Responses error classification maps rate limiting, authentication/permission, other 4xx, and server failures into protocol types and codes. The Claude mapping uses its protocol error types. The failure message comes from the caught error.

The current integration routes stream failures through `open-sse/utils/streamHelpers.js` and `open-sse/utils/stream.js`, where error content is sanitized before client output. The generic error builder emits an OpenAI-shaped error payload and `[DONE]`; Claude receives an `event: error` envelope without `[DONE]`. Translated stream failures have a dedicated Responses `response.failed` terminal envelope, with safe message/type/code fields, and the terminal tracker prevents a competing success terminal. Existing local behavior therefore covers the client-protocol distinction while retaining the repository's sanitization and terminal lifecycle. Do not treat the upstream source's direct error message interpolation as permission to expose raw provider diagnostics.

Local evidence: [`streamHelpers.js`](../../../open-sse/utils/streamHelpers.js), [`stream.js`](../../../open-sse/utils/stream.js), [`stream-abort-inband-error.test.js`](../../../tests/unit/stream-abort-inband-error.test.js), [`v5-translated-stream-error-boundaries.test.js`](../../../tests/unit/v5-translated-stream-error-boundaries.test.js), [`v5-1331-stream-error-responses-failed.test.js`](../../../tests/unit/v5-1331-stream-error-responses-failed.test.js).

## Rebuilt embeddings JSON response (#2477)

The source patch removes stale content-encoding, content-length, and transfer-encoding metadata from upstream headers on both embeddings success and upstream error returns, while retaining unrelated response metadata. The reason is that the handler consumes the upstream JSON and returns a rebuilt JSON body, so transport metadata from the consumed representation is no longer valid.

The current integration's embeddings orchestrator at `open-sse/handlers/embeddingsCore.js` likewise consumes and parses the provider response, then constructs a new `Response` from normalized JSON with a JSON content type. It does not pass through the original provider response headers. The compared stale-header concern is therefore handled structurally in this implementation; no provider header values are needed to establish that. Existing offline embeddings fixtures exercise normalized response handling, while the source patch's success/error stale-header assertions are not represented as a local pass-through-header contract.

Local evidence: [`embeddingsCore.js`](../../../open-sse/handlers/embeddingsCore.js), [`src/app/api/v1/embeddings/route.js`](../../../src/app/api/v1/embeddings/route.js), [`embeddingsCore.test.js`](../../../tests/unit/embeddingsCore.test.js), which supports normalized response handling but does not assert stale-header pass-through behavior.

## Disposition

These three first-parent patches describe already-covered response metadata concerns in a materially evolved integration. Preserve the current usage precedence and accounting semantics, sanitized client-specific terminal handling, and rebuilt embeddings JSON response. No product code or test changes are indicated by this comparison.
