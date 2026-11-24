# 1073: Gemini repeated-finish protections (OmniRoute #20224)

Closes two verified gaps from [the row 91 complete comparison](1073-nov24-row-91-complete.md). Compared on 2026-11-24 against integration HEAD `0d6e283699`.

**Status: implemented on this branch; not a completed port until the PR below merges.** PR link: see the PR for branch `orq/tows9a/port-omni-gemini-finish-a1` (recorded in the PR body and the thread, not claimed here before it exists).

## Upstream

Read complete diffs of both commits from local Git objects (no fetch needed):

- `799279a67a3d356c0c188a4abe5bc640d884dfb1`: `openai-to-antigravity.ts` and `openai-to-gemini-sse.ts` set the tool-call accumulator to `{}` after flushing it at `finish_reason`. Plus a test and a changelog fragment.
- `6bb7f88d982879197e360bbd272c52bba60b5eb2`: `gemini-to-claude.ts` returns `null` for candidate-bearing chunks once `state.claudeFinishEmitted` is set, and sets it after `message_stop`. Plus a test and a changelog fragment.

## Verification against DurinDoor

Both behaviours reproduced on the unmodified tree. With the new test file run against the old translators, 9 of 11 tests fail:

- OpenAI tool call, then the finish chunk twice, through `openaiToAntigravityResponse` and through `translateResponse` for Gemini, Gemini CLI, Vertex and Antigravity: two `functionCall` parts instead of one.
- Gemini chunk with `finishReason`, then another chunk with `finishReason`: a second `message_delta`/`message_stop` and extra content events after the first terminal.

The two tests that pass both before and after are the valid-stream guards: two parallel calls with one finish, and a normal text stream with one `message_delta` and one `message_stop`.

## Overlap check

- Open DurinDoor PRs (#2492, #2487, #2486, #2484, #2483, #2481, #2430, #2112, #1809, #1784): none touches `gemini-to-claude.js`, `openai-to-antigravity.js` or `openai-to-gemini.js`.
- Local branches and `origin/orq/tows9a/*`: no existing branch carries this change.
- Active sessions (ListAgents): none works on Gemini translators; the row 91 disposition session edits reports only.
- `git log --all` for repeated-finish, `message_stop` and duplicate-tool subjects: no prior port.

## Changes

| File | Change |
|---|---|
| `open-sse/translator/response/openai-to-antigravity.js` | After the finish-time flush, `state._toolCallAccum = {}`. |
| `open-sse/translator/response/gemini-to-claude.js` | Set `state.claudeFinishEmitted` after `message_stop`; return `null` for later candidate-bearing chunks. |
| `tests/unit/omni-gemini-repeated-finish.test.js` | 11 behaviour tests. |
| `internal/docs/translators.mdx` | New "Repeated finish chunks (Gemini family)" note. |

## Deliberate adaptations

- Upstream has a separate `openai-to-gemini-sse.ts` converter. DurinDoor has none: `openai-to-gemini.js` registers `openaiToAntigravityResponse` for Gemini, Gemini CLI and Vertex, so one change covers all four client formats. No new translator was added, so nothing new needs registering.
- The Claude guard sits after the candidate-less error branch (as upstream), so an upstream error chunk is still surfaced and the existing #1342 behaviour is unchanged. A candidate-less error chunk after `message_stop` is therefore still emitted; this is out of scope for the upstream commit.
- The repeated finish chunk still yields one empty-text candidate with `finishReason` on the Gemini wire (upstream does too). Only the duplicate `functionCall` is removed.
- Tests use `FORMATS`, `OPENAI_FINISH` and `GEMINI_FINISH` constants and import `../translator/registerAll.js` before calling `translateResponse`. No changelog fragment: DurinDoor has no `changelog.d`.
- `tests/__baseline__/known-fails.txt` untouched.

## Commands run

Dependencies installed with `pnpm install --frozen-lockfile --ignore-scripts` (root and `tests/`). Run from `tests/` with `npx vitest run`:

- New file, 11 tests: pass with the fix; 9 fail without it.
- Neighbouring suites (`portor-gemini-claude-repeat-call-20790`, `omni-antigravity-after-finish-usage`, `antigravity-active-tool-fragment`, `antigravity-indexless-tool-id`, `omni-gemini-claude-text-block-order`, `omni-gemini-synthetic-reason`): 61 tests pass together with the new file.

No credentials, production gateway or machine settings were touched. No provider calls.
