# #1073 — November existing Claude cache and thinking preparation

## Scope and pins

Compared the existing Claude request and Bedrock routes only. New model catalogs, profile registrations, sign-in changes, provider setup, and other unrelated changes carried by merge commits are excluded.

| OmniRoute PR | Exact PR head | Enclosing merge pin | Patch inspected |
| --- | --- | --- | --- |
| [#18025](https://github.com/cheaper-inference/OmniRoute/pull/18025) | [`d745a6998ca0d1b5e58a85510aa36f5516760a48`](https://github.com/cheaper-inference/OmniRoute/commit/d745a6998ca0d1b5e58a85510aa36f5516760a48) | [`b65cd4041bc0686659de57421c50e4025edc7079`](https://github.com/cheaper-inference/OmniRoute/commit/b65cd4041bc0686659de57421c50e4025edc7079) | PR patch, rather than the enclosing merge diff |
| [#18532](https://github.com/cheaper-inference/OmniRoute/pull/18532) | [`23eb6b2219de383d9cc78514a1ba8d9088800bb7`](https://github.com/cheaper-inference/OmniRoute/commit/23eb6b2219de383d9cc78514a1ba8d9088800bb7) | [`395ed45449a9a2b8a156f5976f469b3a400e7b51`](https://github.com/cheaper-inference/OmniRoute/commit/395ed45449a9a2b8a156f5976f469b3a400e7b51) | PR patch |
| [#19181](https://github.com/cheaper-inference/OmniRoute/pull/19181) | [`95efa7ee71ddcebf5eeb4209a4c2fff92ee4a7fe`](https://github.com/cheaper-inference/OmniRoute/commit/95efa7ee71ddcebf5eeb4209a4c2fff92ee4a7fe) | [`e96468ef2733052dd16dbacaf2673484dece0012`](https://github.com/cheaper-inference/OmniRoute/commit/e96468ef2733052dd16dbacaf2673484dece0012) | PR patch, separating its Bedrock changes from subsequent boundary refactoring |

## Current behavior and evidence

### Existing Claude cache markers and pass-through rescue

The local native Claude path already calls `anchorClaudeCache` after request savers and again after one-shot historical-thinking recovery in `open-sse/handlers/chatCore.js`. `open-sse/translator/formats/claude.js` anchors the final system block and final cacheable tool at one hour, removes markers from thinking and redacted-thinking blocks, and adds a marker to the latest assistant content block. When the request already has a full marker budget it caps markers instead of replacing all client placements. `tests/unit/claude-cache-control.test.js` covers stale offsets, system/tool anchors, a final image block, string content, and thinking marker removal.

This is meaningful coverage of marker repair, but it is not equivalent to #18025's complete policy. In particular, the public patch places a breakpoint on the second-to-last user turn as well as the final assistant, runs only when the entire body is marker-free, and honors `supportsPromptCaching: false` / `cacheControlPassthrough: "strip"` connection overrides. The local anchor has no corresponding connection override parameter and does not synthesize that user-turn marker. Its marker-present behavior is intentionally distinct: below four request-wide markers it clears message placements and chooses one fresh latest assistant marker; at/above the cap it retains/caps client placements. That behavior should not be silently conflated with a marker-less-only rescue.

### Native tool history is a separate case

`tests/unit/omni-claude-outbound-tool-result-cache-markers.test.js` proves the native Claude and Anthropic routes hoist the first valid nested `tool_result.content` cache marker to its parent, discard nested markers, preserve the result payload and `is_error`, enforce the four-marker cap, reject malformed marker shapes, and leave unverified Claude-compatible providers untouched. The existing test also covers already-marked parent precedence and caller-owned input immutability. Separately, `tests/translator/port-2401-reasoning-history-bridge.test.js` verifies opaque `redacted_thinking` and `tool_use` history order survives native Claude normalization without invented thinking placeholders. These fixtures establish existing native tool-history handling; they do not demonstrate #18025's missing user-turn breakpoint or its opt-out policy.

### Anthropic API-key fallback and unknown blocks

The #18532 patch adds `anthropic` to `prepareClaudeRequest`'s `supportsPromptCaching` provider set and tests fallback-to-heuristic markers against the OAuth `claude` route. Its accompanying unknown-block test explicitly strips the marker before comparing an unknown `container_upload` block, showing the block remains intact while receiving the user-turn breakpoint.

Locally, `prepareClaudeRequest` already treats `anthropic` as a first-party native route for complete tool definitions, and uses `allowCacheControl` unless provider quirks disable it. It adds the one-hour system/tool markers and the latest assistant marker, but removes cache markers from every message content block in pass 1. The existing `claude-cache-control` fixtures cover those rules, not marker insertion on an unknown block in the second-to-last user turn nor a marker-free preserve-mode heuristic comparison between `anthropic` and `claude`. This is a narrow, demonstrated gap in the specific fallback/user-turn behavior; the source-only provider setup in the enclosing merge is outside scope.

### Bedrock Claude thinking and cache-point conversion

The local `open-sse/executors/bedrock.js` converts OpenAI messages, system text, and tools to Converse shapes. `openAIToBedrockConverse` copies a Claude `thinking` object into `additionalModelRequestFields`, but current Bedrock cache-related fixtures found in the repository do not exercise `cachePoint` conversion. The executor contains no `cachePoint` builder or conversion of Claude `cache_control` markers. Thus client breakpoints on system, user, assistant, or tool history are not converted into Bedrock Converse cache points by this path.

PR #19181's relevant behavior adds explicit Converse cache points for supported Claude/Nova families, caps them at four with the newest markers retained, and translates thinking / `reasoning_effort` through Claude thinking configuration. The exact supplied head `95efa7ee71ddcebf5eeb4209a4c2fff92ee4a7fe` is a follow-up boundary refactor of that work: it centralizes `claudeModelSupportsThinking` in the existing thinking-config module instead of introducing another executor-to-`src` dependency. That refactor is not itself a cache conversion change.

## Dispositions

- **#18025 — Partial overlap; narrow follow-up warranted.** Existing pass-through anchoring and native tool-result marker normalization cover significant rescue and history behavior. The marker-less-only policy, second-to-last user breakpoint, and connection opt-outs are not evidenced locally. If ported, keep native `tool_result` handling independent and add offline cases for marker-free rescue, already-marked byte-preservation, thinking/blank-block exclusions, both connection opt-outs, and native tool-result history.
- **#18532 — Narrow gap; ordinary offline acceptance warranted.** Local preparation already supports general cache anchoring on Anthropic, but strips user-message markers and lacks fixture proof for the API-key heuristic on a second-to-last user turn containing an unknown block. Add offline acceptance comparing `anthropic` with `claude` under the existing preserve/fallback mode and asserting the unknown block's payload is unchanged while the marker is attached at a valid block boundary. No provider configuration change is part of this disposition.
- **#19181 — Demonstrated Bedrock gap; ordinary offline acceptance warranted.** Current Bedrock conversion forwards thinking but does not convert cache markers to Converse points. If implemented, offline tests should cover system/user/assistant/tool cache points, supported-family gating, the four-point limit and newest-marker retention, and Claude thinking capability / unsupported model behavior. Preserve the local boundary convention by exposing model-capability lookup through the existing Claude thinking-config layer rather than adding a direct Bedrock-to-`src` dependency. Live Bedrock traffic is unnecessary.

No code or test changes are included in this report-only review.
