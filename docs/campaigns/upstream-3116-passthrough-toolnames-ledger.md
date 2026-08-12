# Upstream #3116 — Passthrough OpenAI Tool-Name Decloaking (2026-08-11)

The remaining piece of `decolua/9router` #3116 that did not land with the
`normalizeOpenAIToolNames` / `normalizeNvidiaToolCallIds` executor ports. The
helper `restoreOpenAIToolNames` already exists in
`open-sse/translator/concerns/toolCall.js`; `chatCore` already threads the
`toolNameMap` into `createPassthroughStreamWithLogger`; the claude passthrough
branch already decloaks `content_block_start` `tool_use` names. The OpenAI
passthrough branch never called the restorer, so a 64-char / charset-safe
NVIDIA alias leaked verbatim to the client, who could not match it to a tool
it declared.

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [decolua/9router#3116](https://github.com/decolua/9router/pull/3116) — passthrough OpenAI `tool_calls` decloak | PORTED | `open-sse/utils/stream.js` (passthrough block, `data:` line parse at ~line 295) mirrored the Claude `content_block_start` decloak branch (~lines 318-325) but never invoked `restoreOpenAIToolNames` for `choices[].delta.tool_calls[].function.name`. `toolNameMap` is already threaded through `createPassthroughStreamWithLogger` (line 1042) but unused. NVIDIA-style 64-char / charset-safe aliases escaped to the client. | Call `restoreOpenAIToolNames(parsed, toolNameMap)` on every parsed `data:` chunk in passthrough mode, reusing the existing `toolNameDecloaked` flag to force the `output` rewrite path. Tests in `tests/unit/openai-passthrough-decloak.test.js`. |

## Adaptations

- **Single helper, both branches.** Reused the existing
  `restoreOpenAIToolNames` from `open-sse/translator/concerns/toolCall.js`
  rather than duplicating the `aliases.has(name)` walk beside the Claude
  block. Upstream's PR was structured the same way after follow-up review.
- **Pass-through, not translate.** The decloak is intentionally scoped to
  `STREAM_MODE.PASSTHROUGH`; `STREAM_MODE.TRANSLATE` already applies
  `toolNameMap` in `translateResponse`, so re-applying here would double-
  restore and corrupt non-cloaked names. Mirrors the Claude branch, which is
  also passthrough-only.
- **No new dependencies.** Uses the helper that already exists; no new
  imports beyond `restoreOpenAIToolNames`. `getOpenAIResponsesEventName`
  / NVIDIA work is untouched.

## Verification

- RED: `tests/unit/openai-passthrough-decloak.test.js` — `restores normalized
  tool-call names` failed with the alias escaping the chunk (`name` =
  `find_files_abc123` in the emitted `data:` payload).
- GREEN: same test plus the `leaves OpenAI chunks untouched without a
  tool-name map` no-map case. Both claude decloak tests still pass (no
  regression on the sibling branch). Combined: 2 files, 8 tests, all green.
- The test feeds raw SSE through `createPassthroughStreamWithLogger` with
  `targetFormat = FORMATS.OPENAI`, the same harness used by
  `tests/unit/claude-passthrough-decloak.test.js`.
