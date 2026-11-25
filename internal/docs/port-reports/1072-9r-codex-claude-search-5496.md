# #1072: 9router #5496 — Claude Code web search through Codex, compared with the current integration

Reviewed 2026-11-21 against DurinDoor `edbf0adfed234833b9744e7cacd83714af165968` (branch
`orq/tornf6/audit-9r-codex-claude-search-5496-a1-l2`) and the exact open upstream pull request
[decolua/9router #5496](https://github.com/decolua/9router/pull/5496), head
[`f5b26e176836a8b000e0279833fdb171524ac1cb`](https://github.com/decolua/9router/commit/f5b26e176836a8b000e0279833fdb171524ac1cb),
base/merge-base [`1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d`](https://github.com/decolua/9router/commit/1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d)
(`# v0.5.112`).

Source state at review: **open and unmerged**, one commit, 15 changed files, +728/−20, title
`fix(translator): support claude code search through codex`, branch `fix/claude-native-search`, opened
2026-11-05, last updated 2026-11-05, mergeable state `dirty` against the current upstream `master`. The
single-commit diff was read as the exact patch, and every touched source file was fetched at the pin
`f5b26e176836a8b000e0279833fdb171524ac1cb` for hunk-level comparison.

This review changed no product code, no test, no `AGENTS.md`, no workflow, no baseline entry, and no
credential. No provider request, browser, Docker, e2e run, or paid API was used.

## Method

The upstream tree has moved far from the fork's, so a whole-file diff is not evidence: the fork's copies
of `open-sse/handlers/chatCore.js`, `open-sse/executors/codex.js`, `open-sse/utils/stream.js` and
`open-sse/translator/formats/claude.js` differ from upstream by hundreds of lines for unrelated reasons.
The comparison was therefore made per upstream hunk: for each of the 15 paths, the upstream change was
located, the fork's corresponding behavior was located, and the two were compared behaviorally. Where the
fork's file happened to match, that is stated as a byte-level fact; otherwise the fork's own code path is
cited.

Three offline probes were used, all against in-memory fixtures and the fork's own modules (no network):
one for the native-route tool filter, one for the SSE→JSON accumulator, and the fork's own Vitest
fixture. Their commands and results are in "Verification performed".

## Reconciliation of the #800 row

The row for this source is still open in the
[#800 reconciliation](800-scan-reconciliation.md): "Large Codex/Claude core change; decompose and review
before any port decision." (`internal/docs/port-reports/800-scan-reconciliation.md:48`). The later
[#1072 qualification, lines 154–212](1072-qualify-large-core-residuals.md) disposed of it as an "applicable gap —
not ported in this work order; it needs a translator route the fork does not have", and recorded a
four-point minimum acceptance list.

The fork has since landed the feature. Two local commits are ancestors of the reviewed head:

- [`4ed6ecd393f61ea285a603477b39bec2d5813919`](https://github.com/bloodf/durindoor/commit/4ed6ecd393f61ea285a603477b39bec2d5813919)
  — `port(upstream): #5496 - Preserve Claude native search over Codex`, 2026-11-20, 15 files, +594/−8.
- [`3d4fd9c93cb7798f44ad6b4003c70f24b8040cde`](https://github.com/bloodf/durindoor/commit/3d4fd9c93cb7798f44ad6b4003c70f24b8040cde)
  — `port(upstream): support Codex native search and Azure request compatibility`, which folds the same
  upstream series together with the Azure request-compatibility half.

The fork's own write-up of that port is
[1072-claude-native-search-codex.md](1072-claude-native-search-codex.md). The #800 row's "still
unqualified" state is therefore superseded for **13 of the 15 upstream paths**: the feature is present,
in a fork-native and in places stricter form. One upstream path is only half-ported, and that half is the
residual recorded below.

## Already represented in DurinDoor

| Upstream path (at the pin) | Upstream hunk | Fork state | Local evidence |
| --- | --- | --- | --- |
| `open-sse/executors/codex.js` | merge `body.include` instead of overwriting it | Represented, fork variant | `open-sse/executors/codex.js:1074-1078` keeps `web_search_call.action.sources` next to `reasoning.encrypted_content`; asserted at `tests/translator/claude-codex-native-search.test.js:22-23` |
| `open-sse/handlers/chatCore.js` | `validateSearchRoute` before dispatch | Represented | `open-sse/handlers/chatCore.js:607-610` returns a 400 from `open-sse/translator/concerns/searchRouting.js:8-17` before translation can drop the tool |
| `open-sse/handlers/chatCore/sseToJsonHandler.js` | search evidence merged into the buffered Claude message | Represented, with a more general guard | `open-sse/handlers/chatCore/sseToJsonHandler.js:508-510` merges the evidence and keeps the classifier projection final; `:472-474` already rejects a non-`completed`/`incomplete` terminal with 502 |
| `open-sse/translator/concerns/search.js` | new shared evidence builder (118 lines) | Represented, byte-identical | `diff` against the file fetched at the pin reports no difference; `open-sse/translator/concerns/search.js` |
| `open-sse/translator/concerns/searchRouting.js` | new route/controls validator (113 lines) | Represented as an 18-line fork-native rewrite | `open-sse/translator/concerns/searchRouting.js:10` (search-type match), `:12` (native-route allow-list), `:13-16` (Codex restriction rejection), `:17` (unsupported-route 400) |
| `open-sse/translator/index.js` | register a direct Responses→Claude response route | Represented, deliberately narrower | `open-sse/translator/index.js:380-383` dispatches to the bridge only when `state.searchEnabled`, so ordinary Responses-on-Claude traffic keeps the existing Responses→OpenAI→Claude path |
| `open-sse/translator/request/claude-to-openai.js` | declaration→hosted search, forced choice, search history | Represented, provider-scoped | `open-sse/translator/request/claude-to-openai.js:118-120` (declaration→`{type:"web_search"}`), `:133` (forced server-search choice), `:300-305` (prior search history folded into text) |
| `open-sse/translator/request/openai-responses.js` | request the search source list | Represented, deliberately stricter | `open-sse/translator/request/openai-responses.js:1021-1029` adds `web_search_call.action.sources` only on the Claude native-search pivot and merges it with the caller's own entries; `:1037-1041` forwards the hosted-search choice only for that pivot |
| `open-sse/translator/response/responses-to-claude.js` | new direct Responses→Claude bridge (341 lines) | Represented, fork-native (306 lines) | `open-sse/translator/response/responses-to-claude.js:94-110` (event and citation collection), `:37-64` (Claude block emission), `:113-176` (pending and late citation handling), `:275-305` (buffered JSON conversion) |
| `open-sse/translator/schema/blocks.js` | `web_search` / `web_search_call` / result block names | Represented | `open-sse/translator/schema/blocks.js:12`, `:32-34`, `:44`, `:68` |
| `open-sse/utils/stream.js` | arm the response bridge when a search tool is declared | Represented, fork-scoped | `open-sse/utils/stream.js:237` sets `searchEnabled` for codex + Claude source + a declared `web_search_20250305` |
| `open-sse/utils/usageTracking.js` | `server_tool_use` in the Claude usage allow-list | Represented | `open-sse/utils/usageTracking.js:85` |
| `gitbook/content/en/integration/claude-code.md` | operator note about Codex web-search compatibility | Not a runtime path; no fork equivalent page | the fork's `docs/integrations/codex.mdx:73-75` documents the separate `/v1/alpha/search` surface only; the fork's operator note lives in [1072-claude-native-search-codex.md](1072-claude-native-search-codex.md) |

The four local surfaces named in the work order are therefore covered:

- **Claude-to-Codex hosted search declaration** — `open-sse/translator/request/claude-to-openai.js:118-120`,
  `open-sse/translator/request/openai-responses.js:1021-1029`,
  `open-sse/executors/codex.js:1074-1078`.
- **Responses streaming events** — `open-sse/translator/response/responses-to-claude.js:94-205`,
  `open-sse/translator/index.js:380-383`, `open-sse/utils/stream.js:237`.
- **Citation source handling** — `open-sse/translator/concerns/search.js` (`sourceResults`,
  `searchSources`, `buildSearchEvidence`), consumed at
  `open-sse/translator/response/responses-to-claude.js:107` and `:279-285`.
- **Existing offline fixtures** — `tests/translator/claude-codex-native-search.test.js` (9 cases),
  `tests/unit/codex-search-classifier-projection.test.js`,
  `tests/unit/deepseek-claude-tools.test.js`, `tests/unit/omni-responses-explicit-includes.test.js`.

## Unrelated source behavior

These upstream hunks travel inside #5496 but are not part of the Claude/Codex search contract, so they are
not port candidates from this row.

- **Upstream `validateForcedFunction` (`open-sse/translator/concerns/searchRouting.js`, called from
  `open-sse/handlers/chatCore.js`).** This guards ordinary Responses requests whose `tool_choice` names a
  function that no declared tool provides. It is not search-scoped: a forced *client* function choice is a
  different contract from a forced *hosted search* choice, and the fork's own hosted-search choice is
  already narrowed to the Claude native-search pivot
  (`open-sse/translator/request/openai-responses.js:1037-1041`). Adopting the upstream guard would change
  ordinary Responses choice validation, which this work order leaves alone.
- **Upstream's `case "none"` addition to `convertToolChoice`.** Already present in the fork at
  `open-sse/translator/request/claude-to-openai.js:477`; the upstream hunk is a no-op here.
- **Upstream's `open-sse/transformer/streamToJsonConverter.js` error/`incomplete_details` carry-over.** A
  generic terminal-field preservation change; the fork's accumulator carries its own terminal state
  (`open-sse/transformer/streamToJsonConverter.js:56-65`, `:95-104`) and its own error surface. The
  search-relevant part of that file is discussed under the additional findings below, not here.

## Residual

### Primary: the `anthropic` provider drops a declared Anthropic search tool

**One upstream hunk is only half-ported.** Upstream's
`open-sse/translator/formats/claude.js` hunk keeps a declared Anthropic search tool on every route that
supports it. Upstream's helper covers three provider ids:

```js
// open-sse/translator/concerns/searchRouting.js at f5b26e176836a8b000e0279833fdb171524ac1cb
if (provider === "claude" || provider === "anthropic" || provider?.startsWith("anthropic-compatible")) {
  return true;
}
```

The fork's port adopted the route validator but not this half of the tool filter. The fork's native-route
predicate is narrower:

```js
// open-sse/translator/formats/claude.js:1032
const nativeClaudeRoute = provider === "claude" || provider?.startsWith("anthropic-compatible");
```

`anthropic` is a real provider id in both trees
(`open-sse/providers/registry/anthropic.js:2` locally, and the same id upstream at the pin), it routes to
`https://api.anthropic.com/v1/messages` with the Claude transport format, and it declares no
`quirks.claudeSupportedToolTypes`. So on that route the fork's filter at
`open-sse/translator/formats/claude.js:1033-1039` removes any tool whose `type` is not a plain function —
including `web_search_20250305`.

The fork is internally inconsistent about that route, and the inconsistency is observable:

- `open-sse/translator/concerns/searchRouting.js:12` **admits** the route: for `provider === "anthropic"`
  and `target === CLAUDE`, `validateSearchRoute` returns `null`, so the request is allowed and dispatched.
- `open-sse/translator/formats/claude.js:1033-1039` then **removes** the declared search tool, and the
  empty-tools branch at `:1064-1068` also drops `tool_choice`.

Net effect on the `anthropic` route: the client declares Anthropic's native search tool, the gateway
accepts the request, the tool is silently deleted before dispatch, and the client gets an answer with no
search and no source links. Upstream's #5496 hunk is the fix for exactly this, in the same upstream tree,
against the same provider id: before that PR, upstream's predicate was `if (provider !== "claude")`
(`open-sse/translator/formats/claude.js` at base `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d`, line 675),
so upstream's `anthropic` route had the same loss before #5496 closed it.

This is a defensible small residual because it is deterministic, it is reproducible offline, it needs no
new upstream contract, and it contradicts the fork's own recorded intent: the
[#1072 qualification, lines 154–212](1072-qualify-large-core-residuals.md) states that native Anthropic routes
`claude`, `anthropic` and `anthropic-compatible-*` pass the tool through, and the fork's own port report
records that native Anthropic routes "retain their existing behavior".

**Proposed acceptance when the residual is taken up** (offline, no provider traffic):

1. `prepareClaudeRequest` keeps `{ type: "web_search_20250305", name: "web_search" }` with `type` intact
   for `provider === "anthropic"`, as it already does for `provider === "claude"` and for the
   whitelist route (`tests/unit/deepseek-claude-tools.test.js:49-63`).
2. `validateSearchRoute` still returns `null` for that route, so the validator and the filter agree.
3. The Codex leg is untouched: the Codex executor's include merge
   (`open-sse/executors/codex.js:1074-1078`) and the native-search include contract
   (`open-sse/translator/request/openai-responses.js:1021-1029`) keep their current behavior, and the
   existing fixture `tests/translator/claude-codex-native-search.test.js` passes unchanged.

No such change is made in this work order; this report records the residual only.

### Additional verified findings (recorded, not claimed as port decisions)

- **`open-sse/translator/concerns/searchRouting.js` has no synthetic-history refusal.** Upstream refuses a
  Claude request that replays synthesized (unencrypted) `web_search_tool_result` history onto a native
  Anthropic route, because such a block has no Anthropic `encrypted_content`. The fork's search output
  produces exactly those unencrypted blocks (`open-sse/translator/concerns/search.js`, `actionBlocks` →
  `CLAUDE_BLOCK.WEB_SEARCH_RESULT` entries with no `encrypted_content`), and the fork's validator has no
  such branch. Upstream's answer is a 400 with a "start a new conversation" message; the fork currently
  forwards the request and lets the upstream reject it. Adopting the refusal is a product decision about
  route switching, not a mechanical port.
- **`open-sse/transformer/streamToJsonConverter.js` drops terminal-only output items.** Upstream's
  `mergeTerminalResponse` copies the terminal response's `output` items into the accumulated response and
  carries `error`/`incomplete_details`. The fork's accumulator handles `response.incomplete` and the
  terminal usage (`open-sse/transformer/streamToJsonConverter.js:56-65`) but does not copy terminal output
  items (`:106-113`). The measured difference (probe 2 below) is empty output locally against
  `["web_search_call","message"]` upstream for a stream that carries its items only inside
  `response.completed`. In the forced non-streaming path
  (`open-sse/handlers/chatCore/sseToJsonHandler.js:466-509`) that means a Responses-compatible provider
  that reports its output only in the terminal event yields no `server_tool_use` /
  `web_search_tool_result` blocks and no source URLs. The fork's accumulator deliberately adds a terminal
  tracker, a bounded item count, and duplicate-index rejection (`:41-55`, `:95-104`) that upstream's
  simpler merge does not have, so taking it up needs a scoped decision about that hardening.
- **The fork's generic terminal guard accepts an `incomplete` terminal.**
  `open-sse/handlers/chatCore/sseToJsonHandler.js:472-474` admits `completed` and `incomplete`, whereas
  upstream rejects any search response whose status is not `completed`. Same area as the item above.

## Contracts preserved

- **Native-search include contract.** Unchanged. `web_search_call.action.sources` is requested only on the
  Claude native-search pivot (`open-sse/translator/request/openai-responses.js:1021-1029`), it is merged
  with — not substituted for — the caller's own allow-listed entries
  (`tests/unit/omni-responses-explicit-includes.test.js`), and the Codex executor adds it alongside
  `reasoning.encrypted_content` (`open-sse/executors/codex.js:1074-1078`). Upstream's overwrite of the
  whole `include` array is not adopted.
- **Auth and admission contract.** Unchanged. The route validator still rejects an unsupported route with
  a 400 before dispatch (`open-sse/handlers/chatCore.js:607-610`,
  `open-sse/translator/concerns/searchRouting.js:17`), the Codex restriction rejection still refuses
  controls the backend cannot enforce (`open-sse/translator/concerns/searchRouting.js:13-16`), and no new
  credential, account, or provider surface is introduced. The fork stays stricter than upstream here:
  upstream logs and accepts a positive `max_uses`, while the fork rejects it
  ([1072-claude-native-search-codex.md](1072-claude-native-search-codex.md)).

## Verification performed

Probe 1 — the native-route tool filter (fork modules only, no network):

```js
const { prepareClaudeRequest } = await import("./open-sse/translator/formats/claude.js");
const { validateSearchRoute } = await import("./open-sse/translator/concerns/searchRouting.js");
const body = { model: "m", max_tokens: 100, messages: [{ role: "user", content: "hi" }],
  tools: [{ type: "web_search_20250305", name: "web_search" }] };
for (const provider of ["anthropic", "claude", "deepseek"]) {
  console.log(provider, validateSearchRoute(body, "claude", "claude", provider),
    prepareClaudeRequest(body, provider, null, "conn").tools);
}
```

Result:

```
anthropic  validateSearchRoute: null | tools after prepare: undefined
claude     validateSearchRoute: null | tools after prepare: [{"type":"web_search_20250305","name":"web_search",…}]
deepseek   validateSearchRoute: null | tools after prepare: [{"type":"web_search_20250305","name":"web_search",…}]
```

The `anthropic` route is admitted by the validator and then stripped; `claude` and the whitelist route
`deepseek` keep the tool.

Probe 2 — the SSE→JSON accumulator, fork module against the module fetched at the pin
`f5b26e176836a8b000e0279833fdb171524ac1cb`, same two SSE fixtures:

```
--- terminal-only ---
  local    status: completed output types: []
  upstream status: completed output types: ["web_search_call","message"]
--- with output_item.done ---
  local    status: completed output types: ["web_search_call","message"]
  upstream status: completed output types: ["web_search_call","message"]
```

The fork's existing fixture only exercises the second shape, which is why the difference is not covered.

Fork fixture run (offline, no credentials):

```sh
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 translator/claude-codex-native-search.test.js
```

Result: 1 file, 9 tests, all passing.

No provider request, credential, browser, Docker, e2e run, paid API, workflow, baseline file, or
`AGENTS.md` was touched. `tests/__baseline__/known-fails.txt` was not modified, no test was skipped or
weakened, and the full suite was not run in this unit.

## Review limits

- The upstream pull request was **open and unmerged** at the reviewed head
  `f5b26e176836a8b000e0279833fdb171524ac1cb`, whose merge base is
  `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d` (`# v0.5.112`). Upstream state can change after that pin;
  re-check before acting on the residual.
- This is a source, diff, and local-behavior comparison. It does not claim upstream acceptance, and the
  probes use in-memory SSE fixtures rather than a live provider.
- The fork's copies of the upstream files have diverged for unrelated reasons, so "represented" above means
  the upstream behavior is present in the fork, not that the upstream patch applies.
- The residual is a defect in the fork's own native-route handling, not a port backlog item for the
  Codex search feature: the Claude-to-Codex path itself is complete against the reviewed upstream head.
