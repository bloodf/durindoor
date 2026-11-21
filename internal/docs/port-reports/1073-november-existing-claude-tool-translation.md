# #1073 November existing Claude tool translation review

## Scope and pins

This review compares the exact pinned OmniRoute changes with the current local OpenAI ↔ Claude request translator and ordinary offline fixtures. It covers existing tool declarations, tool-call history IDs, and named forced tool choice. Provider-native new tools, integrations, and sign-in are outside scope.

| PR | Pinned head | Enclosing merge | Compared change |
| --- | --- | --- | --- |
| [OmniRoute #18314](https://github.com/cheaper-inference/OmniRoute/pull/18314) | `26af30d60f95c426dd85b1eb41e229b0ff8bf636` | `67038ae486c82b379172b62227becf9a4e5976a7` | [Pinned head patch](https://github.com/cheaper-inference/OmniRoute/commit/26af30d60f95c426dd85b1eb41e229b0ff8bf636) |
| [OmniRoute #18688](https://github.com/cheaper-inference/OmniRoute/pull/18688) | `fbef80fe0e2ac5184608a0ccc805af660c07943d` | `8bb848100828250e73aca13bf87999d4d7070e51` | [PR diff](https://github.com/cheaper-inference/OmniRoute/pull/18688/files) |
| [OmniRoute #19000](https://github.com/cheaper-inference/OmniRoute/pull/19000) | `d1aa5f5ac125b3ea793627d8c91bfc37cd8d6b47` | `6abb2980b35b1104b6c53d1ede6e4e0d0eb9845d` | [PR diff](https://github.com/cheaper-inference/OmniRoute/pull/19000/files) |

The #18314 pinned commit is a type annotation on the raw tool schema after custom-tool unwrapping. It does not change runtime mapping: local `openai-to-claude.js` unwraps `tool.function ?? tool`, names the tool from the resulting data, normalizes its schema, and records the prefixed-to-original name mapping. The ordinary offline fixture [bugs-openai-to-claude-tools-no-type.test.js](../../../tests/translator/bugs-openai-to-claude-tools-no-type.test.js) exercises wrapped, bare-function, and flat Claude-shaped declarations.

## Current behavior and fixture evidence

Local OpenAI-to-Claude translation prefixes declared tools with `CLAUDE_OAUTH_TOOL_PREFIX`, stores the corresponding original name in `_toolNameMap`, and prefixes historical `tool_use` calls. `convertOpenAIToolChoice` maps a named OpenAI function choice to Claude `{ type: "tool", name }`, but the resulting name is not reconciled against the declared-tool map. The #19000 diff adds that reconciliation for Claude OAuth and removes the prefix again in the Antigravity adapter. Locally, Antigravity already strips the prefix from declarations and history, but its adapter does not separately strip a forced choice.

Local history handling correlates tool results to tool calls by call ID and maintains pending tool-use IDs while converting messages. The #18688 change addresses a different boundary: signed-thinking restoration backed by an ID-keyed store, skipping restoration for an assistant turn whose tool-call ID is duplicated elsewhere in the input history. The local translator has no corresponding signed-thinking restore path (`restoreClaudeThinkingBlocks` / ambiguous-ID guard); signed thinking in history is covered by [fable-mythos-thinking-sanitation.test.js](../../../tests/translator/fable-mythos-thinking-sanitation.test.js) and [openai-to-claude-fable-integration.test.js](../../../tests/translator/openai-to-claude-fable-integration.test.js). Those fixtures test sanitation and preservation, not duplicate-ID store restoration. The upstream workaround therefore does not map to a local behavior gap.

Named choice conversion is covered on the Claude-to-OpenAI direction by [v5-conformance-matrix-claude.test.js](../../../tests/translator/v5-conformance-matrix-claude.test.js); existing OpenAI-to-Claude fixtures cover tool declarations and history, but none asserts that a forced named choice equals its OAuth-prefixed declaration. The #19000 mismatch is a narrow local gap with a deterministic offline acceptance case.

## Dispositions

| PR | Disposition |
| --- | --- |
| #18314 | **No port needed.** The pinned change is type-only; local schema extraction and ordinary declaration fixtures already cover the runtime mapping. |
| #18688 | **No port needed.** The pinned change prevents stale signed-thinking restoration from a store absent in the local request translator. Local duplicate tool-call IDs remain paired by ID/pending occurrence; this PR does not establish a gap in that local correlation behavior. |
| #19000 | **Port a narrow behavior fix.** For a named forced choice, prefix its name only when the matching prefixed declaration exists in the local tool-name map. Preserve the original name when no declaration matches. Apply the equivalent inverse normalization to Antigravity forced choices, whose declarations are unprefixed. Keep the change in the existing OpenAI-to-Claude request translation boundary and preserve local signature scope and naming. |

Ordinary offline acceptance for #19000: translate an OpenAI request with a declared function `lookup` and forced choice `lookup` to the Claude route; assert the declaration and forced choice both use the local OAuth prefix. Also assert undeclared forced names remain unchanged, and Antigravity receives the unprefixed choice matching its declaration. Use the ordinary translator test harness and local fixtures; no provider traffic is needed.
