# Port: upstream #2541 — `application/x-ndjson` streaming for ollama-local

Source: `decolua/9router` PR #2541 (issue #2386).

## Behavior

Ollama's native `/api/chat` streams `application/x-ndjson` (raw JSON lines, never SSE). Before this port, `handleStreamingResponse` treated that content-type as an upstream error page and blocked it with a synthetic JSON error.

Two changes:

1. **`open-sse/handlers/chatCore/streamingHandler.js`** — the non-SSE guard now accepts `application/x-ndjson` when `targetFormat === FORMATS.OLLAMA`, letting the translate-mode transform stream convert Ollama NDJSON to the client's SSE format. The blocked-page branch also returns the shared `createErrorResult(status, message)` shape so `status`/`error` survive to fallback logging (`markAccountUnavailable`) instead of being silently dropped by a locally built `{ success, response }` object.

2. **`open-sse/utils/ollamaTransform.js`** (`transformToOllama`, used by the Ollama-compat `/api/v1/api/chat` route) — that route can receive EITHER OpenAI SSE OR native Ollama NDJSON mislabeled `text/event-stream` (ollama-local passthrough wraps the body with SSE headers), so the transform sniffs each line instead of trusting content-type:
   - `data: {...}` / `data: [DONE]` → converted to Ollama NDJSON message chunks (pre-existing behavior, preserved).
   - Bare Ollama-shaped NDJSON objects (message chunks and `{done: ...}` frames) → forwarded unchanged. Native `{error: ...}` frames are not forwarded unchanged; they are normalized to the same wire shape below.
   - A buffered OpenAI chat-completion object (the route's `stream:false` path returns one JSON object) → projected to a native Ollama non-stream response via `projectCompletionToClientFormat(..., FORMATS.OLLAMA)` and terminal.
   - Any other bare JSON (OpenAI-style streaming fragments, arrays, arbitrary objects) → dropped, never leaked to Ollama clients as mixed-format lines.
   - SSE `data: {"error":...}` and bare NDJSON `{"error":...}` frames (including internal `{error: {message, type, code}}` shapes) → normalized to an Ollama-native `{"error":"..."}` frame. An error frame is terminal on its own and suppresses any synthetic `done:true`, so failed streams never look like clean completions.
   - SSE control lines (`event:`, `:` comments, blanks) → ignored.
   - Terminal `{done:true}` is emitted exactly once — from `[DONE]`, a `finish_reason`, an upstream `done:true`, or flush — never duplicated. An upstream error frame also suppresses synthetic `done:true`.
   - One persistent streaming `TextDecoder` handles multi-byte UTF-8 split across chunks; `flush` processes a final unterminated line; the upstream HTTP status is preserved on the response.

## Files

Production:
- `open-sse/handlers/chatCore/streamingHandler.js`
- `open-sse/utils/ollamaTransform.js`

Tests:
- `tests/unit/ollama-ndjson-transform.test.js` (new — focused cases: SSE conversion preserved, NDJSON passthrough, error normalization, terminal-once, UTF-8 split, flush residual line, status preservation, buffered OpenAI completion projection)
- `tests/unit/chat-body-lifecycle.test.js` (new case — real `handleStreamingResponse` with `application/x-ndjson; charset=utf-8`, `targetFormat: OLLAMA` → `sourceFormat: OPENAI`; asserts success, no error, `chat.completion.chunk`, content, `finish_reason: stop`)

Docs:
- `docs/ports/upstream-2541.md` (this file)
- `CHANGELOG.md` Unreleased bullet (user-visible fix)

## Not ported

The same upstream PR also touched `src/sse/services/auth.js` (`safeStringifyError` in `markAccountUnavailable`). That hardening is a separate concern from the NDJSON stream path this assignment targets, so it is intentionally left out.

## Verification

```
cd tests && node node_modules/vitest/vitest.mjs run --config vitest.config.js \
  unit/chat-body-lifecycle.test.js unit/ollama-ndjson-transform.test.js
```
(Run locally under pinned Node v20.20.2 using the main checkout's `tests/node_modules`; result below.)
Result: 2 files, 27/27 tests passed (Node v20.20.2). Gates (lint/build/full suite) intentionally not run — orchestrator runs them at integration.
