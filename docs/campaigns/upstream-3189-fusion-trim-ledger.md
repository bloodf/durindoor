# Upstream PR Port — #3189 (2026-08-11)

Single `decolua/9router` pull request ported into this fork on a dedicated
worktree. Anchors live in [`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3189](https://github.com/decolua/9router/pull/3189) `fix(fusion): trim trailing assistant turn before panel fan-out` | PORTED | `open-sse/services/combo.js:handleFusionChat` called `flattenToolHistory` on `panelBody.messages` / `panelBody.input` and then shipped the result directly to the panel. When a client (e.g. the CAVEMAN-enabled Claude front end) echoed an in-flight partial assistant reply into the next request, the panel fan-out handed Anthropic a conversation that ended on `role:"assistant"`, which Anthropic rejects with a 400 ("messages must alternate"). | Add `trimTrailingAssistant(messages)` next to `flattenToolHistory` and call it on `panelBody.messages` / `panelBody.input` after flattening, so any number of trailing assistant turns is dropped while earlier prose/tool context is preserved. If the input is empty or stripping the tail would empty the array (all-assistant history), the helper returns the original list — sending `[]` upstream is worse than letting the provider reject a known-bad conversation it can already describe. Tests in `tests/unit/combo-fusion.test.js` (`trims a trailing assistant turn from messages before panel fan-out`, `trims a trailing assistant turn from Responses input before panel fan-out`, `keeps a user-ending panel conversation and preserves all-assistant history`). |

## Adaptations

- **Helper signature.** Upstream exports `trimTrailingAssistant`; here it stays
  module-local because no other file in the fork needs it. The behaviour is
  identical: drop trailing `role:"assistant"` turns, keep the original array on
  the degenerate all-assistant case so the provider can return its own 400.
- **Apply order.** Trim runs *after* `flattenToolHistory` in both the
  `messages` and the `input` branches, matching upstream. Flattens first so any
  tool-use turns that flatten into `role:"assistant"` are also eligible to be
  trimmed in the same step.

## Verification

- `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/combo-fusion.test.js`: `Test Files  1 passed (1)`, `Tests  20 passed (20)`.
- Revert proof, both confirmed red then green:
  - Without `trimTrailingAssistant`, the panel still sees `[{user "Q"}, {assistant "partial"}]` and the two new trim assertions fail with `expected [ Array(2) ] to deeply equal [ { role: 'user', content: 'Q' } ]`.
  - The user-ending and all-assistant history tests both pass on baseline (no trim) and stay green after the fix, confirming the helper is a no-op for already-valid input.
