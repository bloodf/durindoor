# OmniRoute #6965 — defer `/v1/responses` completion for trailing usage

Port of [diegosouzapw/OmniRoute#6965](https://github.com/diegosouzapw/OmniRoute/pull/6965) (fixes #6906).

## Behavior

With `stream_options.include_usage: true`, real OpenAI-compatible upstreams send the
usage-only chunk (`choices: []`, `usage: {...}`) **after** the `finish_reason` chunk.
Previously `response.completed` fired at `finish_reason`, so the emitted event carried
no usage.

Now, in both `open-sse/transformer/responsesTransformer.js` and
`open-sse/translator/response/openai-responses.js`:

- `finish_reason` with usage already captured (same chunk or earlier) → complete
  immediately, unchanged.
- `finish_reason` without usage → set `awaitingTrailingUsage` and defer
  `response.completed` until the trailing usage-only chunk arrives. The deferred
  completion fires only when usage was actually captured (`state.usage` truthy) — a
  bare `choices: []` chunk never completes early.
- Stream end with no trailing usage chunk → the flush fallback (`null` chunk /
  transform `flush()`) still emits exactly one `response.completed`.
- `completedSent` guards against duplicate completion in all paths.

Tool calls (standard `function_call`, and `custom_tool_call` on the
Responses→OpenAI side) are unaffected: tool items close before completion is
deferred or sent.

## Focused test

```
cd tests && node node_modules/vitest/vitest.mjs run unit/responses-usage-trailing-6965.test.js
```

Covers: split finish/usage (translator + transformer), same-chunk finish+usage,
bare empty-choices chunk without usage ignored, flush fallback, no duplicate
`response.completed`, registration path via `translateResponse`, tool-call and
custom-tool preservation.
