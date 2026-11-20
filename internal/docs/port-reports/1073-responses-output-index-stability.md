# #1073 Responses output item index stability

Compared 2026-11-20 against DurinDoor `e2605ebb1` and OmniRoute [#19006](https://github.com/cheaper-inference/OmniRoute/pull/19006), `fix(sse): keep Responses output_index stable around tool calls`.

## Source pins

| Item | Value |
| --- | --- |
| Pull request | [OmniRoute #19006](https://github.com/cheaper-inference/OmniRoute/pull/19006), merged |
| Exact head | `7187e64b0a40ddc1e2a3db4d8395a299a017b29c` |
| Merge commit | `e04c0ebbee5f89311e7dbf770a8989c67cae2275` |
| Files changed | `open-sse/translator/response/openai-responses.ts`, `tests/unit/translator-openai-responses-output-index-stability.test.ts`, a changelog fragment |

The diff was read from the merged pull request. Neither commit is in the local object database, so the pins are recorded rather than fetched.

## Disposition

**Already equivalent; runtime unchanged.** `open-sse/translator/response/openai-responses.js` is not modified. This change adds only a focused regression test, `tests/unit/omni-responses-output-index-stability.test.js`.

## Upstream defect and fix

Upstream computed a tool call's `output_index` from live message state (`toolCallOutputIndexBase` plus a local tool index) every time it was needed. A message opened or relocated after the call's first delta shifted the close-time index away from the announced one. Post-tool text also re-ran a relocation scan per chunk and opened a new message item per delta, and a relocated message was not closed before the next tool call. The fix:

- allocates the tool index once per upstream index (`allocateToolOutputIndex`) and reuses it at close (`announcedToolOutputIndex`);
- remembers message relocation per requested index (`msgIndexAlias`, `resolveMessageIndex`);
- closes the relocated message before the next tool call opens.

## Local lifecycle

The local translator has no relocation machinery to repair, because every item index comes from one shared monotonic allocator:

- `startReasoning`, `emitTextContent` and `emitToolCall` each take `state.nextOutputIndex++` once, at first announcement, and store it (`state.reasoningIndex`, `state.msgOutputIndexes[idx]`, `state.funcOutputIndexes[tcIdx]`).
- Every later delta and `closeMessage` / `closeReasoning` / `closeToolCall` read the stored value; nothing recomputes an index from live state. A tool call's `output_item.added`, argument deltas and `output_item.done` therefore cannot drift.
- The shared counter makes indexes unique and ordered by announcement across reasoning, text and tool items.
- A tool call does not close the open text message (see the comment before the `delta.tool_calls` loop). Text after a tool turn continues the same message item at its original index, so no per-chunk message items are created and no relocation or alias is needed.

## Deliberate difference

Upstream splits text around a tool call into separate message items (`pre`, call, `abc`, call, `xyz`). Local keeps one message item open across tool calls, so the same stream yields one message (`preabc`) and the calls at their own later indexes. This is existing local behavior, covered by the Responses snapshot-order and replay suites, and the user-visible invariants (stable identity, no duplicate indexes, one continuation message, no per-chunk growth) hold. It was not changed, to preserve native tools, reasoning, sequence numbering and final snapshots. The upstream test asserting the split snapshot order is therefore adapted, not copied.

## Coverage

Existing coverage compared first: `openai-responses-parallel-tools`, `openai-responses-toolcall-done-ordering`, `responses-snapshot-source-order`, `responses-sequence-replay` and `omni-responses-mixed-reasoning`. Some assert `output_index` in snapshot or replay cases, but none covers per-item index identity through a text-after-tool stream, so one focused file was added, `tests/unit/omni-responses-output-index-stability.test.js` (3 tests, adapted from the upstream test):

1. A tool call keeps one `output_index` across `output_item.added`, argument deltas and `output_item.done` while text starts after it; the message takes a different index.
2. Text after a tool turn stays in a single message item (`["preabc"]`), with no duplicate `output_item.done` index.
3. Reasoning, tool, text, tool: added indexes are unique and ascending, each item's done index equals its added index, completed snapshot holds both calls and the message in call order, and `sequence_number` runs consecutively from 1.

Focused run from `tests/`: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-responses-output-index-stability.test.js` passes, as do the five neighbouring suites listed above (6 files, 31 tests). Dependencies were installed with `pnpm install --frozen-lockfile --ignore-scripts` in this worktree only.

Verification limits: offline synthetic Chat chunks only. No provider, credential, paid API, browser, Docker or whole-suite run was used.

Refs #1073
