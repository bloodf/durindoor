# Upstream #3217 — `prompt_cache_key` Chat→Responses Forward (2026-08-11)

Single-PR port of [`decolua/9router#3217`](https://github.com/decolua/9router/pull/3217)
into the DurinDoor fork. Anchors live in
[`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3217](https://github.com/decolua/9router/pull/3217) `fix(responses): forward prompt_cache_key from chat requests` | PORTED | `openaiToOpenAIResponsesRequest` (translator, `open-sse/translator/request/openai-responses.js:288`) built a fresh `result` (`model`, `input`, `stream`, `store`) and only copied `temperature` / `max_tokens` / `top_p` / `reasoning` / `reasoning_effort` / `service_tier`. A client-supplied `prompt_cache_key` on a Chat Completions request was therefore silently dropped before the `/v1/responses` call and prompt caching never engaged. The companion `openaiResponsesToOpenAIRequest` keeps its deliberate `delete result.prompt_cache_key` (line 261) so the Responses→Chat path still drops the key for non-OpenAI providers. | Forward the key only when the client actually supplied it: `if (body.prompt_cache_key !== undefined) result.prompt_cache_key = body.prompt_cache_key;` placed at the end of the pass-through block, mirroring the `service_tier` line directly above. Tests in `tests/unit/openai-responses-strip-fields.test.js` (`openaiToOpenAIResponsesRequest — prompt cache key` describe). |

## Adaptations

- **Location of the new line.** The upstream diff inserts the line immediately after the existing `return result;` in the source view (i.e. it is the final statement in the function). This fork places it at the end of the existing pass-through block, immediately after `service_tier`, to keep the "client-supplied → forwarded" rules visually grouped and to avoid re-opening the function after the `stripOrphanedToolOutputs(result.input)` cleanup. The behaviour is identical: the line runs before `return result;`.
- **Guard semantics.** Both files agree on the `!== undefined` guard so a missing key produces no property at all (instead of `null` / `""`). This preserves the prior shape of `result` for callers that key off `'prompt_cache_key' in body` vs. `result.prompt_cache_key`.
- **Responses→Chat direction untouched.** `openaiResponsesToOpenAIRequest:261` still `delete result.prompt_cache_key;`. The `openai-responses-strip-fields.test.js` "already-handled fields" case (line 41) continues to assert the key is gone in the Responses→Chat direction, locking the asymmetry in.

## Verification

- `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/openai-responses-strip-fields.test.js`
  - RED (1 failing) before the source change: `AssertionError: expected undefined to be 'stable-cache-key' // Object.is equality` in `openaiToOpenAIResponsesRequest — prompt cache key > preserves a supplied prompt cache key` at `tests/unit/openai-responses-strip-fields.test.js:78:37`.
  - GREEN after the source change: `Test Files  1 passed (1)` / `Tests  8 passed (8)` (6 pre-existing + 2 new). All strip-field invariants, including `expect(result).not.toHaveProperty("prompt_cache_key")` in the Responses→Chat case, remain passing.
- Revert proof: removing the new line returns the file to the failing-RED state above; the omit-when-absent and Responses→Chat cases continue to pass.
