# Upstream #3236 — Responses Empty Tool Calls — 2026-08-11

Scope: `decolua/9router` PR [#3236](https://github.com/decolua/9router/pull/3236),
`fix(responses): don't close message on empty tool_calls array`.

| Change | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| Do not close Responses output text for `delta.tool_calls: []` | PORTED | `openaiToOpenAIResponsesResponse` treated any truthy `tool_calls` value as a real call. Empty arrays are truthy, closing `response.output_text` on the first content chunk. | Require a non-empty array before closing the message and emitting tool-call events. |
| Streaming regression coverage | PORTED | A multi-chunk stream with empty arrays now preserves `codex-ok` until terminal `finish_reason`; a non-empty call still closes text before `function_call` output. | Added focused translator test. |

## Verification

- RED: `tests/unit/openai-responses-empty-toolcalls.test.js` failed with expected
  `expected 'cod' to be 'codex-ok'` before the guard.
- GREEN: focused test passed 2/2; full `tests && npm run test:ci` reported `Raw failures: 0`; lint and production build exited 0; docs integrity passed; `tests/__baseline__/known-fails.txt` was unchanged.
