# #1073 — Review current cache breakpoints and usage bounds

## Scope, Pins, and Provenance

Reviewed the two cache and usage PRs from contributor train [OmniRoute #20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) (`chore(release): contributor train e1b of 21 PRs for v3.8.55 (2026-11-21)`). Dispositions are based strictly on each named PR patch at its verified public head, excluding unrelated train changes, migrations, or release scaffolding.

| PR | Title | Exact PR head | Train merge pin | Scope |
| --- | --- | --- | --- | --- |
| [OmniRoute #19750](https://github.com/cheaper-inference/OmniRoute/pull/19750) | `perf(claude): cache the final tool-result turn of an agent loop` | [`668c18fed394f6ac14afd5e544efa1b9ef33ebff`](https://github.com/cheaper-inference/OmniRoute/commit/668c18fed394f6ac14afd5e544efa1b9ef33ebff) | Contributor train [#20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) | Claude translated request cache breakpoints |
| [OmniRoute #19949](https://github.com/cheaper-inference/OmniRoute/pull/19949) | `test(gemini): cover bounded cached input token reporting` | [`768b4aea86d4c2d1237ace8f9ee5b533dbeb524b`](https://github.com/cheaper-inference/OmniRoute/commit/768b4aea86d4c2d1237ace8f9ee5b533dbeb524b) | Contributor train [#20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) | Gemini response usage cache token bounds |

---

## 1. Claude Final Tool-Result Cache Behavior (OmniRoute #19750)

### Upstream patch mechanics
In `open-sse/translator/helpers/claudeHelper.ts`, OmniRoute #19750 adds `markedCacheControlBlocks(body)` and `markFinalToolResults(body, ttl)`. When translating an OpenAI-format tool loop to Claude (`prepareClaudeRequest`), if `!preserveCacheControl && supportsPromptCaching`, it inspects the final turn of the message history:
- If `last.role === "user"` and contains at least one `tool_result` block,
- If no block in that turn carries `cache_control` yet,
- And if the total number of marked blocks across system, tools, and messages is less than 4,
it injects an ephemeral 5-minute cache breakpoint (`{ type: "ephemeral", ttl: "5m" }`) onto the final block of that final user turn. Upstream rationalizes this as an agent-loop optimization: subsequent calls in the loop read the tool results at a 0.1x cache read rate instead of 1.0x input pricing, with the trade-off of paying a one-time 1.25x write multiplier on the tool-result turn.

### Local DurinDoor architecture and contracts
DurinDoor implements two distinct, deliberate pathways for Claude cache preparation in [`claude.js`](../../../open-sse/translator/formats/claude.js):
1. **Native Claude passthrough (`anchorClaudeCache`):** Invoked in [`chatCore.js`](../../../open-sse/handlers/chatCore.js) for native Anthropic clients.
   - As documented in [`1073-claude-outbound-tool-result-cache-markers.md`](./1073-claude-outbound-tool-result-cache-markers.md), `hoistToolResultCacheMarkers` hoists the first valid explicit nested marker from `tool_result.content` onto the enclosing `tool_result` block for verified targets (`claude`, `anthropic`).
   - Valid caller-supplied parent and nested markers are preserved up to Anthropic's four-marker cap (`capCacheControlBlocks`).
   - The gateway anchors the final system block (1h) and final cacheable tool (1h), and anchors the latest assistant turn. Only if no assistant turn exists does it anchor the latest message of any role. It does not inject unrequested breakpoints on trailing user tool results when an assistant turn is already anchored.
2. **Bridged OpenAI → Claude translation (`prepareClaudeRequest`):** Invoked in [`translator/index.js`](../../../open-sse/translator/index.js).
   - In Pass 1, all message content blocks have `cache_control` stripped (`for (const block of msg.content) delete block.cache_control`).
   - In Pass 2, the gateway reverse-scans and marks only the latest assistant message with `{ type: "ephemeral" }`, alongside system (1h) and tool (1h) anchors.
   - User messages (including trailing turns containing tool results) are intentionally left unmarked. This contract is explicitly codified and guarded in:
     - [`v5-conformance-matrix-claude.test.js`](../../../tests/translator/v5-conformance-matrix-claude.test.js): `"prepareClaudeRequest strips user-block cache_control by design; only system/tools/last assistant keep it."`
     - [`ollama-claude-regression.test.js`](../../../tests/unit/ollama-claude-regression.test.js): Contract VAL-01 (`prepareClaudeRequest strips cache_control from user content blocks`).
     - [`omni-claude-outbound-tool-result-cache-markers.test.js`](../../../tests/unit/omni-claude-outbound-tool-result-cache-markers.test.js): Bridged requests keep the marker count within budget without injecting markers on user tool turns.

### Separating explicit caller markers from speculative injection
- **Cost impact of speculative writes:** Writing a cache breakpoint incurs a 25% surcharge (1.25x write rate) on Anthropic. If the agent loop continues, reading that turn at 0.1x yields savings. However, for a single-turn tool execution or the terminal turn of an agent run with no follow-up, the caller pays an unrequested 0.25x penalty on all tool-result tokens with zero amortization.
- **Contract boundary:** DurinDoor preserves the invariant that bridged translation anchors known structural boundaries (system, tools, latest assistant turn) without guessing caller execution topology. When a native client explicitly places cache markers on `tool_result` blocks, DurinDoor honors and hoists them faithfully. Synthesizing unrequested breakpoints on user turns violates the separation between explicit caller intent and gateway behavior.

### Disposition: OmniRoute #19750
**Reject / No port.** Retain DurinDoor's existing structural anchors (system, tools, latest assistant) on bridged translation and explicit caller-marker hoisting/capping on native passthrough. Do not inject speculative heuristic cache markers on user tool-result turns.

---

## 2. Ordinary Gemini Bounded Cache Accounting (OmniRoute #19949)

### Upstream patch mechanics
In `tests/unit/nonstream-usage-cache-tokens.test.ts`, OmniRoute #19949 adds regression coverage asserting that non-streaming Gemini → OpenAI response translation enforces bounded cache token reporting:
- When `promptTokenCount: 10` and `cachedContentTokenCount: 99` (an anomalous report where cached input exceeds total prompt input), the emitted OpenAI usage object must **not** advertise an impossible cached count: `usage.prompt_tokens` is 10, and `usage.prompt_tokens_details` is `undefined` (omitted).
- When `promptTokenCount: 10` and `cachedContentTokenCount: 4` (valid in-range subset), `usage.prompt_tokens_details` emits `{ cached_tokens: 4 }`.

### Local DurinDoor architecture and contracts
- **Usage extraction:** In [`usage.js`](../../../open-sse/translator/concerns/usage.js), `USAGE_EXTRACTORS.gemini(raw)` extracts:
  ```javascript
  const cached = n(raw.cachedContentTokenCount);
  const prompt = n(raw.promptTokenCount);
  ```
  It returns `{ promptTokens: prompt, completionTokens: ..., totalTokens: ..., cachedTokens: cached, reasoningTokens: thoughts }`.
- **OpenAI usage builder:** `buildUsage()` in [`usage.js`](../../../open-sse/translator/concerns/usage.js) attaches details whenever `cachedTokens > 0`:
  ```javascript
  if (cachedTokens > 0 || cacheCreationTokens > 0) {
    usage.prompt_tokens_details = {};
    if (cachedTokens > 0) usage.prompt_tokens_details.cached_tokens = cachedTokens;
  }
  ```
- **Local discrepancy:** Unlike `USAGE_EXTRACTORS.ollama(raw)` (which explicitly clamps `cached = Number.isFinite(input) ? Math.min(cachedRaw, input) : cachedRaw;`), the Gemini extractor does not validate `cachedContentTokenCount <= promptTokenCount`. If an upstream Gemini response reports `promptTokenCount: 10` and `cachedContentTokenCount: 99`, DurinDoor currently emits:
  `{ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 99 } }`.
  In OpenAI's usage contract, `prompt_tokens_details.cached_tokens` is an inclusive subset of `prompt_tokens`. Emitting a cached count larger than `prompt_tokens` violates this invariant and breaks strict client schemas.
- **Internal cost calculation resilience:** In [`pricing.js`](../../../open-sse/providers/pricing.js), local accounting computes `nonCachedInput = Math.max(0, inputTokens - cachedTokens - cacheCreationTokens);`, which prevents negative input costs internally. However, the external OpenAI-compatible JSON and SSE streams emitted via [`nonStreamingHandler.js`](../../../open-sse/handlers/chatCore/nonStreamingHandler.js) and [`gemini-to-openai.js`](../../../open-sse/translator/response/gemini-to-openai.js) still expose the unbounded raw value.
- **Invariants preserved:** Enforcing that `cachedContentTokenCount` cannot exceed `promptTokenCount` (suppressing `prompt_tokens_details` or omitting `cached_tokens` when out-of-bounds) preserves output tokens, completion token counts, reasoning tokens (`thoughtsTokenCount`), candidate text, and selected turn identity across both non-streaming and streaming dispatch without sending provider traffic.

### Disposition: OmniRoute #19949
**Adopt / Gap identified.** Adopt bounded Gemini cache accounting in [`usage.js`](../../../open-sse/translator/concerns/usage.js). When upstream Gemini reports `cachedContentTokenCount > promptTokenCount`, the out-of-bounds cached count must be suppressed (omitting `prompt_tokens_details`), while valid in-range counts remain visible.

---

## 3. Dispositions Summary

| PR | Exact PR head | Train | Feature / Contract | Disposition |
| --- | --- | --- | --- | --- |
| [OmniRoute #19750](https://github.com/cheaper-inference/OmniRoute/pull/19750) | [`668c18fed394f6ac14afd5e544efa1b9ef33ebff`](https://github.com/cheaper-inference/OmniRoute/commit/668c18fed394f6ac14afd5e544efa1b9ef33ebff) | Contributor train [#20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) | Heuristic 5m cache marker on final tool-result turn | **Reject / No port.** Keep explicit caller-marker hoisting and structural anchors; do not guess or inject speculative user-turn breakpoints. |
| [OmniRoute #19949](https://github.com/cheaper-inference/OmniRoute/pull/19949) | [`768b4aea86d4c2d1237ace8f9ee5b533dbeb524b`](https://github.com/cheaper-inference/OmniRoute/commit/768b4aea86d4c2d1237ace8f9ee5b533dbeb524b) | Contributor train [#20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) | Bounded Gemini `cachedContentTokenCount` accounting | **Adopt / Gap identified.** Suppress `prompt_tokens_details` when `cachedContentTokenCount > promptTokenCount`; preserve valid in-range counts. |

---

## 4. Ordinary Acceptance and Verification

For any follow-up implementation of the #19949 bounded Gemini cache accounting:
1. **Out-of-bounds Gemini cache counts:** An upstream non-streaming or streaming Gemini response fixture with `promptTokenCount: 10` and `cachedContentTokenCount: 99` must translate to OpenAI format with `prompt_tokens: 10` and `prompt_tokens_details: undefined` (omitted from `usage`).
2. **Valid in-range Gemini cache counts:** An upstream Gemini response fixture with `promptTokenCount: 10` and `cachedContentTokenCount: 4` must translate to OpenAI format with `prompt_tokens: 10` and `prompt_tokens_details: { cached_tokens: 4 }`.
3. **Preservation of output tokens and identity:** `candidatesTokenCount`, derived completion tokens, `thoughtsTokenCount` / `completion_tokens_details.reasoning_tokens`, candidate text parts, and message index/finish reasons must remain unaltered.
4. **Preservation of existing Claude contracts:** Existing Claude cache fixtures in [`omni-claude-outbound-tool-result-cache-markers.test.js`](../../../tests/unit/omni-claude-outbound-tool-result-cache-markers.test.js), [`claude-cache-control.test.js`](../../../tests/unit/claude-cache-control.test.js), and [`v5-conformance-matrix-claude.test.js`](../../../tests/translator/v5-conformance-matrix-claude.test.js) must remain passing with no injected user-turn breakpoints.
5. **Offline execution:** Validation must run offline using mock fixtures without live network requests, credentials, Docker, or paid API traffic.
