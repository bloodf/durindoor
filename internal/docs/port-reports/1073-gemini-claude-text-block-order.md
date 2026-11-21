# 1073: Gemini to Claude text block order across stream deltas

Checked 2026-11-20 against DurinDoor `859c0eaf1596b4f8b8f5c68f88793acdbb463f99`.

- [OmniRoute #254](https://github.com/cheaper-inference/OmniRoute/pull/254), head `eab96cc94b85df949e460fa21c5b8524787120c9` (`fix(streaming): keep Gemini/Antigravity text block open across chunks (#253)`), merge `9013236718ebab4b17940426d672489bb8a779da` (2026-03-09T08:47:41-03:00), base `7f66e82f16e6f75f835ca82d70a8097314361836`. **Disposition: ported (translator portion) / not applicable (dashboard portion).**

## Upstream diff scope

The merge touches two paths:

- `open-sse/translator/response/gemini-to-claude.ts` — the streaming translator. Ported below.
- `src/app/(dashboard)/dashboard/agents/page.tsx` — a new "OpenCode Integration" card that generates an `opencode.json` client config from `/v1/models`. **Not applicable**: it is a dashboard convenience surface unrelated to Gemini-to-Claude translation, and it references upstream's own brand and provider name (`omniroute` provider block, `OmniRoute` display name). No equivalent product surface exists in this fork, and adopting it would import upstream branding into DurinDoor's dashboard.

Upstream added no test for this change.

## Local state before the port

`open-sse/translator/response/gemini-to-claude.js` already carried the upstream head commit's main idea — `state.openTextBlockIdx` tracks one open text block so consecutive plain-text parts reuse it instead of opening and closing a block per chunk:

- the text branch opens a block only when `state.openTextBlockIdx === null` and always emits its delta into that block;
- the `functionCall` branch closes an open text block and resets the tracker;
- the `finishReason` branch closes a still-open text block before `message_delta`/`message_stop`.

That part of upstream head `eab96cc94b85df949e460fa21c5b8524787120c9` was therefore already present. The **thought** branch was the one boundary upstream added and this fork did not have. Before the port, a thought part neither closed the open text block nor reset the tracker, so a `text → thought → text` sequence emitted:

```
content_block_start:0 / content_block_delta:0
content_block_start:1 / content_block_delta:1 / content_block_stop:1
content_block_delta:0 / content_block_stop:0
```

The `content_block_delta` for index 0 arrives after index 1 was already started and stopped. The Claude streaming contract requires each content block to be `content_block_start` → deltas → `content_block_stop` with blocks opened in ascending index order, and no event for an index after that index's `content_block_stop`. The old shape violated both, and it also interleaved visible text into a thought block's index range.

## Change applied

`open-sse/translator/response/gemini-to-claude.js` — the thought branch now closes an open text block and resets the tracker before opening the thinking block, mirroring the existing `functionCall` branch in the same file and upstream's own change:

```js
if (part.thought === true && part.text) {
  if (state.openTextBlockIdx !== null) {results.push({ type: "content_block_stop", index: state.openTextBlockIdx });state.openTextBlockIdx = null;}
  const index = state.contentBlockIndex++;
  ...
```

Consequences, all within the existing Claude streaming contract:

- text that follows a thought part resumes in a **fresh** block with a new index, because the previous text block is already closed;
- text that follows a tool part keeps resuming in a fresh block, as it already did;
- consecutive plain text parts keep sharing one block, so a chunked answer stays a single block instead of one block per delta.

## Preserved local behaviour

- Tool identity: the tool block still carries the upstream `functionCall.id` as its Claude `tool_use` id and the remapped tool name, and `state.hasToolUse` still forces the `tool_use` stop reason.
- Thought signature bookkeeping: the inline `thoughtSignature`/`thought_signature` read, the standalone signature queue, and `storeGeminiThoughtSignature` persistence are untouched. The signature queue is unaffected by the new close, because it is populated before the branch dispatch and is consumed only by the `functionCall` branch.
- Terminal behaviour: the `finishReason` branch still closes an open text block, then emits `message_delta` (stop reason and usage) and `message_stop`. Usage still sums `candidatesTokenCount` and `thoughtsTokenCount` and still reports `cache_read_input_tokens`.
- Native routes: no change to the Gemini native v1beta bridge (`src/app/api/v1beta/models/[...path]/geminiBridge.js`), the OpenAI-hub Gemini routes, or the provider registry.

## Rejected alternatives

- **Extend the direct route to `GEMINI_CLI` and `ANTIGRAVITY`.** Upstream registers `FORMATS.GEMINI`, `FORMATS.GEMINI_CLI` and `FORMATS.ANTIGRAVITY` against `FORMATS.CLAUDE`, but that registration set already existed upstream *before* this PR and is unchanged by it. This fork registers only `FORMATS.GEMINI` for the direct route (`internal/docs/translators.mdx`: "Direct response routes include `kiro:claude` and `gemini:claude`"); Gemini-CLI and Antigravity responses route through the OpenAI hub. Adding the upstream registrations would be a routing change outside this PR's diff and would alter existing native routes, so the local registration is left intact.
- **Keep one text block open across a thought part.** That would keep the block open while a thinking block occupies a higher index, which is exactly the ordering the Claude contract forbids.
- **Close and reopen the text block on every text part.** That is the pre-`eab96cc94b85df949e460fa21c5b8524787120c9` upstream behaviour; it renders each delta on its own line in Claude Code and contradicts the "already reuses one text block" behaviour this fork had already adopted.

## Verification

Focused evidence, from `tests/`:

```
node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-gemini-claude-text-block-order.test.js
```

7 tests passed. `tests/unit/omni-gemini-claude-text-block-order.test.js` uses synthetic offline fixtures only — no network, no credentials, no provider requests. It asserts the exact block event trace for a `text → thought → text` sequence, for text-only sequences, for mixed parts in one chunk, for a `text → tool → text` sequence, and for the terminal usage and finish events; it also asserts the general contract (each block is `start → delta* → stop`, blocks open in ascending index order, no event after a block's stop) and covers the registered direct route through `translateResponse`. The same file was confirmed to fail before the change and to pass after it.

Regression scope for this translator change:

```
node node_modules/vitest/vitest.mjs run --maxWorkers=2 translator/
```

92 files passed, 9 skipped (the `tests/translator/real/` live suites, which need `RUN_REAL=1` and real accounts); 1820 tests passed, 34 skipped.

```
node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-gemini-claude-text-block-order.test.js unit/bypass-response.test.js unit/usage-cost-total.test.js unit/non-streaming-forced-client-sse.test.js unit/gemini-cli-signin-parity.test.js unit/openai-to-gemini-gemma-thinking.test.js unit/openai-to-gemini-response.test.js unit/api-providers-id-models.test.js unit/openai-responses-nonstream.test.js unit/forced-sse-gemini-name-restore.test.js unit/omni-responses-text-native-1073.test.js unit/antigravity-thought-signature-family.test.js unit/antigravity-tool-thinking-bridge-port.test.js
```

13 files passed, 140 tests passed.

Root `pnpm run lint` passes. The full suite, browser/e2e, Docker and credential-backed checks are reserved for the integration gate and were not run here.

## Verification limits

Everything above is offline assertion over synthetic fixtures. No live Gemini or Anthropic provider was contacted, so the claim "Claude Code renders the resumed text as a separate block" is inferred from the emitted event order, not observed in a client. `tests/__baseline__/known-fails.txt` was not modified and no baseline failure was added.
