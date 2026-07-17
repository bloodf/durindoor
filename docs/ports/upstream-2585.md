# Port log: upstream 9router PR #2585

- **Source:** https://github.com/decolua/9router/pull/2585
- **Port branch:** `port/upstream-2585`

## Behavior ported

Non-streaming `/v1/messages` requests now preserve Claude response format when routing through a non-Claude provider. Provider responses normalized to OpenAI Chat Completions are reverse-projected into Claude Messages JSON instead of leaking the intermediate format.

## DurinDoor adaptation

`handleNonStreamingResponse` reverse-projects the OpenAI completion with `translateOpenAIToClaudeIfNeeded`, then `normalizeClaudeCacheUsage` copies cache usage fields without subtracting them from `input_tokens`. The emitted `/v1/messages` response preserves routed model and Claude ID, content-block, stop-reason, and usage semantics.

## Files (6)

- `open-sse/handlers/chatCore/nonStreamingHandler.js`
- `open-sse/handlers/chatCore/sseToJsonHandler.js`
- `open-sse/translator/response/openai-to-claude-json.js`
- `open-sse/translator/response/completionProjector.js`
- `tests/unit/non-streaming-forced-client-sse.test.js`
- `docs/ports/upstream-2585.md`

## Verification

```text
cd tests && node node_modules/vitest/vitest.mjs run --config vitest.config.js unit/non-streaming-forced-client-sse.test.js unit/sse-to-json-claude-compat.test.js
Test Files  2 passed (2)
Tests       28 passed (28)
```
