# #1073 Preserve displaced tool outputs in existing translator histories

Compared 2026-11-20 against base `a325dfb5c` (branch `orq/tornf6/port-omni-displaced-tool-results-a1`) and OmniRoute [#18709](https://github.com/cheaper-inference/OmniRoute/pull/18709), merged 2026-11-04, final head `d9a984797f55db38e25adf822ae4113667d65f92` ("fix(translator): hoist displaced tool results into their assistant turn"). Source files in that PR: `open-sse/translator/helpers/toolCallHelper.ts`, `open-sse/translator/index.ts` and one test.

No provider, credential, browser, e2e, Docker, paid API or full-suite run was used. Evidence is source reading and the offline test `tests/unit/omni-displaced-tool-results.test.js` (13 cases).

## Disposition: partially covered, residual gap ported

The contract is **not** already covered. This fork's `fixMissingToolResponses` (`open-sse/translator/concerns/toolCall.js`) already pairs results by call id and relocates a result that sits *behind a later assistant turn*. It does not move a result that sits behind a *non-assistant* message (queued user text, task notification), because it only treats results with an intervening assistant as displaced. Probing the base for `[assistant(c1,c2), tool(c1), user, tool(c2)]` showed:

| Path | Base behavior | Effect |
| --- | --- | --- |
| OpenAI Chat to OpenAI, Responses to Chat | Order unchanged: `[assistant, tool c1, user, tool c2]` | Strict Chat validators reject "insufficient tool messages following tool_calls" |
| Claude to OpenAI | `claude-to-openai.js` `fixMissingToolResponsesOpenAI` scans only the contiguous run, so it inserts `[No response received]` for `c2` while the real `c2` result still follows the user message | Duplicate `tool_call_id`, and a placeholder invented although the real result is known |
| OpenAI to Claude, Claude to Claude | Already correct: Claude normalization merges the consecutive user turns, results first | No change needed |

## What was ported (adapted, not copied)

`repairDisplacedToolResults(body)` in `open-sse/translator/concerns/toolCall.js`, the owner of the pair fixers in this fork (upstream's `.ts` helper path does not exist here).

1. For each assistant message with call ids, take the contiguous result run and mark its ids answered.
2. Scan forward to the next assistant message only. Move a result into the run only when its id is still unanswered for that turn. Results for unknown ids, duplicates of an answered id, and results beyond the next assistant stay where they were.
3. Never invent a result. Unanswered calls are left to the existing `fixMissingToolResponses`.

Differences from the pinned upstream helper, chosen to honor "preserve IDs, ordering and non-text parts":

- Upstream hoists whole messages that resolve any open id. This port tracks answered ids, so a duplicate result for an already-answered id stays put.
- A mixed Claude carrier (`tool_result` plus text) is split at block level: only the matching `tool_result` blocks move, intact (`is_error`, `cache_control`, image parts), and the text stays in its original position. A pure carrier moves as the original object.
- The pass assigns a new `body.messages` array and never mutates the caller's message objects (upstream rebuilt the array in place).

## Wiring (`open-sse/translator/index.js`)

- Before `fixMissingToolResponses` in the pre-translation stage. This repairs Claude-format histories before `claude-to-openai.js` would invent a placeholder.
- Immediately before `filterToOpenAIFormat` when the target is OpenAI, the first point at which Responses and Gemini sources expose `messages[]`.

Upstream also registered the pass in a final stage before `stripOrphanedToolResults`. This fork has no equivalent final pair-fix stage, so no third call site was added.

## Not changed

- No new translator pair, restore path or payload handling; no schema or provider metadata change.
- `stripOrphanedToolResults` and `salvageOrphanedToolResults` are untouched; orphan results with no matching call are not moved or rewritten.
- Claude turn ordering for OpenAI to Claude and Claude to Claude is unchanged; the tests pin it.
- Gemini sources keep their own `fixMissingToolResponses` after conversion.

## Verification

Run from `tests/` with a private frozen install (`pnpm install --frozen-lockfile --ignore-scripts` in the worktree, not a shared install):

- `node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-displaced-tool-results.test.js`: 13 passed.
- With `index.js` reverted to base, the three `translateRequest` cases (Claude to OpenAI, Responses to Chat, OpenAI to OpenAI) fail; the helper-level cases do not depend on wiring. The wiring is therefore pinned by the tests.
- Neighbouring suites for the pair fixers, orphan handling, Gemini/Responses/Kiro histories, Claude malformed history and Claude-to-OpenAI translation (19 files) pass.

Offline assertions only. No live upstream was contacted, so the DeepSeek 400 is taken from the upstream PR description and was not reproduced here.
