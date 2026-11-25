# #1073 — July existing tool and combo contracts

Reviewed 2026-11-21 against DurinDoor `4d03d0dd64a90e291b9406b9cbe8c9dccd6b89b2` on branch
`orq/tornf6/audit-omni-july-existing-tool-and-combo-contracts-a1`. Source:
[`cheaper-inference/OmniRoute`](https://github.com/cheaper-inference/OmniRoute).
This is a bounded source-change comparison and a disposition ledger. It produces no owner selection list,
no product edit, no code and no fixture file.

## Scope and method

Three merged July 2026 OmniRoute pull requests were compared against the current DurinDoor checkout. For
each one the **exact merged tree** was read out of the read-only public-source scratch mirror at
`/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git`, diffed against its **first parent** — not against
a title, a path list, or an old port commit in local ancestry:

| PR | Exact merged tree | First parent (diff base) | Merge shape | Changed paths in the merged diff |
| --- | --- | --- | --- | --- |
| [#6937](https://github.com/cheaper-inference/OmniRoute/pull/6937) | `747bce2f10a701054dbeab4ff51e7dd441faf96e` | `73327dfc819d1b069ccc5b1e6d924c5349d87683` | merge, one parent | `open-sse/translator/response/openai-responses.ts`, `tests/unit/responses-translation-fixes.test.ts` |
| [#7545](https://github.com/cheaper-inference/OmniRoute/pull/7545) | `6ca35315bb710042d292580ded55c14ddbcfea13` | `8e011554fd78c883246560ffca72bcd12e91b975` | merge, one parent | `changelog.d/fixes/7545-combo-failover-truncated-sse.md`, `open-sse/services/combo/validateQuality.ts`, `tests/unit/validate-response-quality.test.ts` |
| [#7779](https://github.com/cheaper-inference/OmniRoute/pull/7779) | `eba6ecaf2bd2b5b99b9a0c9797255838571ca6b5` | `f8dd12b7211fdefca5306dfc9c67f76286563605` | merge, one parent | `config/quality/file-size-baseline.json`, `open-sse/handlers/chatCore.ts`, `open-sse/services/autoCombo/virtualFactory.ts`, `src/sse/handlers/chat.ts`, `src/sse/handlers/chatHelpers.ts` |

Each diff was read hunk by hunk and then compared with the local implementation and the local fixtures.
Local comparison used static source reading plus **one bounded offline probe** (see §Probe) that drove the
local Responses translator directly with synthetic Chat chunks. No provider request, no paid API, no
credential, no browser, no Docker, no e2e run and no whole-suite run was made. No workflow, baseline or
`tests/__baseline__/known-fails.txt` file was touched.

### Probe

The local `tests/` package has no installed dependencies in this checkout (`tests/node_modules` is absent) and
the repository root has no `node_modules`, so Vitest could not be run. Instead the local translator was
executed directly with Node's ESM loader:

```
node --input-type=module -e "<inline script>"
```

The inline script registered a resolver hook that (a) maps the `@/…` path alias to `src/…` and the
workspace-root-relative `open-sse/…` / `src/…` specifiers to absolute paths, and (b) stubs the two
third-party packages that are not installed in this checkout — `undici` and `uuid`. Neither stub is on the
Responses translation path; both are import-time dependencies of unrelated modules pulled in by the
translator registry. The probe was a shell one-liner: it wrote **no file into the repository**, and no
temporary file was left behind.

## Disposition ledger

| Source PR | Exact merged tree | Classification | Disposition |
| --- | --- | --- | --- |
| [#6937](https://github.com/cheaper-inference/OmniRoute/pull/6937) | `747bce2f10a701054dbeab4ff51e7dd441faf96e` | Protocol fix (Responses output_index allocation + item statuses) | **Already present, and strictly stronger locally.** The local translator allocates every Responses item index from one shared monotonic counter, so a tool call can never collide with a preceding reasoning item; `status: "in_progress"` / `status: "completed"` are emitted on the `output_item.added` / `output_item.done` items for both `function_call` and `custom_tool_call`; and call identity (`fc_<call_id>` / `call_id`) is preserved across the announcement, the argument or custom-input deltas and the completion. The upstream fixture's exact scenario reproduces locally. No port required. |
| [#7545](https://github.com/cheaper-inference/OmniRoute/pull/7545) | `6ca35315bb710042d292580ded55c14ddbcfea13` | Reliability fix (combo failover on a truncated upstream SSE) | **Already present for the upstream changed behavior, by a stricter local rule.** The local combo makes its fallback decision at a genuinely pre-exposure boundary: a bounded SSE prefix peek runs before the attempt result is returned, and a stream that produced no content-bearing frame fails over to the next member. A truncated/garbage SSE body therefore fails over locally exactly as upstream #7545 intends, and no retry happens after client-visible data because the peek settles before anything is written to the client. The local gate is **content-based rather than terminator-based**, which makes it stricter than upstream in five named cases recorded below. That divergence is the one open item and carries a bounded offline acceptance fixture. |
| [#7779](https://github.com/cheaper-inference/OmniRoute/pull/7779) | `eba6ecaf2bd2b5b99b9a0c9797255838571ca6b5` | New feature (routing-combo compression assignment) + advertised-limit fallback | **Not applicable — both upstream surfaces have no local counterpart.** The fork has no per-request compression-combo resolution at all: compression is a single global, operator-enabled engine stack. The fork also has no routing-combo concept, and deliberately refuses to resolve a `provider/model` string as a combo, so the upstream provider-prefix lookup has nothing to attach to. The upstream `computeAdvertisedLimits` module and its `8192` fallback have no local equivalent either: unknown output limits stay unknown locally. Porting either half would be a new compression or routing feature, which this inventory excludes. |

---

## #6937 — align Responses tool-call shape for Grok models

### Source contract

Read from the merged tree `747bce2f10a701054dbeab4ff51e7dd441faf96e` against its first parent
`73327dfc819d1b069ccc5b1e6d924c5349d87683`. Two hunks change
`open-sse/translator/response/openai-responses.ts`:

1. **Output-index offset.** `emitToolCall` computes a single index for the whole life of the tool call and
   uses it for the announcement, the argument delta and (via `closeToolCall`) the completion:

   ```ts
   const outputIndex = state.reasoningId
     ? normalizeOutputIndex(state.reasoningIndex) + 1 + normalizeOutputIndex(tcIdx)
     : normalizeOutputIndex(tcIdx);
   ```

   `closeToolCall` repeats the same expression. Before the change both sites used the raw tool-call index
   `tcIdx`, which is `0` for the first tool call — the same slot a preceding reasoning item occupies, because
   upstream allocates the reasoning item's index from the choice index (`state.reasoningIndex = idx`) and
   `normalizeOutputIndex` only clamps a non-integer or negative value to `0`.
2. **Item statuses.** `status: "in_progress"` is added to the `response.output_item.added` item for both the
   `custom_tool_call` and the `function_call` branch, and `status: "completed"` is added to the
   `response.output_item.done` item for both branches.

The upstream fixture added in `tests/unit/responses-translation-fixes.test.ts` asserts only the index
behavior: a `reasoning_content` delta followed by a `tool_calls` delta must produce a reasoning item at
`output_index === 0` and a `function_call` item at `output_index === 1`.

Upstream did **not** change the call identity: the item id stays `fc_${call_id}` and `call_id` stays the
provider's own id, on both the added and the done item.

### Local implementation evidence

**The local allocator is a single shared monotonic counter, not a formula.**

- The counter is created per response state at
  [open-sse/translator/index.js:537](../../../open-sse/translator/index.js)
  (`nextOutputIndex: 0`).
- The reasoning item takes the next slot at
  [open-sse/translator/response/openai-responses.js:233](../../../open-sse/translator/response/openai-responses.js).
- The message item takes the next slot at
  [open-sse/translator/response/openai-responses.js:300](../../../open-sse/translator/response/openai-responses.js).
- The tool-call item takes the next slot at
  [open-sse/translator/response/openai-responses.js:476](../../../open-sse/translator/response/openai-responses.js).

Each site allocates **once**, at first announcement, and stores the value (`state.reasoningIndex`,
`state.msgOutputIndexes[idx]`, `state.funcOutputIndexes[tcIdx]`). Every later delta and every close reads the
stored value — nothing recomputes an index from live state. The consequence is stronger than upstream's
formula: a tool call can never collide with a reasoning item, with a message item, or with another tool call,
regardless of the order in which they arrive.

The local translator's own header already names this contract
([open-sse/translator/response/openai-responses.js:5](../../../open-sse/translator/response/openai-responses.js)):
*"Tool-call shape follows the Responses API spec (OmniRoute #6937): function and custom tool items carry
status in_progress/completed, custom tools (apply_patch) stream via custom_tool_call_input.* events, and
output_index is offset past a preceding reasoning item so items never collide at 0."*

**Added/done statuses are present on both item kinds.**

- `status: "in_progress"` on the `custom_tool_call` announcement at
  [open-sse/translator/response/openai-responses.js:487](../../../open-sse/translator/response/openai-responses.js),
  and on the `function_call` announcement at
  [open-sse/translator/response/openai-responses.js:498](../../../open-sse/translator/response/openai-responses.js).
- `status: "completed"` on the `custom_tool_call` completion at
  [open-sse/translator/response/openai-responses.js:620](../../../open-sse/translator/response/openai-responses.js),
  and on the `function_call` completion at
  [open-sse/translator/response/openai-responses.js:643](../../../open-sse/translator/response/openai-responses.js).

This matches upstream's two added fields exactly, on both branches, and upstream's third field (`status` on the
done item) is present on both branches as well.

**Call identity is preserved across reasoning and custom tools.** The local announcement uses
`id: \`fc_${refCallId}\`` with `call_id: refCallId`
([open-sse/translator/response/openai-responses.js:482](../../../open-sse/translator/response/openai-responses.js)),
the completion uses the same pair
([open-sse/translator/response/openai-responses.js:615](../../../open-sse/translator/response/openai-responses.js)),
and every argument or custom-input delta and completion event carries `item_id: \`fc_${callId}\`` with the
same allocated `output_index`
([open-sse/translator/response/openai-responses.js:598](../../../open-sse/translator/response/openai-responses.js),
[open-sse/translator/response/openai-responses.js:626](../../../open-sse/translator/response/openai-responses.js)).
The reasoning item carries a distinct id namespace — `rs_${state.responseId}_${idx}` at
[open-sse/translator/response/openai-responses.js:234](../../../open-sse/translator/response/openai-responses.js)
— so a reasoning item and a tool call never share an identity.

### Fixture coverage

| Local fixture | Coverage that matters for #6937 |
| --- | --- |
| [tests/translator/port-6937-responses-toolcall-shape.test.js:26](../../../tests/translator/port-6937-responses-toolcall-shape.test.js) | Eight cases over function calls, custom tool calls, declared-vs-name tool-type precedence, deferred announcements, fragmented arguments, and the output-index offset. The offset case is *"offsets tool-call output_index past a preceding reasoning item"* (:81), asserting the reasoning item at index `0` and the `function_call` at index `1` — the upstream assertion. |
| [tests/translator/responses-output-index.test.js:10](../../../tests/translator/responses-output-index.test.js) | *"does not collide a tool call's output_index with a preceding reasoning item"* — through the legacy Responses transform stream, asserting the reasoning item at `0` and that the tool call's index differs, and that the tool call's announcement, argument delta, argument done and item done all share one index. |
| [tests/unit/omni-responses-output-index-stability.test.js:35](../../../tests/unit/omni-responses-output-index-stability.test.js) | *"keeps unique ordered indexes across tool, text, tool segments with reasoning first"* (:73) — the monotonic allocator across reasoning, message and tool items. |
| [tests/unit/openai-responses-stream-tool-identity.test.js:57](../../../tests/unit/openai-responses-stream-tool-identity.test.js) | Call-identity preservation for custom, namespaced and plain function tools, including parallel indexes and out-of-order deltas. |
| [tests/unit/omni-responses-mixed-reasoning.test.js:12](../../../tests/unit/omni-responses-mixed-reasoning.test.js) | Mixed reasoning-plus-tool-call streams through the translator and the stream transformer. |

The upstream fixture file `tests/unit/responses-translation-fixes.test.ts` has no local counterpart **by
name**; the local equivalents are the two files above. The local fixtures assert strictly more than the
upstream fixture, which asserts only the two index values.

### Probe result

The upstream fixture's exact scenario was driven through the local translator. Output (reasoning item, then
`function_call`):

```
response.output_item.added  output_index=0 type=reasoning     id=rs_resp_chatcmpl-grok_0
response.output_item.added  output_index=1 type=function_call  id=fc_call_grok call_id=call_grok status=in_progress  name=lookup
response.function_call_arguments.delta item_id=fc_call_grok output_index=1
response.output_item.done    output_index=0 type=reasoning     id=rs_resp_chatcmpl-grok_0
response.function_call_arguments.done item_id=fc_call_grok output_index=1
response.output_item.done    output_index=1 type=function_call  id=fc_call_grok call_id=call_grok status=completed name=lookup
```

This is upstream's assertion — reasoning at `0`, `function_call` at `1` — reproduced locally.

Two further probes recorded the cases upstream's formula does not fully cover:

```
reasoning + text + tool call  →  done indexes [0, 1, 2]  types [reasoning, message, function_call]
reasoning + two tool calls    →  added indexes 0 (reasoning), 1 (fc_c0), 2 (fc_c1)
reasoning + custom tool call  →  added oi=0 reasoning, oi=1 custom_tool_call status=in_progress
                                 custom_tool_call_input.delta / .done  item_id=fc_call_patch oi=1
                                 output_item.done oi=1 custom_tool_call status=completed
```

**A divergence worth recording, outside the #6937 hunks.** Upstream's merged tree still lets a *message*
item and a *tool call* collide when both follow a reasoning item: upstream allocates the message index as
`state.reasoningIndex + 1` (upstream `openai-responses.ts`, the `delta.content` and `delta.tool_calls`
branches) while the tool call takes `state.reasoningIndex + 1 + tcIdx` — both `1` for the first tool call.
The local monotonic counter removes that collision entirely (`0`, `1`, `2` in the probe above). This is a
local superset, not a gap, and it is already recorded for the sibling upstream change in
[internal/docs/port-reports/1073-responses-output-index-stability.md](../../../internal/docs/port-reports/1073-responses-output-index-stability.md).

**A second divergence, outside the #6937 hunks.** Upstream's merged tree contains a "T37" rule: when a
provider reuses a tool-call index with a *different* call id, upstream closes the superseded call, deletes
its recorded state and starts a new item. The local translator keeps the **first** id seen at an index and
never supersedes it ([open-sse/translator/response/openai-responses.js:467](../../../open-sse/translator/response/openai-responses.js)
— `if (newCallId && !state.funcCallIds[tcIdx]) { state.funcCallIds[tcIdx] = newCallId; }`). This rule was
not introduced by #6937 and is not part of the #6937 contract; it is recorded here so that the difference is
not mistaken for parity. Closing it would change call identity, which this inventory does not touch.

### Disposition

**Already present; no port required.** The upstream #6937 contract — a tool-call item that does not collide
with a preceding reasoning item, `status: "in_progress"` on the announcement and `status: "completed"` on
the completion for both `function_call` and `custom_tool_call`, and a preserved `fc_<call_id>` / `call_id`
identity — is implemented locally and is stronger than upstream in the message-versus-tool-call case. Fixture
coverage exists locally and exceeds the upstream fixture's assertions. **No confirmed residual and therefore
no acceptance fixture is required for this PR.** What remains needed for a reader who wants upstream's own
file identity: upstream's `tests/unit/responses-translation-fixes.test.ts` has no local counterpart by
name, and the local fixtures are the two files listed above.

---

## #7545 — fail over when an upstream SSE stream is truncated mid-lifecycle

### Source contract

Read from the merged tree `6ca35315bb710042d292580ded55c14ddbcfea13` against its first parent
`8e011554fd78c883246560ffca72bcd12e91b975`. The change is confined to
`open-sse/services/combo/validateQuality.ts` and tightens **one** gate — the generic done-branch of the
streaming validator:

```ts
if (!anyContentFound && !sse.hasContentBlock && !sawTerminator && !sawStructuredSSE) {
  log.warn?.("COMBO", "Streaming response ended with no recognized content or SSE terminator — marking as invalid for combo failover");
  return { valid: false, reason: "streaming no recognized content" };
}
```

Before the change the same gate read `!sawAnyBytes`, so **any** byte — even unparseable garbage that never
produced a single SSE frame — satisfied it and the truncated stream was passed through, leaving the client
waiting for events that never arrived.

The replacement tracks two new flags in parallel to the existing lifecycle machinery:

- `sawStructuredSSE` — a parseable `event:` or `data:` frame was seen, even one carrying no recognised
  content (a ping or a metadata frame). This preserves the `#3399` pass-through contract.
- `sawTerminator` — a recognised terminator arrived: `data: [DONE]`, an OpenAI `finish_reason`, a Claude
  `message_stop` / `message_delta` carrying `stop_reason`, or a terminal `usage`-only chunk.

Both new flags only tighten the generic done-branch; the `#1382` (`sse.hasRealContent`) and `#7285`
(`openAi.hasTerminalMarker`) branches are untouched. The upstream fixture adds four cases to
`tests/unit/validate-response-quality.test.ts`: garbage bytes with no terminator and no structured SSE are
**invalid**; a `[DONE]`-only stream is **valid**; an `event: ping` only stream is **valid**; an OpenAI
`finish_reason`-only chunk is **valid**.

### Local implementation evidence

**The upstream module has no local counterpart.** `open-sse/services/combo/validateQuality.ts` does not exist
here — `open-sse/services/combo/` contains only `contextRequirements.js`. A whole-tree search for
`validateResponseQuality`, `validateQuality`, `sawAnyBytes` and `"no recognized content"` returns no hit in
`src/`, `open-sse/` or `tests/`.

**A different mechanism occupies the same boundary: a bounded, pre-exposure SSE prefix peek.**

- The peek is `peekStreamForContent` at
  [open-sse/utils/streamContentPeek.js:153](../../../open-sse/utils/streamContentPeek.js).
- Its contract is stated at
  [open-sse/utils/streamContentPeek.js:5](../../../open-sse/utils/streamContentPeek.js):
  *"The peek reads the client-facing stream until the first frame that carries output. Every consumed byte is
  kept so the caller can replay it unchanged ahead of the unread live body. Nothing reaches the client during
  the peek, which is what makes a retry on another connection safe."*
- Its verdict is `hasContent: outcome === "content" || outcome === "limit" || outcome === "safety_stop"`
  ([open-sse/utils/streamContentPeek.js:170](../../../open-sse/utils/streamContentPeek.js)).
- The frame classifier is `frameCarriesContent`
  ([open-sse/utils/streamContentPeek.js:23](../../../open-sse/utils/streamContentPeek.js)).
  It has **no `finish_reason` branch and no `stop_reason` branch** — verified by reading the whole function
  and by grepping the file for both identifiers (zero hits).

**The combo calls the peek at its pre-exposure failover boundary.**
[open-sse/services/combo.js:1697](../../../open-sse/services/combo.js)
reads the content type and, for `text/event-stream`, calls the peek:

```js
if (contentType.includes(SSE_CONTENT_TYPE)) {
  const { hasContent, body: replayBody, streamError } = await peekStreamForContent(result);
  if (!hasContent) {
    replayBody?.cancel("combo stream contained no meaningful frame").catch(() => {});
    ...
    lastError = "Provider returned an empty stream";
    if (!lastStatus) lastStatus = HTTP_STATUS.SERVICE_UNAVAILABLE;
    log.warn("COMBO", `Model ${modelStr} returned an empty stream, trying next`);
    continue;
  }
```

The `continue` is the failover: the loop proceeds to the next combo member. The attempt's result reaches the
client only on the success exit at
[open-sse/services/combo.js:1751](../../../open-sse/services/combo.js),
and `handleComboChat` returns that `Response` object unchanged to
[src/sse/handlers/chat.js:684](../../../src/sse/handlers/chat.js).
**No byte of an attempt is written to the client before the fallback decision is taken**, so the retry the
upstream PR is about is safe here by construction.

**The exact upstream scenario fails over locally.** For a 200 response whose body is bytes with no
terminator and no structured SSE frame: `frameCarriesContent` returns `false` (the line does not start with
`data:`, or the JSON payload does not parse — [open-sse/utils/streamContentPeek.js:24](../../../open-sse/utils/streamContentPeek.js)
and [open-sse/utils/streamContentPeek.js:29](../../../open-sse/utils/streamContentPeek.js));
the reader reaches EOF and the peek returns `outcome: "empty"`
([open-sse/utils/streamContentPeek.js:198](../../../open-sse/utils/streamContentPeek.js));
`hasContent` is `false`; the combo falls over. The upstream premise — "any byte satisfied the gate" — does
not describe this tree.

**No retry after client-visible data.** Two distinct properties are enforced:

1. *Combo path.* The peek settles before the response is handed to the route handler, so the failover
   decision is always taken pre-exposure. Once content has been seen the peek returns `outcome: "content"`
   and the attempt passes through untouched; a later truncation is surfaced to the client, never retried.
2. *Single-model path.* `holdForEarlyEof` at
   [src/sse/handlers/chat.js:723](../../../src/sse/handlers/chat.js)
   states the rule explicitly at
   [src/sse/handlers/chat.js:712](../../../src/sse/handlers/chat.js):
   *"Content already sent is never retried: nothing is forwarded until the peek settles."* The sibling hop is
   bounded to one attempt per request
   ([src/sse/handlers/chat.js:1076](../../../src/sse/handlers/chat.js)),
   and the regression case is
   [tests/unit/stream-early-eof-failover.test.js:267](../../../tests/unit/stream-early-eof-failover.test.js)
   — *"never retries once content has started, even if the stream then fails"* — which asserts
   `attempted()` is `["conn-one"]` only.

**Local fixtures for the combo boundary.**

| Local fixture | What it asserts about a truncated or empty upstream stream |
| --- | --- |
| [tests/unit/combo-empty-stream-3463.test.js:47](../../../tests/unit/combo-empty-stream-3463.test.js) | `it.each` over *"no bytes"*, *"keepalives only"*, *"a DONE sentinel only"*, *"usage without output frames"* and *"usage without output tokens"* — each must fall through to the next member (`expect(attempted).toEqual(["p1/first", "p2/second"])`). |
| [tests/unit/combo-empty-stream-3463.test.js:100](../../../tests/unit/combo-empty-stream-3463.test.js) | *"replays invalid UTF-8 preamble bytes without rewriting them"* — garbage bytes followed by a content frame do **not** fail over, and the bytes are replayed verbatim. This is the closest local coverage of "bytes present but unparseable". |
| [tests/unit/combo-empty-stream-3463.test.js:122](../../../tests/unit/combo-empty-stream-3463.test.js) | *"returns 503 when every combo member has an empty stream"*. |
| [tests/unit/combo-precontent-error-2068.test.js:57](../../../tests/unit/combo-precontent-error-2068.test.js) | *"keeps genuine empty streams as 503"*. |
| [tests/unit/stream-early-eof-failover.test.js:136](../../../tests/unit/stream-early-eof-failover.test.js) | Direct coverage of the peek's `content` / `empty` / `error` / `timeout` outcomes and byte-exact replay. |
| [tests/unit/omni-first-party-complete-empty-turn.test.js:12](../../../tests/unit/omni-first-party-complete-empty-turn.test.js) | A complete Claude lifecycle with zero content blocks is classified `outcome: "empty"` and still replayed byte-exact. |

The upstream fixture file `tests/unit/validate-response-quality.test.ts` does not exist locally, and neither
does upstream's `open-sse/utils/streamReadiness.ts` / `streamReadinessPolicy.ts` readiness module that
upstream #7545 names as the mechanism handling truncated-but-structured streams. Locally that role is filled
by the content-based peek plus `STREAM_FIRST_CHUNK_TIMEOUT_MS`
([open-sse/config/runtimeConfig.js:101](../../../open-sse/config/runtimeConfig.js)),
which bounds a *slow* stream rather than a *truncated* one.

### Divergence: the local gate is content-based, not terminator-based

Upstream #7545 keeps a set of terminator-only streams **valid** so they are passed through rather than
dropped. The local gate has no terminator set at all; it asks whether the stream carried *content*. The
five cases upstream protects therefore behave differently locally:

| Upstream #7545 case (asserted **valid**) | Local outcome | Local evidence |
| --- | --- | --- |
| `data: [DONE]` only, no content | `outcome: "empty"` → **fails over** | `frameCarriesContent` returns `false` for `[DONE]` ([streamContentPeek.js:26](../../../open-sse/utils/streamContentPeek.js)); pinned by [tests/unit/combo-empty-stream-3463.test.js:44](../../../tests/unit/combo-empty-stream-3463.test.js) |
| Terminal `usage`-only chunk, no content | `outcome: "empty"` → **fails over** | no usage branch in `frameCarriesContent`; pinned by [tests/unit/combo-empty-stream-3463.test.js:45](../../../tests/unit/combo-empty-stream-3463.test.js) |
| OpenAI `finish_reason`-only chunk, no content delta | `outcome: "empty"` → **fails over** | no `finish_reason` branch in `frameCarriesContent` |
| Claude `message_stop` / `message_delta` with `stop_reason`, no content block | `outcome: "empty"` → **fails over** | no `stop_reason` branch in `frameCarriesContent`; pinned by [tests/unit/omni-first-party-complete-empty-turn.test.js:12](../../../tests/unit/omni-first-party-complete-empty-turn.test.js) |
| `event: ping` only (structured SSE, no content) | `outcome: "empty"` → **fails over** | `event:` lines are not inspected at all by the local peek |

Direction of the divergence matters: local is **stricter**, not looser. The upstream change #7545 made was a
tightening (from "any byte is valid" to "a terminator or a structured frame is required"); the local gate is
already tighter than that, so the upstream *changed* lines have no residual to port. What the local tree does
not reproduce is upstream's **preservation** of those five pass-through cases, which upstream added as
regression guards for its own earlier `#3399` / `#3685` contracts.

This is a deliberate local design, not an accident: the fork's own fixture asserts the opposite of upstream
for these cases, and the fork has no readiness-timeout module to defer them to.

### Disposition and the one bounded acceptance fixture

**Already present for the upstream changed behavior** (truncated stream → combo failover at the pre-exposure
boundary), **with a documented stricter local gate and no parity for upstream's five terminator-only
pass-through cases.**

The one open item is that divergence. It is not a missing capability — the local tree fails over in more
cases than upstream — but it is a behavioral difference that upstream's PR explicitly designed against, so it
should be pinned rather than left implicit. A bounded, ordinary, offline acceptance fixture would look like
this; it is specified here and **not** added by this change:

- **Fixture scope.** One new file under `tests/unit/`, modelled on
  [tests/unit/combo-empty-stream-3463.test.js](../../../tests/unit/combo-empty-stream-3463.test.js),
  driving `handleComboChat` with an in-memory fake upstream. No network, no provider, no credential, no
  browser, no e2e.
- **Case 1 — the upstream #7545 scenario.** A 200 `text/event-stream` body carrying
  `": keepalive\n\npartial da"` — bytes present, no `data:` frame, no `event:` frame, no `[DONE]`, no
  `finish_reason`. Assert that the second member is attempted
  (`expect(attempted).toEqual(["p1/first", "p2/second"])`) and that the served body carries the second
  member's content. This is the upstream fixture's first case, adapted to the local boundary.
- **Case 2 — the no-retry-after-client-visible property.** A first member that emits one content frame and
  then truncates, with a second member available. Assert the second member is **not** attempted
  (`expect(attempted).toEqual(["p1/first"]`) and that the client receives the first member's partial output.
  This pins the "no retry after client-visible data" rule at the combo boundary itself, complementing the
  single-model case already covered by
  [tests/unit/stream-early-eof-failover.test.js:267](../../../tests/unit/stream-early-eof-failover.test.js).
- **Case 3 — the five divergence cases.** Parameterize the five terminator-only bodies (`[DONE]` only, usage
  only, `finish_reason` only, `message_stop` with `stop_reason`, `event: ping` only) and assert the **current**
  local behavior: each fails over to the next member. Pinning the current behavior is the point — it makes
  the difference from upstream explicit and prevents it from drifting silently.
- **Case 4 — replay fidelity.** A member whose stream carries a content frame after an unparseable preamble
  must not fail over, and the preamble bytes must be replayed byte-for-byte. This is already covered by
  [tests/unit/combo-empty-stream-3463.test.js:100](../../../tests/unit/combo-empty-stream-3463.test.js)
  and is listed here only so the fixture is self-contained if it is added.

**What remains needed.** Nothing for the upstream #7545 *changed lines* — they are already satisfied. For
full upstream parity the fork would have to adopt upstream's terminator set in the combo gate, which would
make the fork *looser* than it is today and would need a product decision, not a port. The upstream-side
storage and policy for "structured SSE activity that must be passed through" (upstream's `#3399` / `#3685`
readiness contracts) was not inspected beyond the diff hunks, so upstream's own rationale for each of the
five cases cannot be compared further from this checkout.

---

## #7779 — apply compression combo assignments to routing combos

### Source contract

Read from the merged tree `eba6ecaf2bd2b5b99b9a0c9797255838571ca6b5` against its first parent
`f8dd12b7211fdefca5306dfc9c67f76286563605`. Three independent hunks:

1. **`src/sse/handlers/chat.ts` — derive a routing combo from the model prefix.** When the request is not a
   combo request, the handler takes the provider prefix of the resolved model string and looks a combo up by
   that name:

   ```ts
   let routingComboId: string | null = null;
   if (!combo) {
     const providerPrefix = resolvedModelStr.split("/")[0];
     if (providerPrefix) {
       try {
         const { getComboByName } = await import("@/lib/localDb");
         const routingCombo = await getComboByName(providerPrefix);
         if (routingCombo?.id) { routingComboId = routingCombo.id; }
       } catch {}
     }
   }
   ```

   The id is then threaded down through `handleSingleModelChat` → `executeChatWithBreaker` into
   `handleChatCore` as a new `routingComboId` parameter
   (`src/sse/handlers/chat.ts:916`, `src/sse/handlers/chat.ts:1399`, `src/sse/handlers/chatHelpers.ts:398`,
   `src/sse/handlers/chatHelpers.ts:436`).
2. **`open-sse/handlers/chatCore.ts` — widen the compression-combo lookup.** The branch that applies a
   compression combo becomes `if ((isCombo && comboName) || routingComboId)`, the `comboName` accesses become
   optional-chained (`comboName?.startsWith("combo/")`), and the candidate id list gains the routing id:
   `[comboConfig?.id, comboName, routingComboId, comboName?.startsWith("combo/") ? comboName.substring(6) : null]`.
   The candidate list is handed to `getCompressionComboForRoutingCombo`.
3. **`open-sse/services/autoCombo/virtualFactory.ts` — advertise an output-token floor.** `computeAdvertisedLimits`
   gains `DEFAULT_ADVERTISED_MAX_OUTPUT_TOKENS = 8192`, applied when every candidate in the pool lacks
   `maxOutputTokens`, so the advertised value is a positive number instead of `null`.

The remaining changed file, `config/quality/file-size-baseline.json`, is upstream's own file-size baseline
plus a rebaseline note for the `chatHelpers.ts` growth; it has no runtime behavior.

### Local implementation evidence

**The local compression path is a single global, operator-enabled engine stack. There is no per-request
compression-combo resolution.**

- The operator settings are the master switch and a per-engine toggle map, at
  [src/lib/db/repos/settingsRepo.js:137](../../../src/lib/db/repos/settingsRepo.js)
  (`compressionEnabled: false`, `compressionEngines: {}`), read into the request at
  [src/sse/handlers/chat.js:1350](../../../src/sse/handlers/chat.js).
- The seam runs only inside `if (tokenSaverEnabled && compressionEnabled)` at
  [open-sse/handlers/chatCore.js:961](../../../open-sse/handlers/chatCore.js),
  and it is handed only the global engine map
  ([open-sse/handlers/chatCore.js:967](../../../open-sse/handlers/chatCore.js)).
- The seam's own config contract lists no combo field
  ([open-sse/handlers/chatCore/compressionHook.js:76](../../../open-sse/handlers/chatCore/compressionHook.js):
  `{ enabled, engines, applyOpts, adaptive, fidelityGate, log }`).
- Plan derivation reads only the master flag and the per-engine map, never a combo name or id
  ([open-sse/services/compression/deriveDefaultPlan.js:20](../../../open-sse/services/compression/deriveDefaultPlan.js),
  first rule `if (!masterEnabled) return { mode: "off", stackedPipeline: [] };`).
- The only compression-combo-shaped configuration in the tree is vestigial and unread: `comboOverrides: {}`,
  `compressionComboId: null` and `activeComboId: null` at
  [open-sse/services/compression/types.js:30](../../../open-sse/services/compression/types.js).
  A whole-tree search for `compressionComboId` returns exactly that one hit; `comboOverrides` and
  `activeComboId` are likewise never read. This was already recorded for a sibling upstream change in
  [internal/docs/port-reports/1073-may-streaming-boundaries.md](../../../internal/docs/port-reports/1073-may-streaming-boundaries.md).
- `handleChatCore` does accept `comboId` / `comboName`, but they are used only for usage attribution
  ([open-sse/handlers/chatCore/requestDetail.js:196](../../../open-sse/handlers/chatCore/requestDetail.js)),
  never for compression.

**The local tree has no routing-combo concept, and refuses provider-prefix combo resolution by design.**

- The resolution rule is stated in the code at
  [src/sse/services/model.js:471](../../../src/sse/services/model.js):
  *"Resolve a combo by its stored name only. A request containing a slash is a real provider/model call —
  slash-basename lookup previously shadowed genuine `provider/model` routing whenever a saved combo happened
  to share the basename. Callers that still want provider-prefixed combo resolution must save the combo under
  the full `provider/name` form."*
- The lookup itself is an exact-name query at
  [src/lib/db/repos/combosRepo.js:110](../../../src/lib/db/repos/combosRepo.js),
  with a case-insensitive exact-name second attempt and no basename or prefix fallback.
- The behavior is pinned by
  [tests/unit/combo-prefix-resolve.test.js:51](../../../tests/unit/combo-prefix-resolve.test.js)
  — *"does not resolve a provider/model basename to an exactly cased saved combo"* — and
  [tests/unit/combo-prefix-resolve.test.js:71](../../../tests/unit/combo-prefix-resolve.test.js)
  — *"gives a real provider/model precedence over a same-named combo"*.
- No `routingComboId` symbol exists anywhere in `src/`, `open-sse/` or `tests/`. The only `auto/` namespace
  is the fixed family set resolved by family name
  ([open-sse/services/autoComboResolver.js:32](../../../open-sse/services/autoComboResolver.js)),
  never by a request's model prefix.

**The upstream advertised-limit fallback has no local counterpart either.**

- `computeAdvertisedLimits`, `advertisedLimits` and `DEFAULT_ADVERTISED_MAX_OUTPUT_TOKENS` have no hit
  anywhere in the tree, and there is no `open-sse/services/autoCombo/` directory at all — the fork has
  `autoComboFamilies.js` and `autoComboResolver.js` only, and neither computes limits.
- Unknown output limits stay unknown locally:
  [open-sse/providers/capabilities.js:1473](../../../open-sse/providers/capabilities.js)
  computes `const maxOutput = !unpublishedOutput && positive(caps?.maxOutput) ? caps.maxOutput : undefined;`
  and returns `null` when neither limit is known
  ([open-sse/providers/capabilities.js:1474](../../../open-sse/providers/capabilities.js)).
  The module states the intent at
  [open-sse/providers/capabilities.js:31](../../../open-sse/providers/capabilities.js):
  *"Safe feature floor — every resolved result is merged over this. Unknown token limits remain unknown, not a
  200K/64K provider guarantee."*
- Combo catalog entries carry **no** limit fields at all:
  [src/app/api/v1/models/buildModelsList.js:489](../../../src/app/api/v1/models/buildModelsList.js)
  builds `{ id, object, owned_by, kind }` only. There is therefore no advertised `maxOutputTokens` value that
  could be `null` and need a floor.
- The only `8192` literals under `open-sse/services/` are combo **scoring** heuristics
  ([open-sse/services/combo.js:877](../../../open-sse/services/combo.js)
  and [open-sse/services/combo.js:921](../../../open-sse/services/combo.js)),
  where an unknown `maxOutput` is neither credited nor penalized.

**Local compression tests assert engine-level behavior only.** The compression fixtures are
`tests/unit/compression-chatcore-f1b.test.js`, `tests/unit/compression-chatcore-header.test.js`,
`tests/unit/compression-header.test.js`, `tests/unit/compression-preview.test.js`,
`tests/unit/compression-preview-auth.test.js`, `tests/unit/compression-settings-compat-1073.test.js`,
`tests/unit/compression-token-estimate.test.js`, `tests/unit/omni-compression-engine-clear.test.js` and
`tests/unit/omni-safe-compression-tool-output.test.js`. A search for `combo` across all of them returns one
hit, and it is unrelated to compression assignment — a mock of the combo rotation module in
`tests/unit/omni-compression-engine-clear.test.js:9`. **No local test asserts that a compression combo is
applied to a request, and none covers a routing-combo (prefix-derived) compression assignment.**

### Disposition

**Not applicable — both upstream surfaces have no local counterpart, and porting them would be a new feature
rather than a port.**

- The routing-combo compression assignment depends on two things the fork does not have: a per-request
  compression-combo resolution and a provider-prefix combo lookup. The fork's compression is a global
  operator-enabled engine stack, and its combo resolution deliberately refuses `provider/model` strings —
  a behavior it removed on purpose and pins with a test. Introducing the upstream threading would require
  re-introducing prefix-based combo resolution, which is exactly the routing feature this inventory excludes.
- The advertised output-token floor applies to a candidate-pool advertisement path that does not exist here;
  the fork advertises combo entries with no limit fields at all and keeps unknown output limits unknown by
  design.

**No confirmed residual and therefore no acceptance fixture is required for this PR.** What remains needed
for a reader who wants the upstream side completed: the upstream data model behind
`getCompressionComboForRoutingCombo` — which store holds a compression-combo ↔ routing-combo assignment, and
how it is written — was **not inspected beyond the diff hunks**, so no upstream-side mapping surface can be
compared from this checkout. On the local side, nothing further is needed unless the product decides to
introduce per-combo compression assignment and provider-prefix routing, which is out of scope here.

---

## Evidence collected

- Source merged trees and their first parents, read from the read-only mirror at
  `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git`: `747bce2f10a701054dbeab4ff51e7dd441faf96e`
  → `73327dfc819d1b069ccc5b1e6d924c5349d87683`, `6ca35315bb710042d292580ded55c14ddbcfea13` →
  `8e011554fd78c883246560ffca72bcd12e91b975`, `eba6ecaf2bd2b5b99b9a0c9797255838571ca6b5` →
  `f8dd12b7211fdefca5306dfc9c67f76286563605`.
- Local source read: `open-sse/translator/response/openai-responses.js`,
  `open-sse/translator/response/openai-responses/historyToolIdentity.js`, `open-sse/translator/index.js`,
  `open-sse/utils/streamContentPeek.js`, `open-sse/utils/emptyStreamTerminal.js`,
  `open-sse/services/combo.js`, `open-sse/services/combo/contextRequirements.js`,
  `open-sse/services/compression/types.js`, `open-sse/services/compression/deriveDefaultPlan.js`,
  `open-sse/services/compression/index.js`, `open-sse/handlers/chatCore.js`,
  `open-sse/handlers/chatCore/compressionHook.js`, `open-sse/handlers/chatCore/requestDetail.js`,
  `open-sse/providers/capabilities.js`, `open-sse/services/autoComboResolver.js`,
  `open-sse/services/autoComboFamilies.js`, `open-sse/config/runtimeConfig.js`, `src/sse/handlers/chat.js`,
  `src/sse/services/model.js`, `src/lib/db/repos/combosRepo.js`, `src/lib/db/repos/settingsRepo.js`,
  `src/app/api/v1/models/buildModelsList.js`.
- Existing local fixtures read:
  `tests/translator/port-6937-responses-toolcall-shape.test.js`,
  `tests/translator/responses-output-index.test.js`,
  `tests/unit/omni-responses-output-index-stability.test.js`,
  `tests/unit/openai-responses-stream-tool-identity.test.js`,
  `tests/unit/omni-responses-mixed-reasoning.test.js`,
  `tests/unit/combo-empty-stream-3463.test.js`, `tests/unit/combo-precontent-error-2068.test.js`,
  `tests/unit/stream-early-eof-failover.test.js`, `tests/unit/omni-first-party-complete-empty-turn.test.js`,
  `tests/unit/combo-prefix-resolve.test.js`, `tests/unit/compression-chatcore-f1b.test.js`,
  `tests/unit/compression-chatcore-header.test.js`.
- Offline probe: one inline `node --input-type=module -e "…"` invocation driving
  `openaiToOpenAIResponsesResponse` with synthetic Chat chunks. It wrote no file into the repository and left
  no temporary artifact behind. No test suite was run for this documentation-only disposition, and no
  provider traffic was generated.
- Required evidence:
  `test -s internal/docs/port-reports/1073-july-existing-tool-and-combo-contracts.md && rg -q -F 747bce2f10a701054dbeab4ff51e7dd441faf96e internal/docs/port-reports/1073-july-existing-tool-and-combo-contracts.md && rg -q -F 6ca35315bb710042d292580ded55c14ddbcfea13 internal/docs/port-reports/1073-july-existing-tool-and-combo-contracts.md && rg -q -F eba6ecaf2bd2b5b99b9a0c9797255838571ca6b5 internal/docs/port-reports/1073-july-existing-tool-and-combo-contracts.md`.

Refs #1073
