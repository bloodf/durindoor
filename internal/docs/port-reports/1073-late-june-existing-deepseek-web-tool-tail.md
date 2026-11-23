# #1073: late June existing DeepSeek tool and history wire behavior

## Scope and source pins

Review date: 2026-11-21. Scope comprises two late-June OmniRoute pull requests touching the `deepseek-web` executor and its text-based tool parsing and message serialization helpers. The exact public commits and enclosing merges in the upstream repository history were inspected against DurinDoor's local source and test inventory:

| PR | Exact head | Enclosing merge | Patch base | Disposition |
|---|---|---|---|---|
| [OmniRoute #4644](https://github.com/cheaper-inference/OmniRoute/pull/4644) | [`379d1cd5e7715edfe0f1c26b6bb2343db14f9016`](https://github.com/cheaper-inference/OmniRoute/commit/379d1cd5e7715edfe0f1c26b6bb2343db14f9016) | [`2659f1403e9465477da629c1cb17ea24f14ec8e9`](https://github.com/cheaper-inference/OmniRoute/commit/2659f1403e9465477da629c1cb17ea24f14ec8e9) | `ee24eb52d42f6320917b64b2da464542e0739e23` | **No port: source-only tool bridge for nonexistent provider.** Upstream introduces an ad-hoc XML tag parser and prompt generator to emulate tool calling over unofficial `chat.deepseek.com` sessions. DurinDoor closed `deepseek-web` under issue [#1173](https://github.com/bloodf/durindoor/issues/1173) and routes DeepSeek exclusively via official API endpoints with native tool declaration and response ownership. |
| [OmniRoute #4756](https://github.com/cheaper-inference/OmniRoute/pull/4756) | [`7ac36b9189bfc019c2643b51d33bdf821f7b1c6a`](https://github.com/cheaper-inference/OmniRoute/commit/7ac36b9189bfc019c2643b51d33bdf821f7b1c6a) | [`ec9c93fe29a39cc2e6ee7191dc9188e40f1269f6`](https://github.com/cheaper-inference/OmniRoute/commit/ec9c93fe29a39cc2e6ee7191dc9188e40f1269f6) | `44f81eaa603b64fa294126034e5dc0307fc045c1` | **No port: source-only transcript folding for nonexistent provider.** Upstream formats dropped `role: "tool"` results into rolling-window text transcripts for single-prompt web chat. DurinDoor preserves structured multi-turn message arrays and wire result ordering natively across both OpenAI and Claude transports. |

### Enclosing merge verification

- **#4644**: The enclosing merge `2659f1403e9465477da629c1cb17ea24f14ec8e9` is a squash-merge commit whose first-parent diff (`2659f1403e^..2659f1403e`) is byte-identical to the PR branch diff from base `ee24eb52d42f6320917b64b2da464542e0739e23` to head `379d1cd5e7715edfe0f1c26b6bb2343db14f9016`. The isolated patch modifies `open-sse/executors/deepseek-web.ts`, creates `open-sse/translator/deepseekWebTools.ts`, exports helpers from `open-sse/translator/webTools.ts`, and adds unit tests in `tests/unit/deepseek-web-tools-execute.test.ts` and `tests/unit/deepseek-web-tools-variants.test.ts`. Direct comparison between head `379d1cd5e7715edfe0f1c26b6bb2343db14f9016` and merge `2659f1403e9465477da629c1cb17ea24f14ec8e9` traverses 167 unrelated main commits, so the head-to-base and first-parent diffs isolate the exact patch.
- **#4756**: The enclosing merge `ec9c93fe29a39cc2e6ee7191dc9188e40f1269f6` is a squash-merge commit whose first-parent diff (`ec9c93fe29^..ec9c93fe29`) matches the PR head `7ac36b9189bfc019c2643b51d33bdf821f7b1c6a` diff from base `44f81eaa603b64fa294126034e5dc0307fc045c1` (differing only by commit/blob hashes in `config/quality/file-size-baseline.json`). The patch modifies `open-sse/executors/deepseek-web.ts` and adds `tests/unit/deepseek-web-tool-result-prompt-4712.test.ts`.

## Upstream patch analysis

### OmniRoute #4644: DeepSeek Web ad-hoc tool parsing and parameter matching

- **Upstream context**: OmniRoute provides a `deepseek-web` executor targeting the consumer chat service at `chat.deepseek.com`. Because that web service does not expose a native API function-calling protocol, OmniRoute emulates tool calling by serializing OpenAI tool definitions into prompt text and parsing the model's textual responses back into structured `tool_calls`.
- **Problem addressed**: In agentic workflows, DeepSeek's web responses emitted varied ad-hoc XML and tag structures (`<tool:name>{json}</tool>`, `<tool_call>` with `type`/`params` keys, `name`/`id` tag attributes, nested `<tool><tool>...</tool></tool>` wrappers, `<name>` and `<arguments>` XML children, and `<parameter name="..." content="...">` tags). The previous regex parser in `webTools.ts` only matched canonical `<tool>{json}</tool>` blocks and failed on these variants, causing tool calls to be treated as plain assistant text. Furthermore, the prompt builder previously used only the last user turn and dropped previous tool calls and results, causing agent loops to restart.
- **Changes**:
  1. Created `open-sse/translator/deepseekWebTools.ts` with a stack-based tokenizer/parser handling nested and attributed XML tags, plus prompt generators `buildToolSystemPrompt` and `buildToolConversationPrompt`.
  2. Exported reusable utility functions (`getRequestedToolNames`, `parseLooseJsonObject`, `resolveRequestedToolName`, `stripRanges`, `toArgumentsString`, and the `RequestedToolName` type) from `open-sse/translator/webTools.ts`.
  3. Head commit `379d1cd5e7715edfe0f1c26b6bb2343db14f9016` resolved a regex flaw in `PARAM_TAG_RE` where an unclosed attribute-style `<parameter ...>` tag's body matcher greedily crossed into subsequent `<parameter>...</parameter>` tags, swallowing them. The fix introduced a tempered greedy token: `/<parameter\b([^>]*?)\/?>(?:((?:(?!<parameter\b)[\s\S])*?)<\/parameter>)?/gi`.
  4. Updated `open-sse/executors/deepseek-web.ts` to use `deepseekWebTools.ts` for prompt serialization and response scraping.

### OmniRoute #4756: Folding tool results into rolling-window prompt transcripts

- **Upstream context**: In non-tool requests or conversational turns processed by `messagesToPrompt` in `open-sse/executors/deepseek-web.ts`, the executor flattens an incoming OpenAI message array into a single text prompt string for `chat.deepseek.com`.
- **Problem addressed (issue #4712)**: `messagesToPrompt` only handled `m.role === "system"` and `m.role === "user" || m.role === "assistant"`. Messages with `m.role === "tool"` were ignored and silently dropped. In multi-turn sessions where an agent had previously executed a tool, the model never received the tool output, causing it to hallucinate missing information or call the same tool repeatedly.
- **Changes**:
  1. In `open-sse/executors/deepseek-web.ts`, extracted `tool_calls` in assistant turns to map `tool_call_id` to function names (`callNameById`).
  2. Added an explicit `m.role === "tool"` branch in `messagesToPrompt`: resolved the tool name from `callNameById` or `m.name`, formatting the turn as `Tool result (${name}) ${text}` in the internal conversation list.
  3. Formatted `role === "tool"` turns as `Tool result ${turn.text}` within rolling-window transcript generation.

## DurinDoor current behavior and local evidence

### 1. Provider and authorization boundaries: nonexistent `deepseek-web`

In DurinDoor, provider parity decisions explicitly evaluated and rejected `deepseek-web`:
- As recorded in [provider-parity-closed-omniroute.md](../provider-parity-closed-omniroute.md) and [provider-parity-current-dispositions.md](../provider-parity-current-dispositions.md), `deepseek-web` was closed not planned under issue [#1173](https://github.com/bloodf/durindoor/issues/1173). The rationale is that `deepseek-web` relies on consumer-session/cookie scraping and unofficial browser endpoint emulation against `chat.deepseek.com`.
- DurinDoor supports DeepSeek exclusively through its official, documented API service via the registered provider `deepseek` in [open-sse/providers/registry/deepseek.js](../../../open-sse/providers/registry/deepseek.js).
- The `deepseek-web` executor, `deepseekWebTools.ts`, and associated web tests do not exist in DurinDoor. Importing them would bypass DurinDoor's established provider and authorization boundaries.

### 2. Tool declaration ownership

DurinDoor routes DeepSeek requests to official endpoints using standard wire formats:
- **OpenAI wire format**: The primary transport targets `https://api.deepseek.com/chat/completions` with bearer authentication. Tool declarations (`tools: [...]`) are forwarded directly as native JSON schema objects to DeepSeek's API. No prompt serialization or pseudo-XML tagging is performed.
- **Claude wire format**: The secondary transport targets `https://api.deepseek.com/anthropic/v1/messages`. DeepSeek's Anthropic-compatible gateway accepts only built-in search tools (`web_search_20250305`, `web_search_20260209`) and rejects custom tools with HTTP 400. DurinDoor enforces this constraint declaratively via `quirks.claudeSupportedToolTypes` in [open-sse/providers/registry/deepseek.js](../../../open-sse/providers/registry/deepseek.js), and [open-sse/translator/formats/claude.js](../../../open-sse/translator/formats/claude.js) filters tools accordingly. Verified offline by [tests/unit/deepseek-claude-tools.test.js](../../../tests/unit/deepseek-claude-tools.test.js).
- **Tool choice handling**: In [open-sse/executors/default.js](../../../open-sse/executors/default.js), forced `tool_choice` (`required` or explicit function) is cleanly stripped when native DeepSeek V4 thinking mode is enabled, avoiding API validation rejections while preserving `auto` choices. Verified offline by [tests/unit/deepseek-forced-tool-choice.test.js](../../../tests/unit/deepseek-forced-tool-choice.test.js).
- **Claude tool type defaulting**: In [open-sse/translator/concerns/toolCall.js](../../../open-sse/translator/concerns/toolCall.js), `shouldDefaultClaudeToolType` ensures that `type: "custom"` is not injected into DeepSeek tool declarations. Verified offline by [tests/translator/bugs-3905-deepseek-tool-type.test.js](../../../tests/translator/bugs-3905-deepseek-tool-type.test.js).

### 3. Tool response ownership

- Official DeepSeek endpoints natively return structured `tool_calls` arrays (on OpenAI completions) or `tool_use` content blocks (on Claude messages).
- DurinDoor's executors receive structured JSON payloads directly from DeepSeek; no post-generation regex parsing or ad-hoc tag scraping is required or performed.
- In generic web-scraping bridges where DurinDoor does provide prompt-based tool execution ([open-sse/translator/webTools.js](../../../open-sse/translator/webTools.js), used by `adapta-web`, `inner-ai`, and `chatgpt-web-http`), tool calls are formatted strictly as `<tool>{"name": "...", "arguments": {...}}</tool>` JSON blocks. DurinDoor has never accepted or required ad-hoc `<parameter>` XML parsing.

### 4. Wire result ordering and multi-turn history

- **Structured message preservation**: Unlike upstream's flat single-prompt folding in `deepseek-web`, DurinDoor sends multi-turn conversations to DeepSeek as structured arrays of message objects (`user`, `assistant`, and `tool`).
- **Tool result ordering**: Tool execution outputs arrive as `{ role: "tool", tool_call_id: "...", content: "..." }` (OpenAI format) or `{ role: "user", content: [{ type: "tool_result", tool_use_id: "...", content: "..." }] }` (Claude format). These turns remain in exact temporal sequence immediately following the corresponding assistant tool call. They are never flattened, summarized, or dropped.
- **Thinking mode history parity**: Under DeepSeek's Thinking Mode API contract (`api-docs.deepseek.com`), when tools are present, prior assistant turns must include `reasoning_content`. DurinDoor's `DefaultExecutor` and `injectReasoningContent` in [open-sse/utils/reasoningContentInjector.js](../../../open-sse/utils/reasoningContentInjector.js) inject a safe non-empty placeholder (`" "`) on prior assistant turns that lack reasoning history, ensuring that the official API accepts the request without error while keeping the entire structured message history and tool result turns intact. Verified offline by [tests/unit/deepseek-thinking-history-parity.test.js](../../../tests/unit/deepseek-thinking-history-parity.test.js).
- **Generic webTools history**: In [open-sse/translator/webTools.js](../../../open-sse/translator/webTools.js), `prepareToolMessages` prepends a system prompt describing tools but passes all `messages` through in `effectiveMessages` verbatim, ensuring that `role: "tool"` turns and turn sequence remain untouched.

## Dispositions

### [OmniRoute #4644](https://github.com/cheaper-inference/OmniRoute/pull/4644)
**Disposition: No port: source-only tool bridge for nonexistent provider.**
- OmniRoute #4644 implements an ad-hoc XML parser (`deepseekWebTools.ts`) and prompt generator to emulate function calling over `chat.deepseek.com`.
- DurinDoor explicitly excludes `deepseek-web` under issue [#1173](https://github.com/bloodf/durindoor/issues/1173) due to its unauthorized consumer-session scraping model.
- DurinDoor's installed DeepSeek support uses the official API (`deepseek`), where tool declarations and responses are native JSON structures, not scraped text.
- No source-only tool bridge or regex parsing should be imported.

### [OmniRoute #4756](https://github.com/cheaper-inference/OmniRoute/pull/4756)
**Disposition: No port: source-only prompt transcript folding for nonexistent provider.**
- OmniRoute #4756 works around a bug in `deepseek-web`'s `messagesToPrompt` where `role: "tool"` messages were dropped when flattening message arrays into single prompt strings.
- DurinDoor does not flatten conversation history into single-string transcripts for DeepSeek. Instead, it transmits structured multi-turn message arrays natively to official API endpoints, preserving `role: "tool"` turns, `tool_call_id` associations, and sequential ordering.
- DurinDoor's generic web tool helper ([open-sse/translator/webTools.js](../../../open-sse/translator/webTools.js)) already preserves all conversation turns in `effectiveMessages`.
- No transcript folding change is warranted.

## Offline acceptance

No functional gap exists between upstream's patches and DurinDoor's installed provider capabilities. DurinDoor's existing test suite fully verifies DeepSeek wire behavior using static and mocked fixtures:
1. `tests/unit/deepseek-claude-tools.test.js`: verifies whitelist quirk for built-in web search tools and dropping of custom tools on DeepSeek's Anthropic route.
2. `tests/unit/deepseek-forced-tool-choice.test.js`: verifies forced `tool_choice` stripping under native V4 thinking mode.
3. `tests/translator/bugs-3905-deepseek-tool-type.test.js`: verifies that Claude `type: "custom"` tool defaulting never applies to DeepSeek.
4. `tests/unit/deepseek-thinking-history-parity.test.js`: verifies multi-turn history preservation, structured `role: "tool"` result ordering, and `reasoning_content` placeholder injection on DeepSeek OpenAI Chat routes.
5. `tests/unit/omniroute-specialized-executors.test.js`: verifies generic `webTools.js` prompt preparation and message pass-through.

If an ad-hoc text-based tool bridge for an authorized provider were ever proposed, ordinary offline acceptance would require:
- A synthetic multi-turn message fixture containing `role: "assistant"` with tool calls and subsequent `role: "tool"` results.
- Mocked validation that tool calls and results maintain identity mapping, parameter boundaries (including unclosed or attribute-style XML parameter tags), and turn ordering without dropping tool results from context.
- Zero live network traffic, credentials, or browser automation.

For current DurinDoor source, no modifications to product code, tests, or workflows are required.
