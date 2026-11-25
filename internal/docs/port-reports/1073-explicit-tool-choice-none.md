# #1073 Preserve explicit tool_choice none on existing Chat routes (OmniRoute #19341)

Compared 2026-11-20 against local base `e2605ebb14` (branch `orq/tornf6/port-omni-explicit-tool-choice-none-a1`) and OmniRoute [#19341](https://github.com/cheaper-inference/OmniRoute/pull/19341) ("fix(sse): preserve explicit tool_choice none without tools"), state MERGED 2026-11-10, pinned final head `74b0b8b0ad5a9d92c5e6d40ec1014ba2728b7301`, merge `39660ce78e7252db781e1c3e0e689274220c70cd` (single parent `6a49598e41df227fcfc653ad35d507557ee44ac9`).

Evidence is source-diff reading (`gh pr diff 19341`: 6 files, +242/-37 — two production files, three test files, one changelog fragment), local code reading and offline tests. No provider, browser, credential, paid API, Docker, e2e or whole-suite run was used.

## Disposition

**Already satisfied; no runtime change.** Both upstream production edits were *subtractive guards*: each one deleted an explicit `tool_choice: "none"` before dispatch. DurinDoor never had either guard, so the state the upstream fix restores — a meaningful prohibition surviving on a Chat route without tool definitions, including a finalizer that replays valid tool history — already holds. The runtime is kept unchanged and the behavior is pinned by a focused test.

## Source change

Upstream changed two production files:

| Upstream file | Change |
| --- | --- |
| `open-sse/services/targetRequestSanitizer.ts` | `stripToolChoiceWithoutTools` deleted any truthy `tool_choice` that lacked a usable `tools` array. It now exempts the exact string `"none"`, because a prohibition forbids tool calls and stays meaningful without definitions. |
| `open-sse/translator/request/openai-responses.ts` | The `#12141` guard in the Responses→Chat conversion deleted `tool_choice === "auto" \|\| tool_choice === "none"` when the translated Chat `tools` were empty. It now deletes only `"auto"`. |

Everything else in the upstream diff is test coverage (`tests/unit/tool-choice-schema-normalization.test.ts`, `tests/unit/responses-to-chat-no-tools-tool-choice-12141.test.ts`, `tests/integration/tool-choice-none-outbound.test.ts`) and a changelog fragment. The upstream PR body states the same contract explicitly: keep existing handling of auto, required, named-function, absent and null choices; no dummy tools, no history removal, no prompt substitution.

## Local comparison

| Concern | Upstream | Local | Evidence |
| --- | --- | --- | --- |
| Resolved-target sanitization | `open-sse/services/targetRequestSanitizer.ts` → `stripToolChoiceWithoutTools` deleted a dangling `tool_choice`. | No such module exists locally. The resolved-target guard is `stripUnsupportedParams`, which never reads or writes `tool_choice` — it only renames/drops known parameters and clamps token caps. An explicit `"none"` therefore cannot be removed here. | `open-sse/translator/concerns/paramSupport.js:123` (no `tool_choice` reference in the file); no `targetRequestSanitizer*` path in the tree |
| Responses→Chat conversion guard | `#12141` stripped `"auto"`/`"none"` when the translated Chat tools were empty. | No such strip exists locally. The request body is copied (`result = { ...body }`) and the only `tool_choice` rewrite is the object-shape lowering, which leaves the string `"none"` untouched. | `open-sse/translator/request/openai-responses.js:339`, `:700-710` |
| Chat-target normalization | — | `filterToOpenAIFormat` rewrites only object-shaped choices (Claude `{type:"auto"|"any"|"tool"}` → Chat form). A string `"none"` passes through unchanged; an empty `tools` array is dropped separately. | `open-sse/translator/formats/openai.js:132-143`, `:93-96` |
| Existing Chat route (Chat→Chat) | — | `translateRequest` skips the whole translation block when `sourceFormat === targetFormat`, so a Chat request's `tool_choice` reaches dispatch untouched. | `open-sse/translator/index.js:179` |
| Generic executor dispatch | — | The generic executor deletes a forced choice only for DeepSeek V4/Flash models with thinking enabled. It never removes a string `"none"`. | `open-sse/executors/default.js:472-479` |
| Forced-choice validity checks | Codex / WorkBuddy / xAI narrow wire behavior. | Unchanged and untouched: Codex, Grok-CLI and OpenCode-Go delete a forced `{type:"function"}` choice whose name is not declared in `tools[]`. They inspect object-shaped choices only. | `open-sse/executors/codex.js:421-427`, `open-sse/executors/grok-cli.js:255-260`, `open-sse/executors/opencode-go.js:145-153` |
| Tool declaration dedupe | — | `dedupeTools` drops declarations only; it never touches `tool_choice`. | `open-sse/utils/toolDeduper.js:67-93` |
| Target-specific required omission | — | Unchanged: MiniMax-M3 `required` → `auto`; Qwen thinking `required`/object → `auto`; OpenCode Muse free tier any non-`auto` → `auto`; Claude thinking models reject `{type:"any"|"tool"}` → `auto`. | `open-sse/translator/index.js:289-300`, `open-sse/executors/qwen.js:39-46`, `open-sse/executors/opencode.js:318-325`, `open-sse/translator/formats/claude.js:527-541` |
| Targets that can express a prohibition | OpenAI `"none"` → Anthropic `{type:"none"}`. | Same mapping locally, so a prohibition stays a prohibition where the wire supports it. | `open-sse/translator/request/openai-to-claude.js:454-482` |

## Deliberate adaptations

- **No runtime adaptation was needed.** The upstream fix removes a guard that deleted the prohibition. DurinDoor has no such guard on either surface, so porting the removal would be a no-op.
- **Upstream's `#12141` `"auto"` strip is absent locally as well.** An explicit `tool_choice: "auto"` with absent or empty tools therefore stays `"auto"` here. That is existing local behavior and is kept, as required; it was not widened, and it is not a regression against upstream (upstream still drops `"auto"`, but that strip exists to protect strict vLLM endpoints and is a separate upstream contract that this port does not import).
- **No upstream module was imported.** `prepareUpstreamBody`, `DefaultExecutor`'s upstream-body preparation and `targetRequestSanitizer.ts` have no local counterpart. The local proof composes the surfaces that do exist: `translateRequest` (which internally runs `filterToOpenAIFormat`) → `stripUnsupportedParams` → JSON serialization of the wire body.
- **Out of scope, deliberately unchanged:** combo fusion (`open-sse/services/combo.js:2179`) strips `tools` and `tool_choice` for its panel calls on purpose ("we want prose"); the upstream PR does not touch fusion either. The operator filters, model-capability rules and the narrow Codex/WorkBuddy/xAI forced-choice validation checks were not broadened or bypassed.

## Existing coverage (before this change)

The prohibition was already asserted in several places, but none of them covered the upstream case:

| Existing test | What it pinned | Gap |
| --- | --- | --- |
| `tests/unit/minimax-m3-tool-routing.test.js:195` | Chat→Chat keeps `"auto"`/`"none"` on MiniMax-M3 | always declares `tools[]`; never the "no definitions" case |
| `tests/translator/v5-conformance-tool-choice-responses.test.js:33` | Chat→Responses keeps the string `"none"` | Chat→Responses only; the Responses→Chat direction is not covered |
| `tests/translator/v5-conformance-matrix-chat.test.js:213` | Chat→Responses keeps `"none"` | same direction gap |
| `tests/translator/bugs-toClaude-context.test.js:106`, `tests/unit/fleet-pr1274-acceptance.test.js:105` | Chat→Claude maps `"none"` to `{type:"none"}` | target-specific mapping, not the Chat route |
| `tests/unit/omniroute-specialized-executors.test.js:456` | web-tool injection is skipped for `"none"` | web-tool helper only |

Nothing asserted the Responses→Chat conversion, the resolved-target guard, a finalizer that replays valid tool history, or the serialized Chat wire body for an explicit `"none"`. The new file covers exactly those, without duplicating the rows above.

## Tests

`tests/unit/omni-explicit-tool-choice-none.test.js` (28 cases, offline, no network/credentials):

1. **Responses→Chat keeps an explicit `none`** with absent, empty and declared tool definitions, and does not mutate the caller's body.
2. **Responses→Chat finalizer**: a request that replays eight completed tool rounds keeps `tool_choice: "none"` and `parallel_tool_calls: false`, and still carries all eight assistant tool-call turns and eight tool results.
3. **Existing Chat route (Chat→Chat)** keeps an explicit `none` with absent, empty and declared tool definitions.
4. **Chat finalizer**: the same eight-round history on the Chat route keeps `tool_choice: "none"`, `parallel_tool_calls: false` and all 17 messages.
5. **Resolved-target sanitization**: `stripUnsupportedParams` keeps an explicit `none` for `openai`, `openrouter`, `openai-compatible-eu-fixture` and `skhynix` across the three tool states, and leaves the caller's body unmutated.
6. **Chat-target normalization**: `filterToOpenAIFormat` keeps `tool_choice: "none"` while dropping an empty `tools` array.
7. **Wire body**: the composed translation → resolved-target guard → serialization path yields a body with `tool_choice: "none"`, `parallel_tool_calls: false`, no `tools` field and all eight tool results.
8. **Unchanged neighbors**: a missing `tool_choice` stays absent; an explicit `"auto"` stays `"auto"`; a validated forced choice is still lowered to the Chat shape `{type:"function",function:{name}}`; the target-specific required omission still applies (MiniMax-M3 `required` → `auto`, Claude thinking `{type:"any"}` → `{type:"auto"}`), and an explicit `none` survives that same Claude guard.

Mutation check: reintroducing the two upstream pre-fix guards (the `#12141` `"auto"`/`"none"` strip in `open-sse/translator/request/openai-responses.js` and a `stripToolChoiceWithoutTools` in `open-sse/translator/concerns/paramSupport.js`) fails 9 of the 28 cases. Both mutations were reverted afterwards; `git status` shows only the new test file.

Command: `rg -q -F 74b0b8b0ad5a9d92c5e6d40ec1014ba2728b7301 internal/docs/port-reports/1073-explicit-tool-choice-none.md && rg -q -F 39660ce78e7252db781e1c3e0e689274220c70cd internal/docs/port-reports/1073-explicit-tool-choice-none.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-explicit-tool-choice-none.test.js)` passed, 28/28. Dependencies came from `pnpm install --frozen-lockfile --offline` (root and `tests/`); nothing was added to a manifest or lockfile.

## Limits

- The upstream integration test's real HTTP-body assertion was not reproduced against a live upstream. The local proof covers the translation, the Chat-target normalization, the resolved-target param guard and the serialized wire body; it does not assert provider-side behavior.
- Upstream's `prepareUpstreamBody` and `targetRequestSanitizer.ts` are not present locally, so their behavior is described from the pinned upstream diff, not from local execution.
- No file under `AGENTS.md`, `.github/workflows/**` or `tests/__baseline__/**` was touched.
