# #1073 Parallel tool-result ordering and inline result media (OmniRoute #4882, #5100)

Compared against the current fork on branch `orq/tornf6/audit-omni-late-june-existing-parallel-results-and-images-a1` at base commit `a16230c5d661490fe981989f6b3234046169a45d`.

Two upstream pull requests were read at exact pins and compared with the local translator routes that already carry the same representations (Chat, Claude, Gemini, Responses). Only source, fixtures and offline tests were used: no provider traffic, no credentials, no browser, no Docker, no e2e, no paid API. This unit changed no product code, test, workflow, policy or baseline file — it records dispositions and acceptance criteria only.

## Pins

| PR | Enclosing merge | PR head | Base (head parent) | Changed paths in the head diff |
| --- | --- | --- | --- | --- |
| [OmniRoute #4882](https://github.com/cheaper-inference/OmniRoute/pull/4882) | [`b1b3069cd13271eb8c11b057975fe1069270c0d2`](https://github.com/cheaper-inference/OmniRoute/commit/b1b3069cd13271eb8c11b057975fe1069270c0d2) | [`d9f3844ac3d9c7381b68f705622d48c4ccd85119`](https://github.com/cheaper-inference/OmniRoute/commit/d9f3844ac3d9c7381b68f705622d48c4ccd85119) | [`de19b3b087296891f4476242af61508f4059ec45`](https://github.com/cheaper-inference/OmniRoute/commit/de19b3b087296891f4476242af61508f4059ec45) | `open-sse/translator/request/claude-to-openai.ts`, `tests/unit/translator-claude-to-openai-orphan-tool-4385.test.ts` |
| [OmniRoute #5100](https://github.com/cheaper-inference/OmniRoute/pull/5100) | [`135b5daaa5a9fa07ad8a36355a1baca1e7d767d7`](https://github.com/cheaper-inference/OmniRoute/commit/135b5daaa5a9fa07ad8a36355a1baca1e7d767d7) | [`69be8871847eb439ba13bed8d4c66e81eadaf2d2`](https://github.com/cheaper-inference/OmniRoute/commit/69be8871847eb439ba13bed8d4c66e81eadaf2d2) | [`964ed04d3bd5e46af6231449386f3d7c42295520`](https://github.com/cheaper-inference/OmniRoute/commit/964ed04d3bd5e46af6231449386f3d7c42295520) | `CHANGELOG.md`, `open-sse/translator/request/claude-to-openai.ts`, `tests/unit/claude-to-openai-image-toolresult.test.ts` |

Diff selection:

- **#4882** — the enclosing merge `b1b3069cd13271eb8c11b057975fe1069270c0d2` has the same parent as the head and an identical tree (the tree diff against the head is empty), so the head diff is the complete change. It replaces the standalone orphan-tool filter with `regroupToolMessages`, which re-attaches every `role:"tool"` message to the assistant turn that issued the call, in that assistant's `tool_calls` order, and drops tool messages whose `tool_call_id` matches no assistant call.
- **#5100** — the enclosing merge `135b5daaa5a9fa07ad8a36355a1baca1e7d767d7` carries 55 unrelated changed files (`+1827/−85`) relative to the PR head, so the **exact head diff** `69be8871847eb439ba13bed8d4c66e81eadaf2d2^..69be8871847eb439ba13bed8d4c66e81eadaf2d2` was used. That head is not a descendant of the #4882 head, but its base already carries the regrouping (it entered the release branch earlier through `Release v3.8.36`), so the two patches are independent on their own bases.
- The #5100 head diff lifts a base64 image out of a nested `tool_result` into a `data:` `image_url` part in the following user turn, and credits `decolua/9router#2123`.

## Current local behavior

### Owners in this fork

| Concern | Local owner |
| --- | --- |
| Claude → OpenAI request conversion | [`open-sse/translator/request/claude-to-openai.js`](../../../open-sse/translator/request/claude-to-openai.js) (upstream `.ts` counterpart) |
| Pair repair / orphan salvage shared by all routes | [`open-sse/translator/concerns/toolCall.js`](../../../open-sse/translator/concerns/toolCall.js) — `repairDisplacedToolResults` (`:606`), `fixMissingToolResponses` (`:660`), `salvageOrphanedToolResults` (`:1033`) |
| Pipeline wiring | [`open-sse/translator/index.js`](../../../open-sse/translator/index.js) (`:126-127` before the pivot, `:281` before `filterToOpenAIFormat`) |
| Runtime sequence | [`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js) (`:676-678` source passes, `:755` translation, `:1008-1009` translated-body passes) |
| Claude → Gemini direct route | [`open-sse/translator/request/claude-to-gemini.js`](../../../open-sse/translator/request/claude-to-gemini.js) (`:96-109`) |

### Turn ordering

`claude-to-openai.js:172-205` (`fixMissingToolResponsesOpenAI`) only inspects the **contiguous** tool run that follows an assistant turn. `claude-to-openai.js:356-428` splits a Claude user turn that carries both a `tool_result` and other blocks into a tool message plus a following user message. When that following user message lands *between* two results of the same parallel turn, the contiguous scan no longer sees the later real result, so the translator synthesizes `[No response received]` for it. The later `fixMissingToolResponses` pass in `chatCore.js:1009` then treats that same real result as an extra and removes it (`[Translator] Dropped extra tool result for call_id=… (no unanswered call)`).

Fixture evidence (offline; Claude-format request translated to an OpenAI-format upstream, with the `chatCore.js:676-678` / `:755` / `:1008-1009` sequence applied):

| Fixture | Source shape | Outbound body | Result |
| --- | --- | --- | --- |
| Upstream #4882 fixture | one assistant turn with `tool_use` `callA` + `callB`; first user turn carries `tool_result callA` **and** text; second user turn carries `tool_result callB` | `assistant[callA,callB]`, `tool callA "result A"`, `tool callB "[No response received]"`, `user "and here's more context"` | **real `result B` lost** |
| Both results in one carrier | one assistant turn, one user turn with both `tool_result` blocks | `assistant[c1,c2]`, `tool c1 "r1"`, `tool c2 "r2"` | correct |
| Two pure carriers, consecutive turns | one assistant turn, two user turns, one `tool_result` each | `assistant[c1,c2]`, `tool c1 "r1"`, `tool c2 "r2"` | correct |
| Second carrier also carries text | text rides with the *last* result | `assistant[c1,c2]`, `tool c1 "r1"`, `tool c2 "r2"`, `user "tail"` | correct |
| Results separated by a plain user turn | `tool_result`, user text, `tool_result` | `assistant[c1,c2]`, `tool c1 "r1"`, `tool c2 "r2"`, `user "queued note"` | correct (hoisted by `repairDisplacedToolResults`) |

So the local defect is narrower than upstream's report: the parallel-result ordering only breaks when **one Claude user turn carries a `tool_result` together with other content** and a later turn carries the second result of the same assistant turn. The "results separated by a queued user message" case — the shape already ported for upstream #18709 and pinned in [`tests/unit/omni-displaced-tool-results.test.js`](../../../tests/unit/omni-displaced-tool-results.test.js) — is already correct.

Other representations are already correct and were not touched by either upstream patch:

- Chat → Chat and Responses → Chat: displaced results are hoisted next to their assistant (`repairDisplacedToolResults`), producing `assistant[c1,c2]`, `tool c1`, `tool c2`, `user …`.
- Gemini → OpenAI: same shape after conversion (`assistant[call_a,call_b]`, `tool call_a`, `tool call_b`, `user …`).
- Claude → Claude: native `tool_result` blocks of one assistant turn are merged into a single user turn; no OpenAI ordering rule applies.

### Inline result media

The local contract for nested media inside a tool result is *reference, not bytes*:

- Claude → OpenAI: a nested base64 image becomes the bounded placeholder `[tool result omitted image: <media_type>]` (`claude-to-openai.js:229-234`, `:361-394`); a nested **URL** image is lifted as a real `image_url` part in the following user turn (`claude-to-openai.js:248-253`, `:388-392`, `:420-428`); a nested document keeps an `http(s)` URI verbatim and any other document source is an explicit `UNSUPPORTED_DOCUMENT` 400 (`claude-to-openai.js:236-246`, `:375-384`).
- Pinned by [`tests/translator/bugs-claudeCode-context.test.js`](../../../tests/translator/bugs-claudeCode-context.test.js) (`:113-147`: placeholder names the media, base64 payload absent from the converted request) and [`tests/translator/v5-conformance-matrix-claude.test.js`](../../../tests/translator/v5-conformance-matrix-claude.test.js) (`:141`: `"ok\n[tool result omitted image: image/png]"`), plus [`tests/unit/combo-fusion-media-wire.test.js`](../../../tests/unit/combo-fusion-media-wire.test.js) (`:233-238`: the outbound wire body carries the placeholder and never the PNG bytes).
- Chat → Claude keeps the media representation: a tool-result `image_url` becomes a Claude image block ([`tests/translator/tool-result-image-url.test.js`](../../../tests/translator/tool-result-image-url.test.js)).
- Responses tool output: URL media is lifted, unsupported output parts fail closed with `UNSUPPORTED_TOOL_OUTPUT` 400 ([`tests/translator/v5-conformance-tool-media-ceilings.test.js`](../../../tests/translator/v5-conformance-tool-media-ceilings.test.js) `:60-121`).

One observation outside both patches: the direct Claude → Gemini route stringifies a nested **base64** image into the Gemini result text while lifting only URL images (`claude-to-gemini.js:96-109`). That route was not changed by #5100 and is not part of either disposition below; it is recorded here because the same "no raw bytes in tool-result text" rule that the OpenAI route follows is not applied there.

## Dispositions

### #4882 — narrow gap, port recommended (ordering half only)

The upstream defect class is **not** covered by the current fork for the Claude → OpenAI route: a parallel tool result can be replaced by `[No response received]` and the real result can be dropped from the outbound body.

What the fork already has and what the port must keep:

- The fork's ordering repair runs on the **source** body (`translator/index.js:126-127`) and again on the OpenAI-shaped body before `filterToOpenAIFormat` (`translator/index.js:281`). It cannot see this case because the split that breaks the tool run happens *inside* `claude-to-openai.js`, after the source-side repair has already seen a contiguous result run.
- Upstream's `regroupToolMessages` drops orphan tool results. The fork does not drop them: `salvageOrphanedToolResults` (`toolCall.js:1033`) folds an orphan into non-lossy user text (`[Tool result: …]`), and `fixMissingToolResponses` logs and removes a result that duplicates an already-answered id. A port should adopt the **ordering** behavior and keep the fork's salvage semantics.
- The fork's unanswered-call placeholder stays `[No response received]` (`toolCall.js:502`), including for a genuinely unanswered parallel call.
- No new provider, credential path, tool behavior or schema entry is involved: the change stays inside the existing Claude → OpenAI request translation.

### #5100 — no port; the local contract already covers the upstream defect

The upstream defect is that an image-only `tool_result` is `JSON.stringify`-ed, so the base64 payload lands in the tool message as text and inflates the request context. That defect **does not exist** on the local Claude → OpenAI route: the nested base64 image is replaced by a bounded media-type placeholder and no bytes reach the upstream request (fixture output above; `base64 payload absent from converted request` in `bugs-claudeCode-context.test.js:131`).

Upstream's remedy — forwarding the bytes as a `data:` `image_url` — conflicts with the local contract that was deliberately ported into this fork by commit `e9d61d9d036` (`port(upstream): #3772 - tool_result media placeholder`), whose rationale is recorded in `claude-to-openai.js:361-369` (raw base64 burns ~100 KB+ tokens per screenshot and trips upstream payload validators) and is pinned by the tests listed above. The fork already forwards nested media *by reference* when the source is a URL, which is the representation the upstream patch replaces rather than extends.

Disposition: **not ported**. The fork keeps the placeholder for nested base64 media and the URL lift for nested URL media. If a future unit wants the model to actually see nested screenshot bytes, that is a contract change to the media policy, not a port of #5100, and it would have to land as an explicit decision with its own size ceiling.

## Ordinary offline acceptance for the #4882 narrow gap

A porting unit may claim this gap closed only when all of the following hold, verified offline with no provider traffic:

1. **The upstream fixture shape is fixed.** Claude → OpenAI with one assistant turn carrying `tool_use` `callA` and `callB`, the first user turn carrying `tool_result callA` plus an interleaved text block, and a second user turn carrying `tool_result callB`, must yield exactly one tool message per call id, in the assistant's `tool_calls` order, immediately after that assistant, both carrying the real result text — `callA` → `result A`, `callB` → `result B`. The outbound body must not contain `[No response received]`, and the real `result B` must not be dropped.
2. **The interleaved text survives.** The non-tool content of the first carrier stays in the conversation as a user turn placed after the tool run, and no text is moved into a tool message or deleted.
3. **No regression in the neighbouring shapes.** The four currently-correct fixtures in the table above keep their exact outbound bodies (both results in one carrier; two pure carriers; text riding with the last result; results separated by a queued user turn).
4. **The genuinely unanswered case is unchanged.** A parallel turn where one call has no result still receives exactly one `[No response received]` placeholder, and no result text is invented for it.
5. **Orphan handling keeps the local semantics.** A `tool_result` whose id matches no assistant call is still salvaged into user text by `salvageOrphanedToolResults` rather than silently deleted as upstream does, and a result that duplicates an already-answered id keeps the existing logged-removal behavior.
6. **Other representations stay byte-identical.** Chat → Chat, Responses → Chat, Gemini → OpenAI and Claude → Claude outputs for the same histories are unchanged, and the existing displaced-result cases in [`tests/unit/omni-displaced-tool-results.test.js`](../../../tests/unit/omni-displaced-tool-results.test.js) keep passing.
7. **Local media contract untouched.** The nested-base64 placeholder, the nested-URL lift, the `UNSUPPORTED_DOCUMENT` 400 and the `UNSUPPORTED_TOOL_OUTPUT` 400 behaviors are unchanged.

Focused offline command (run from `tests/`, private local store, no network):

```bash
cd tests
node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/omni-displaced-tool-results.test.js \
  translator/bugs-claudeCode-context.test.js \
  translator/bugs-openai-bridge.test.js \
  translator/v5-1335-tool-result-pairing.test.js \
  translator/v5-conformance-matrix-claude.test.js \
  translator/v5-conformance-tool-media-ceilings.test.js \
  translator/tool-result-image-url.test.js
```

## Evidence and limits

- The seven suites listed above were run offline against the current base: **7 files, 230 tests, all passing**. Dependencies came from the machine's local package store with no network fetch.
- The parallel-ordering defect was reproduced with a temporary offline fixture (since removed; no test file is added by this unit) that imported the repository's own translator registration and ran the `chatCore.js` pass sequence. It failed with `expected '[No response received]' to be 'result B'`; the passing neighbour shapes are listed in the ordering table.
- The upstream 400 wording ("Messages with role 'tool' must be a response to a preceding message with 'tool_calls'") is quoted from the upstream patch and its tests. It was **not** reproduced against a live provider, because this unit used no provider traffic.
- No product code, test, workflow, `AGENTS.md`, baseline file or credential store was touched; the only change in this unit is this report.
