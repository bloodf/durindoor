# 1073: Explicit client include fields on Responses routes

Checked 2026-11-21 against [OmniRoute #2154](https://github.com/cheaper-inference/OmniRoute/pull/2154), head `69d1a53e59913a5c8bbef4df291cf3ce0183ac20`, merged into `release/v3.8.0` as `fca89049c90127b48380c624879fb01bd3d5b5c8`, "fix(openai-responses): propagate include so chat clients stream reasoning summaries".

## Disposition: **Ported, adapted to local code**

## Residual confirmed

Local behavior did **not** already cover the contract. `openaiToOpenAIResponsesRequest` in `open-sse/translator/request/openai-responses.js` builds the Responses wire body field by field (`model`, `input`, `instructions`, `tools`, `tool_choice`, `reasoning`, …) and never read the caller's `include` array, so a chat client that asked for `reasoning.encrypted_content` lost the request on the way upstream. The provider then answered with an empty reasoning summary and the client saw no thinking stream.

Where the `include` field lives in this fork before the port:

- `open-sse/translator/request/openai-responses.js` — `openaiToOpenAIResponsesRequest` (Chat → Responses) dropped the caller's array. This is the residual the port closes.
- `open-sse/translator/request/openai-responses.js` — `openaiResponsesToOpenAIRequest` deletes `result.include` (Responses → Chat omission). Retained.
- `open-sse/translator/formats/responsesApi.js` — `convertResponsesApiFormat` deletes `result.include` (the worker-side Responses → Chat lowering). Retained.
- `open-sse/translator/request/openai-responses.js` — the native Responses branch (`body.input` present) passes the body through, so a native Responses client's own `include` already survived. Retained.
- `open-sse/executors/codex.js` — the Codex default `include: ["reasoning.encrypted_content", …]`. Retained.
- `open-sse/translator/concerns/paramSupport.js` — the per-model `dropInclude` filter. Retained.

## Upstream diff and local adaptation

Upstream adds eight lines to `openaiToOpenAIResponsesRequest`: copy `root.include` into `result.include` when the caller sent a non-empty array. Upstream copies the array verbatim.

Local change:

- `open-sse/translator/schema/blocks.js` — new `RESPONSES_INCLUDE` map and `RESPONSES_INCLUDE_ENTRIES` list holding the Responses include vocabulary this fork already reasons about: `reasoning.encrypted_content`, `message.output_text.logprobs` and `web_search_call.action.sources`. The schema module is the documented home for these strings (`AGENTS.md`, translator conventions), so no include value is hardcoded in the translator.
- `open-sse/translator/request/openai-responses.js` — a caller's `include` array is preserved on the Responses wire, filtered to that vocabulary.

Why the vocabulary filter instead of a verbatim copy: upstream forwards whatever the caller sent, but this fork has a standing contract that an unsupported include value is not forwarded. `tests/translator/claude-codex-native-search.test.js` asserts that a Chat request carrying `include: ["arbitrary"]` reaches the Responses wire with no `include` at all. A verbatim copy would have failed that existing test, and changing that assertion would have weakened an existing contract. Filtering to the entries the Responses contract defines keeps the contract, drops a value that could only earn an upstream 400, and still delivers the upstream fix for every real include entry. It does not broaden the supported includes beyond the existing target semantics: the set of values that can reach the wire is exactly the Responses include vocabulary, and the target keeps the last word on top of that (`open-sse/executors/codex.js` merge, `paramSupport.js` `dropInclude`).

The native-search include is merged instead of replaced: `web_search_call.action.sources` is still produced for the Claude native-search pivot, and the caller's own entries survive alongside it. With no caller entry the result is the previous `["web_search_call.action.sources"]` unchanged.

## Retained contracts

- **Native search include** — same value, same trigger (a Claude `web_search_20250305` declaration plus a Responses `web_search` tool).
- **Codex defaults** — `open-sse/executors/codex.js` is untouched; the Codex wire include is still `["reasoning.encrypted_content", …]`.
- **Supported field filtering** — `stripUnsupportedParams` still removes `message.output_text.logprobs` for `gpt-6-astra` and still deletes an emptied `include`.
- **Native Responses passthrough** — unchanged.
- **Responses → Chat omission** — unchanged in both `openaiResponsesToOpenAIRequest` and `convertResponsesApiFormat`.

## Scope notes

- Only the Chat → Responses request translator changes, plus the include vocabulary it reads. No tool is enabled, no option UI is added, no provider registry entry changes, and no protected internal metadata is exposed.
- The Claude source path is unaffected: `claudeToOpenAIRequest` builds a fresh body and copies only known fields, so a Claude request never carries an `include` into the pivot. The #1072 statement that client-supplied `include` fields are not forwarded by the Claude native-search conversion still holds.
- A caller-provided include naming an entry outside the vocabulary is dropped instead of forwarded. That is a deliberate boundary of this port, not an oversight: it keeps an unsupported value from turning into an upstream 400 and keeps the existing fork contract intact. A future Responses include value can be added to `RESPONSES_INCLUDE` once this fork knows it.

## Evidence

Offline only: no provider calls, credentials, browser, Docker or e2e.

- New `tests/unit/omni-responses-explicit-includes.test.js`: 13 tests, importing `translator/registerAll.js`. It covers a forwarded caller include, multiple supported entries, no include invented when the caller sent none, unsupported entries dropped, malformed include values ignored, the caller's array left untouched, the native Responses passthrough, the Responses → Chat omission (both `openaiResponsesToOpenAIRequest` and `convertResponsesApiFormat`), the native-search include and its merge with caller entries, the Claude → Responses native-search include, the Codex executor default and the per-model `dropInclude` filter.
- Focused command: `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-responses-explicit-includes.test.js` — 13 pass.
- `tests/translator/` — 92 files pass, 9 skipped; 1823 tests pass, 34 skipped.
- `tests/unit/` — full sweep: 21806 tests pass, 74 skipped. Two environment gaps had to be closed first, neither of them related to this change: the first run reported 36 failing files that all failed on the missing `better-sqlite3` native binding (the install used `--ignore-scripts`), and seven more failed on missing `cli/` and `website/` workspace modules (`nodemon`, `fumadocs-mdx/next`, `website/node_modules/react`). After `pnpm rebuild better-sqlite3` and `pnpm -C cli install --frozen-lockfile` plus `pnpm -C website install --frozen-lockfile`, every one of those files passes.
- Include-adjacent suites (`translator/claude-codex-native-search`, `unit/openai-responses-strip-fields`, `unit/astra-gpt-6`, `unit/codex-executor`, `unit/grok-cli-reasoning-strip`, `unit/grok-cli-build-protocol`) — 6 files, 49 tests pass.
- `npx eslint` on the three changed source files and `node scripts/check-docs.mjs` both exit 0.
- Dependencies came from private frozen installs (`pnpm install --frozen-lockfile --ignore-scripts` at the root and in `tests/`; gitignored `node_modules`).

Limitation: this proves request-body translation only. It does not show that a real provider honors a forwarded include entry, and it says nothing about the response side of the reasoning stream.
