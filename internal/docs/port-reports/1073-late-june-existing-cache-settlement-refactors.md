# #1073 — Late-June existing semantic cache, guardrail, and usage settlement refactors

## Scope and source pins

This report reviews four late-June 2026 OmniRoute pull requests from the `#3501` `chatCore` god-file decomposition series against current DurinDoor source, stream versus nonstream settlement behavior, and offline test fixtures.

Each source patch was evaluated using its exact PR head commit and base parent in the public mirror. For each row, the enclosing merge is an identical single-parent squash commit into upstream's release branch (`release/v3.8.36`) carrying the byte-identical patch (`git patch-id --stable` matches across head and enclosing merge).

| Source PR | Exact PR head | Enclosing merge | PR base (merge parent) | Landed upstream patch scope |
| --- | --- | --- | --- | --- |
| [OmniRoute #4828](https://github.com/cheaper-inference/OmniRoute/pull/4828) | [`3f9cdb25f48ff7ed63ad9f52c1a0d214807a437a`](https://github.com/cheaper-inference/OmniRoute/commit/3f9cdb25f48ff7ed63ad9f52c1a0d214807a437a) | [`1244e4903b9d30c4add8384897b1de5678dfe170`](https://github.com/cheaper-inference/OmniRoute/commit/1244e4903b9d30c4add8384897b1de5678dfe170) | `5c0b29e2b3707aee9adf255330c798eb9f222444` | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/semanticCacheStore.ts` (new), `tests/unit/chatcore-semantic-cache-store.test.ts` (new) (`+121 / -17`) |
| [OmniRoute #4829](https://github.com/cheaper-inference/OmniRoute/pull/4829) | [`19eb4fde41acaffad728913cb704986f8739138a`](https://github.com/cheaper-inference/OmniRoute/commit/19eb4fde41acaffad728913cb704986f8739138a) | [`2cd5609628e9083e7bfef3513feda472b7ba9ab7`](https://github.com/cheaper-inference/OmniRoute/commit/2cd5609628e9083e7bfef3513feda472b7ba9ab7) | `e87d35ceda48e5082fa20c9ffba72574f49740fb` | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/streamingSemanticCacheStore.ts` (new), `tests/unit/chatcore-streaming-cache-store.test.ts` (new) (`+192 / -27`) |
| [OmniRoute #4831](https://github.com/cheaper-inference/OmniRoute/pull/4831) | [`0e4d4760fc7f61d3d5eef6b57f836a87a60b0a64`](https://github.com/cheaper-inference/OmniRoute/commit/0e4d4760fc7f61d3d5eef6b57f836a87a60b0a64) | [`5c0b29e2b3707aee9adf255330c798eb9f222444`](https://github.com/cheaper-inference/OmniRoute/commit/5c0b29e2b3707aee9adf255330c798eb9f222444) | `e85fb9bb5d9fdb870addada0540ab0e5f2934410` | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/postCallGuardrailContext.ts` (new), `tests/unit/chatcore-postcall-guardrail-context.test.ts` (new) (`+121 / -17`) |
| [OmniRoute #4832](https://github.com/cheaper-inference/OmniRoute/pull/4832) | [`270e4ab8fbcdeed5ea75a4b49cb1707cd381595f`](https://github.com/cheaper-inference/OmniRoute/commit/270e4ab8fbcdeed5ea75a4b49cb1707cd381595f) | [`e85fb9bb5d9fdb870addada0540ab0e5f2934410`](https://github.com/cheaper-inference/OmniRoute/commit/e85fb9bb5d9fdb870addada0540ab0e5f2934410) | `eb1920bf918decd8e49939cf51021e644b2705a1` | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/clientUsageBuffer.ts` (new), `tests/unit/chatcore-client-usage-buffer.test.ts` (new) (`+134 / -15`) |

---

## Architecture and ownership comparison

### 1. Semantic cache: non-streaming and streaming writes (#4828, #4829)

- **Upstream contract**:
  - In upstream OmniRoute, `handleChatCore` integrates with a semantic cache database (`@/lib/semanticCache`).
  - For non-streaming requests (Phase 9.1, PR #4828), when `semanticCacheEnabled` is active, `isCacheableForWrite` returns true, and `isSmallEnoughForSemanticCache` passes, upstream derives a cache signature from `(model, messages ?? input, temperature, top_p, apiKeyId)` and writes the translated JSON response to disk/KV via `setCachedResponse(signature, model, translatedResponse, tokensSaved)`.
  - For streaming requests (PR #4829), the `onStreamComplete` callback collects the assembled streaming response (`streamResponseBody`), removes the internal `_streamed` flag, checks size bounds, and writes the assembled body to the semantic cache with prompt and completion tokens recorded as `tokensSaved`.
  - Both PR #4828 and PR #4829 are pure structural extractions into leaf files (`semanticCacheStore.ts` and `streamingSemanticCacheStore.ts`) with injected dependencies for unit testing. Neither patch introduced a behavioral change in OmniRoute.

- **DurinDoor ownership & privacy model**:
  - DurinDoor does not maintain a semantic cache subsystem. Neither `@/lib/semanticCache`, `setCachedResponse`, nor `generateSignature` exists in DurinDoor.
  - In DurinDoor, prompt text, user messages, and model completions are never stored in a semantic or vector database for cross-request cache replay. DurinDoor's data model enforces strict local privacy and bounded retention: request payloads are ephemeral in memory during request execution, and request logging explicitly redacts former payload fields upon API inspection ([`tests/unit/usage-request-details-redaction.test.js`](../../../tests/unit/usage-request-details-redaction.test.js)).
  - Non-streaming responses in [`open-sse/handlers/chatCore/nonStreamingHandler.js`](../../../open-sse/handlers/chatCore/nonStreamingHandler.js) and streaming responses in [`open-sse/handlers/chatCore/streamingHandler.js`](../../../open-sse/handlers/chatCore/streamingHandler.js) / [`open-sse/utils/stream.js`](../../../open-sse/utils/stream.js) perform transport translation, usage attribution, and metric accounting without writing response payloads to any semantic cache store.
  - Local caching in DurinDoor is restricted to operator proxy configurations ([`open-sse/handlers/chatCore/comboContextCache.js`](../../../open-sse/handlers/chatCore/comboContextCache.js)) and database read caches (`src/lib/db/readCache.js`), which contain configuration only and zero user conversation payloads.

### 2. Post-call guardrail context builder (#4831)

- **Upstream contract**:
  - Upstream OmniRoute maintains a pluggable `guardrailRegistry` with lifecycle hooks.
  - On the non-streaming success path, upstream builds a `guardrailContext` object containing `apiKeyInfo`, `disabledGuardrails` (resolved from request headers and body), `endpoint`, `headers`, `log`, `method: "POST"`, `model`, `provider`, `sourceFormat`, `stream: false`, and `targetFormat`, which is passed to `guardrailRegistry.runPostCallHooks(translatedResponse, guardrailContext)`.
  - PR #4831 extracted this object construction from `chatCore.ts` into `open-sse/handlers/chatCore/postCallGuardrailContext.ts` with injectable `resolveDisabledGuardrails`. This was an unchanged extraction with zero runtime behavioral delta.

- **DurinDoor ownership & protocol fidelity model**:
  - DurinDoor does not implement `guardrailRegistry` or arbitrary pre-/post-call hook execution pipelines.
  - Local guardrails in DurinDoor are strict protocol and transport safeguards rather than arbitrary content mutation hooks:
    1. [`open-sse/handlers/chatCore/executorResultGuard.js`](../../../open-sse/handlers/chatCore/executorResultGuard.js) ensures executor return values satisfy the `Response` interface and preserve execution metadata without dropping fields.
    2. [`open-sse/handlers/chatCore/emptyStreamGuard.js`](../../../open-sse/handlers/chatCore/emptyStreamGuard.js) and [`open-sse/handlers/chatCore/streamingHandler.js`](../../../open-sse/handlers/chatCore/streamingHandler.js) detect empty streams and classify provider failures versus authentic refusals.
    3. [`open-sse/services/compression/fidelityGate.js`](../../../open-sse/services/compression/fidelityGate.js) guards text invariants and system prompt preservation during compression passes.
    4. [`src/shared/utils/ssrfGuard.js`](../../../src/shared/utils/ssrfGuard.js) enforces local network boundary controls.
  - DurinDoor preserves the authentic upstream model response without post-call proxy mutations or hook-induced latency.

### 3. Client usage buffering and estimation (#4832)

- **Upstream contract**:
  - In upstream OmniRoute, `handleChatCore` applies usage buffering and format filtering on non-streaming responses.
  - When `translatedResponse?.usage` exists, it calls `addBufferToUsage(translatedResponse.usage)` and filters fields for the client's format with `filterUsageForFormat(buffered, clientResponseFormat)`.
  - When `translatedResponse?.usage` is omitted, it computes `contentLength = JSON.stringify(translatedResponse?.choices?.[0]?.message?.content || "").length` and, if `contentLength > 0`, synthesizes an estimated usage object with `estimateUsage(body, contentLength, clientResponseFormat)` followed by `filterUsageForFormat`.
  - PR #4832 extracted this inline block into `open-sse/handlers/chatCore/clientUsageBuffer.ts` with injectable dependencies for unit tests.

- **DurinDoor ownership & stream vs. nonstream behavior**:
  - In DurinDoor, non-streaming response handling is already modularized into [`open-sse/handlers/chatCore/nonStreamingHandler.js`](../../../open-sse/handlers/chatCore/nonStreamingHandler.js) (lines 813–818):
    ```javascript
    if (!isClaudeMessageResponse && translatedResponse?.usage) {
      translatedResponse.usage = filterUsageForFormat(
        enrichUsageCost(addBufferToUsage(translatedResponse.usage, provider), provider, model),
        sourceFormat
      );
    }
    ```
  - **Buffer tokens**: DurinDoor applies `addBufferToUsage` and `filterUsageForFormat` from [`open-sse/utils/usageTracking.js`](../../../open-sse/utils/usageTracking.js), with additional provider-aware logic: passing `provider` allows providers like Gemini Interactions (`GEMINI_INTERACTIONS_ID`) to bypass buffer inflation and preserve raw receipts, while wrapping with `enrichUsageCost` attaches currency and micro-cent cost breakdowns.
  - **Format preservation**: Native Claude message responses (`isClaudeMessageResponse`) are explicitly excluded from synthetic OpenAI-style buffer inflation in non-streaming mode to maintain Anthropic client schema conformance.
  - **Stream vs. nonstream estimation**:
    - In DurinDoor streaming ([`open-sse/utils/stream.js`](../../../open-sse/utils/stream.js)), `estimateUsage` is injected when an upstream stream emits a finish chunk without token usage, and real terminal usage replaces the estimate once received ([`tests/unit/stream-usage-replaces-estimate.test.js`](../../../tests/unit/stream-usage-replaces-estimate.test.js)).
    - In non-streaming mode ([`open-sse/handlers/chatCore/nonStreamingHandler.js`](../../../open-sse/handlers/chatCore/nonStreamingHandler.js)), if an upstream provider omits the `usage` block, DurinDoor does not fabricate an estimated token count on the HTTP response. Upstream omission is preserved, preventing synthetic numbers from polluting client-side billing or tool-call assertions.
  - DurinDoor's existing modular design already isolates non-streaming response finalization; extracting an OmniRoute-style `clientUsageBuffer.ts` leaf would be redundant.

---

## Dispositions

| Source PR | Subject | Disposition |
| --- | --- | --- |
| [OmniRoute #4828](https://github.com/cheaper-inference/OmniRoute/pull/4828) | `refactor(chatCore): extrai storeSemanticCacheResponse (cache-store non-streaming, #3501)` | **Do not port (upstream-only refactoring of absent semantic-cache subsystem; privacy and storage preservation).** |
| [OmniRoute #4829](https://github.com/cheaper-inference/OmniRoute/pull/4829) | `refactor(chatCore): extrai storeStreamingSemanticCacheResponse (cache-store streaming, #3501)` | **Do not port (upstream-only refactoring of absent streaming semantic-cache subsystem; privacy and storage preservation).** |
| [OmniRoute #4831](https://github.com/cheaper-inference/OmniRoute/pull/4831) | `refactor(chatCore): extrai buildPostCallGuardrailContext (contexto guardrail post-call, #3501)` | **Do not port (upstream-only refactoring of absent post-call guardrail hook context; protocol fidelity preservation).** |
| [OmniRoute #4832](https://github.com/cheaper-inference/OmniRoute/pull/4832) | `refactor(chatCore): extrai applyClientUsageBuffer (buffer/estimate de usage non-streaming, #3501)` | **Already in (adapted); no port of helper extraction.** Existing local usage buffering in `nonStreamingHandler.js` and streaming usage estimation in `stream.js` implement the applicable contracts with provider-aware safeguards (Gemini Interactions exception, Claude message preservation, and cost enrichment). |

### PR-specific analysis

#### OmniRoute #4828
- **Upstream patch**: Extracted non-streaming cache write into `open-sse/handlers/chatCore/semanticCacheStore.ts`.
- **Reasoning**: Upstream's patch is a pure refactor of an existing cache-writing feature. DurinDoor does not implement semantic caching of request and response payloads, ensuring prompt privacy and eliminating unneeded database storage. Because the underlying subsystem does not exist in DurinDoor, the extracted helper has no target or utility.

#### OmniRoute #4829
- **Upstream patch**: Extracted streaming cache store from `onStreamComplete` into `open-sse/handlers/chatCore/streamingSemanticCacheStore.ts`.
- **Reasoning**: DurinDoor's streaming completion callback (`onStreamComplete` in [`open-sse/handlers/chatCore/streamingHandler.js`](../../../open-sse/handlers/chatCore/streamingHandler.js)) handles latency metrics, credential redaction, request logging, and billing usage persistence. It deliberately does not assemble or store streaming payloads into a semantic cache. Porting this extraction is inapplicable to DurinDoor.

#### OmniRoute #4831
- **Upstream patch**: Extracted post-call guardrail context builder into `open-sse/handlers/chatCore/postCallGuardrailContext.ts`.
- **Reasoning**: DurinDoor intentionally omits arbitrary post-call guardrail hooks in favor of direct proxy fidelity and lightweight protocol-level error/format guards. Upstream's refactor is an internal extraction for a guardrail execution pipeline not present in this codebase.

#### OmniRoute #4832
- **Upstream patch**: Extracted `applyClientUsageBuffer` into `open-sse/handlers/chatCore/clientUsageBuffer.ts`.
- **Reasoning**: DurinDoor already owns non-streaming client usage buffering and formatting in [`open-sse/handlers/chatCore/nonStreamingHandler.js`](../../../open-sse/handlers/chatCore/nonStreamingHandler.js), with additional checks for Gemini Interactions receipt passthrough and native Claude message handling. Streaming usage estimation is owned by [`open-sse/utils/stream.js`](../../../open-sse/utils/stream.js) and covered by existing regression tests. Creating a separate leaf module would fragment local handler ownership without adding functional capability.

---

## Existing fixture evidence

Current DurinDoor test fixtures verify usage buffering, streaming and non-streaming settlement, and privacy boundaries under offline test conditions:

1. **Usage estimation and replacement**:
   - [`tests/unit/stream-usage-replaces-estimate.test.js`](../../../tests/unit/stream-usage-replaces-estimate.test.js): verifies that authoritative upstream usage replaces synthetic estimated usage instead of max-merging, while preserving the `estimated: true` marker when an estimate remains active.
   - [`tests/unit/synthetic-usage.test.js`](../../../tests/unit/synthetic-usage.test.js): covers synthetic token derivation across supported provider formats.

2. **Usage buffering and accounting**:
   - [`tests/unit/reasoning-token-buffer-6714.test.js`](../../../tests/unit/reasoning-token-buffer-6714.test.js): verifies model-specific reasoning token buffer caps and output headroom resolution.
   - [`tests/unit/request-detail-usage.test.js`](../../../tests/unit/request-detail-usage.test.js): exercises `buildRequestDetail` and `extractUsageFromResponse` for non-streaming response bodies.

3. **Streaming lifecycle and settlement**:
   - [`tests/unit/chat-stream-success-lifecycle.test.js`](../../../tests/unit/chat-stream-success-lifecycle.test.js): verifies completion callback ordering and final response settlement without cache-store overhead.
   - [`tests/unit/empty-stream-guard.test.js`](../../../tests/unit/empty-stream-guard.test.js): tests stream completion classification, differentiating genuine upstream failures from coherent zero-token completions.

4. **Privacy and payload redaction**:
   - [`tests/unit/usage-request-details-redaction.test.js`](../../../tests/unit/usage-request-details-redaction.test.js): confirms that stored request and response payloads are redacted when queried via administrative APIs, ensuring zero user prompt or completion leakage.

---

## Ordinary offline acceptance for non-streaming usage estimation

The only behavioral distinction between upstream's usage conversion and DurinDoor's non-streaming handler is upstream's fallback estimation when an upstream non-streaming response completely omits the `usage` block.

If an operator or client configuration ever requires synthetic usage estimation for non-streaming responses lacking a usage block, ordinary offline acceptance can be verified with a focused offline test in [`tests/unit/nonstream-json-contracts-10258.test.js`](../../../tests/unit/nonstream-json-contracts-10258.test.js) without network or provider credentials:

- **Scenario A (Usage block present)**:
  - Input: Non-streaming JSON response containing `{ id: "test-1", choices: [...], usage: { prompt_tokens: 20, completion_tokens: 10 } }`.
  - Verification: `addBufferToUsage` adds `BUFFER_TOKENS` to `prompt_tokens` and recalculates `total_tokens`; `filterUsageForFormat` filters fields for `sourceFormat`; choice text and finish reason remain unchanged.
- **Scenario B (Provider-specific bypass)**:
  - Input: Response with `provider === "interactions"` (Gemini Interactions).
  - Verification: `addBufferToUsage` returns the raw receipt unchanged.
- **Scenario C (Native Claude message preservation)**:
  - Input: Response with `sourceFormat === FORMATS.CLAUDE` and `type === "message"`.
  - Verification: `nonStreamingHandler.js` bypasses `addBufferToUsage`, preserving the raw Claude `input_tokens` and `output_tokens` counts.
- **Scenario D (Usage block omitted)**:
  - Input: Non-streaming JSON response with `{ id: "test-2", choices: [{ message: { content: "Sample output" } }] }` and no `usage` property.
  - Verification: Under current DurinDoor behavior, `translatedResponse.usage` remains `undefined` (preserving upstream omission without fabricating token counts). If fallback estimation were enabled, assert `estimateUsage(body, contentLength, sourceFormat)` produces an object with `estimated: true`, `prompt_tokens > 0`, and `completion_tokens > 0` filtered for `sourceFormat`, while choices content remains identical.
- **Test execution**: Run directly with `node node_modules/vitest/vitest.mjs run tests/unit/nonstream-json-contracts-10258.test.js --maxWorkers=2`.
