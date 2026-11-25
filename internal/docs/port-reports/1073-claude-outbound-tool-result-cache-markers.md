# 1073: Claude outbound tool-result cache markers

## Source

[OmniRoute #15647](https://github.com/cheaper-inference/OmniRoute/pull/15647), `fix(claude): hoist tool_result.content cache_control and enforce 4-block cap`. Merged 2026-10-07T17:45:45Z. Final head `c1b3aa49068cd416bfd7d5e5065e3bbbed71766d`, merge `8ee4929b5302d5350a7c7710adad1ee2886bc34f`. Its diff touches `open-sse/translator/helpers/claudeHelper.ts` (`prepareClaudeRequest` gains `hoistToolResultCacheControl` and `enforceCacheControlBlockLimit`), a changelog fragment, and `tests/unit/claude-cache-control-placement-400s.test.ts`. The earlier inventory classification, "confirmed applicable gap", is in [1073-october-07-15-row-dispositions.md](./1073-october-07-15-row-dispositions.md).

## Disposition

**Ported narrowly into the existing local outbound preparation.** The upstream `prepareClaudeRequest` is not one function here, so the behavior is adapted onto the two real local paths rather than copied.

| Path | Real preparation | Change |
| --- | --- | --- |
| Native Claude client → `claude`/`anthropic` | `anchorClaudeCache` (`open-sse/translator/formats/claude.js`), called from `open-sse/handlers/chatCore.js` after all request savers and on the signature-recovery retry | New optional `provider` argument. For verified targets it first hoists nested markers, then runs the unchanged cap/anchor logic, so the shared four-marker budget is enforced exactly as before. |
| Bridged OpenAI/other → Claude | `prepareClaudeRequest` (via `translateRequest`) | For verified targets, nested markers are hoisted just before pass 1. Pass 1 already discards every message-level marker (translator-owned anchors), so a bridged request ends with no nested marker and no new marker. The budget stays at system + tool + last-assistant. |

`hoistToolResultCacheMarkers` moves the first **valid** nested `tool_result.content[].cache_control` (`type: "ephemeral"`, `ttl` absent, `5m` or `1h`) onto the enclosing `tool_result` and removes every nested marker, because the parent is the only valid placement. Malformed nested markers (non-objects, unknown type, unknown ttl, null) are dropped and never hoisted. A parent marker already present keeps precedence. Inner parts and the content array are copied, not mutated, so caller-owned objects are untouched. `is_error`, `tool_use_id`, string content, part order and payload are preserved.

## Why the target set is `claude` and `anthropic` only

The upstream message attributes the 400 to Anthropic's own API. Nothing in this repository shows that other Claude-wire providers (GLM, MiniMax, Kimi, DeepSeek, `anthropic-compatible-*` custom endpoints, Ollama) reject, ignore, or depend on nested markers. Ollama variants already drop all Claude cache markers. These stay on their existing compatibility paths, and tests assert their bodies are unchanged. Upstream's 4-block cap for caching targets is not copied separately: local `capCacheControlBlocks` already caps native bodies with head anchors preserved, and the bridged path re-anchors from scratch.

## Preserved contracts

- `open-sse/translator/request/openai-to-claude.js` converter output and both assertions in `tests/translator/tool-result-image-url.test.js` are unchanged; the nested markers are normalized only at outbound preparation, after conversion.
- Earlier attempts that altered intermediate tool results and relaxed that translator test are discarded.
- Identity stripping, cloaking, terminal/`is_error` semantics, flags and command-code translation are not touched.

## Verification (offline only)

`tests/unit/omni-claude-outbound-tool-result-cache-markers.test.js` (14 tests) covers native and bridged paths for both targets, parent precedence, budget (never above four markers), malformed markers, string content, non-mutation, and unverified compatible providers. With the source changes reverted, 10 of the 14 fail; with them, all pass. Focused run: the new test plus `translator/tool-result-image-url.test.js`, 30 tests passing; the wider `translator` directory plus the Claude cache, malformed-history, cache-write-usage and assistant-prefill unit suites passed (105 files, 1906 tests). No provider traffic, credentials, browser, or whole-suite run. Dependencies were installed from the frozen lockfile into private `node_modules`.
