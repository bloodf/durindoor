# #1073 — Late-June existing request-framework leaves

## Scope

Three late-June OmniRoute inventory rows are resolved here against their exact public patches.

| Row | Source PR | PR head | Enclosing merge | PR base (merge first parent) |
| --- | --- | --- | --- | --- |
| 1 | [#4548](https://github.com/cheaper-inference/OmniRoute/pull/4548) | [`7f3a82fbb7bbfd5578be6541eb68128aa78c4daf`](https://github.com/cheaper-inference/OmniRoute/commit/7f3a82fbb7bbfd5578be6541eb68128aa78c4daf) | [`4b34a75fe333945c58ad8307bbcf6783c9aa2ee4`](https://github.com/cheaper-inference/OmniRoute/commit/4b34a75fe333945c58ad8307bbcf6783c9aa2ee4) | `69c35bd342582239115b3cdb35562146db743345` |
| 2 | [#4730](https://github.com/cheaper-inference/OmniRoute/pull/4730) | [`a2a772892c0df3b830eae160d461d2b33e8f262b`](https://github.com/cheaper-inference/OmniRoute/commit/a2a772892c0df3b830eae160d461d2b33e8f262b) | [`5f4e9e73a423b5f4d0d866a11ee227aa91f3e4d8`](https://github.com/cheaper-inference/OmniRoute/commit/5f4e9e73a423b5f4d0d866a11ee227aa91f3e4d8) | `48dea489c1848881a6078f348fa04e0f9551c0c8` |
| 3 | [#4833](https://github.com/cheaper-inference/OmniRoute/pull/4833) | [`52d0208c2a546482f4e1a1b600a46d9132281818`](https://github.com/cheaper-inference/OmniRoute/commit/52d0208c2a546482f4e1a1b600a46d9132281818) | [`c69bd6a4ebdc92aa2abf0e9b40956cdd41940968`](https://github.com/cheaper-inference/OmniRoute/commit/c69bd6a4ebdc92aa2abf0e9b40956cdd41940968) | `867e9043f57e173568e670a971cc056c1bb85143` |

Method: each row was read as the PR-head-to-base diff and cross-checked against the enclosing
merge's first-parent diff. All three enclosing merges are squash merges (one parent each), and for
each row the two diffs are byte-identical — the same `git patch-id --stable` value was produced for
`base..head` and for `merge^1..merge`. The enclosing merges therefore carry no unrelated PR
changes for these three rows, and the PR heads are the exact landed patches. No title, changed-path
list, or search snippet was used as scope evidence.

Local comparison base: DurinDoor `a16230c5d661490fe981989f6b3234046169a45d`, branch
`orq/tornf6/audit-omni-late-june-existing-request-framework-leaves-a1`.

All three rows are upstream *refactor* rows from OmniRoute's `#3501` chatCore god-file
decomposition. The question each row answers here is therefore narrow: does the extraction change
behavior in the area it touches (effective upstream headers, system-role extraction, JSON-to-SSE
conversion), and what does the local tree do with that same behavior?

Nothing in this inventory changes code, providers, integrations, credentials, sign-in, workflows,
the baseline, or published docs. Local behavior quoted below was produced by offline probes run
against the local tree (scratch files outside the repository, removed after the run) or by reading
the local source at the cited lines. No provider traffic, no network, no paid API, no e2e, no
browser, no Docker, and no full suite run. No credential value was read; the header and body
builders were read as source only, and no new route was inspected or added.

## Summary

| Source PR | Subject | Disposition |
| --- | --- | --- |
| [#4548](https://github.com/cheaper-inference/OmniRoute/pull/4548) | refactor(chatCore): extrai extractSystemRoleMessages + buildUpstreamHeadersForExecute para leaves puros | **Split** — the system-role half is a byte-equivalent extraction whose local counterpart is already in (adapted) with one narrow residual; the header half is source-only plumbing, and local header ownership is preserved |
| [#4730](https://github.com/cheaper-inference/OmniRoute/pull/4730) | refactor(chatCore): extrai prepareUpstreamBody (1ª sub-fatia do executeProviderRequest, #3501) | **Source-only plumbing** — byte-equivalent extraction; every extracted step is either absent from the local tree or owned by a different local layer |
| [#4833](https://github.com/cheaper-inference/OmniRoute/pull/4833) | refactor(chatCore): extrai maybeConvertJsonBodyToSse (#3089 JSON→SSE streaming, #3501) | **Already in (adapted)** — byte-equivalent extraction; the local JSON-to-SSE conversion exists, with one narrow residual (the upstream status and statusText are not carried over) |

---

## 1. OmniRoute #4548 — extractSystemRoleMessages and buildUpstreamHeadersForExecute

### Exact source pin

- PR head: `7f3a82fbb7bbfd5578be6541eb68128aa78c4daf`
  (`Merge remote-tracking branch 'origin/release/v3.8.33' into pr4548`)
- Enclosing merge: `4b34a75fe333945c58ad8307bbcf6783c9aa2ee4`, dated 2026-06-21, subject
  `refactor(chatCore): extrai extractSystemRoleMessages + buildUpstreamHeadersForExecute para leaves puros (#3501) (#4548)`
- PR base: `69c35bd342582239115b3cdb35562146db743345`
- Changed paths (4): `open-sse/handlers/chatCore.ts`,
  `open-sse/handlers/chatCore/claudeSystemRole.ts` (new),
  `open-sse/handlers/chatCore/upstreamExecuteHeaders.ts` (new),
  `tests/unit/chatcore-upstream-execute-headers.test.ts` (new)

### Source contract

An exported top-level function and one inline closure leave `chatCore.ts` and become leaf modules.
Neither changes behavior.

1. **`extractSystemRoleMessages`** moves verbatim from `chatCore.ts` into
   `open-sse/handlers/chatCore/claudeSystemRole.ts`, and is re-exported from `chatCore.ts` so
   existing importers keep resolving it. The moved body is identical, including the `{ ...block }`
   copy in the array-content branch and the case-insensitive `system`/`developer` role test. The
   separate in-file closure `extractSystemMessagesToBody` is *not* touched by this row.
2. **`buildUpstreamHeadersForExecute`** moves into
   `open-sse/handlers/chatCore/upstreamExecuteHeaders.ts` and becomes a pure builder over eight
   bound inputs (`modelToCall`, `effectiveModel`, `provider`, `model`, `resolvedModel`,
   `sourceFormat`, `connectionCustomUserAgent`, `settings`). The per-model header merge order, the
   connection `User-Agent` override (including the lowercase `user-agent` twin), and the Claude
   Fast Mode opt-in gate (`provider === "claude"` plus `shouldRequestClaudeFastMode(settings,
   modelToCall)`) are unchanged.

Two import paths move with the code, and both resolve to the same symbols: `getModelUpstreamExtraHeaders`
is defined in `src/lib/db/models.ts` and re-exported by `src/lib/localDb.ts`, and `resolveModelAlias`
is defined in `open-sse/services/modelDeprecation.ts`. No duplicate or circular import is introduced.

Upstream call sites of the extracted helper are the Claude bridge and the Claude passthrough path
(`extractSystemRoleMessages` on `translatedBody`), where a `system` or `developer` role message is
lifted into the top-level `system` field and removed from `messages[]`.

### Local implementation and fixture evidence

**System-role extraction — already in (adapted), one narrow residual.**

The local tree owns the Claude system-role policy in the translator layer, not in the handler:

- [`open-sse/translator/formats/claude.js`](../../../open-sse/translator/formats/claude.js) —
  `normalizeClaudePassthrough` (line 657) is the local counterpart. Its hoist branch (lines
  712-729) lifts `role:"system"` messages into the top-level `system` array and removes them from
  `messages[]`; its fold branch (line 686, `foldSystemTurns`) instead folds the same content into
  the following user turn.
- [`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js) line 742 calls it on the
  native Claude Code passthrough path with `{ foldSystemTurns: true }`;
  [`open-sse/translator/index.js`](../../../open-sse/translator/index.js) line 323 calls it in hoist
  mode for the Ollama-family native Claude transport.
- The OpenAI-to-Claude translator handles both roles on the translated path:
  [`open-sse/translator/request/openai-to-claude.js`](../../../open-sse/translator/request/openai-to-claude.js)
  line 78 collects `ROLE.SYSTEM` **and** `ROLE.DEVELOPER` into the top-level `system` field.

Offline probe against the local module (fresh objects per call):

```
local, foldSystemTurns:true  (chatCore.js:742), system+developer+user
  -> messages: [{role:"developer",content:"dev brief"},{role:"user",content:[{type:"text",text:"hi"},{type:"text",text:"be brief"}]}]
     system:   [{type:"text",text:"TOP"}]

local, hoist mode (translator/index.js:323), system+developer+user
  -> messages: [{role:"developer",content:"dev brief"},{role:"user",content:"hi"}]
     system:   [{type:"text",text:"TOP"},{type:"text",text:"be brief"}]
```

The same probe against the pinned upstream helper (transcribed verbatim from
`open-sse/handlers/chatCore/claudeSystemRole.ts` at the pinned head) lifts both roles:

```
  -> messages: [{role:"user",content:"hi"}]
     system:   [{type:"text",text:"TOP"},{type:"text",text:"be brief"},{type:"text",text:"dev brief"}]
```

So the local `role:"system"` contract is satisfied — the message never reaches the Anthropic wire
as a chat role — and the local treatment of that role differs by design (folded into the next user
turn on the Claude Code passthrough path, lifted on the Ollama-family path). The residual is
narrow and one-directional: **the local tree does not treat `role:"developer"` as
system-equivalent on the Claude wire.** A `developer` message survives `normalizeClaudePassthrough`
in both local modes, and the outbound gate then rejects it:

- [`open-sse/translator/validate.js`](../../../open-sse/translator/validate.js) line 60 defines
  `CLAUDE_ROLES = new Set([ROLE.USER, ROLE.ASSISTANT])`; line 389 rejects any other role.
- The gate runs on the passthrough path too: `open-sse/handlers/chatCore.js` line 862 sets
  `finalFormat = passthrough ? sourceFormat : targetFormat`, and line 1331 calls
  `validateOutboundPayload(finalFormat, translatedBody)`. `VALIDATE_OUTBOUND` defaults to on
  ([`open-sse/config/runtimeConfig.js`](../../../open-sse/config/runtimeConfig.js) line 332).

Offline probe of the local validator on a Claude-shaped body:

```
validateOutboundPayload(claude), body with role:"developer"
  -> ok:false, errors include  messages[0].role: "role must be one of user|assistant"
```

Upstream serves the same body, because the pinned helper removes the `developer` message before
the wire. The local outcome for that request is HTTP 400 at the gateway; the upstream outcome is a
dispatched request. The residual is narrow (one role name on one wire format) and defensive in
origin — the upstream helper treats `developer` as system-equivalent "to be defensive".

**Effective upstream headers — source-only plumbing; local header ownership preserved.**

The local tree has no counterpart for the three upstream inputs the extracted builder consumes:

- No per-model upstream extra headers: a search of `open-sse/` and `src/` for
  `getModelUpstreamExtraHeaders`, `upstreamExtraHeaders`, `upstreamHeaders` and
  `upstream_headers` returns no DB reader and no per-model header store. The only
  `upstreamExtraHeaders` occurrences are executor input parameters
  ([`open-sse/executors/windsurf.js`](../../../open-sse/executors/windsurf.js),
  `yuanbao-web.js`, `huggingchat.js`, `muse-spark-web.js`) that the local handler never populates:
  the executor call at `open-sse/handlers/chatCore.js` line 1379 passes no such field.
- No Claude Fast Mode CPA header: a search for `claudeFast`, `fast_mode`, `FORCE_FAST` and
  `CPA_FORCE_FAST` across `open-sse/` and `src/` returns only the unrelated Codex
  `codexUltrafastMode` connection flag.
- No connection-wide custom User-Agent override: `customUserAgent` appears once, in
  [`open-sse/utils/chatgptWebExecutorAdapter.js`](../../../open-sse/utils/chatgptWebExecutorAdapter.js)
  line 444, as a chatgpt-web-only provider-specific value.

Local upstream headers are owned by the provider registry and the executors — for example the
static `transport.headers` of the Anthropic transport in
[`open-sse/providers/registry/anthropic.js`](../../../open-sse/providers/registry/anthropic.js) and
the executor-built headers in [`open-sse/executors/base.js`](../../../open-sse/executors/base.js).
That ownership is deliberately left unchanged: porting the extracted builder would move header
construction out of the layer that owns it, for features (per-model extra headers, Claude Fast
Mode) the local product does not have.

### Disposition

**Split.** The row is a byte-equivalent upstream refactor with two leaves.

- The system-role half is **already in (adapted)**: the local tree performs the same lift of
  `role:"system"` into the top-level `system` field, on a different path
  (`normalizeClaudePassthrough`) with a different mode split (fold on the Claude Code passthrough
  path, hoist on the Ollama-family path). One narrow residual remains — the local tree does not
  treat `role:"developer"` as system-equivalent on the Claude wire, so such a request is rejected
  by the local outbound gate instead of being served.
- The header half is **source-only plumbing**: the per-model extra-header merge, the
  connection `User-Agent` override, and the Claude Fast Mode opt-in have no local counterpart, and
  local header ownership stays with the provider registry and the executors.

No new capability is recommended for the header half. The system-role residual is bounded to one
role name and is covered by the offline acceptance below.

### Bounded ordinary offline acceptance (system-role residual)

A single offline unit file must pin the behavior without network, provider traffic, or e2e. When
the residual is closed, the file must assert:

1. `normalizeClaudePassthrough` on a Claude body whose `messages` carry a `role:"developer"`
   message returns that message lifted into the top-level `system` field (as a `{type:"text",text}`
   block) and removed from `messages[]` — matching the pinned upstream helper, which lifts both
   `system` and `developer`.
2. `normalizeClaudePassthrough` in the `foldSystemTurns: true` mode used by the native Claude Code
   passthrough path keeps its current contract for `role:"system"` (content folded into the
   following user turn, top-level `system` untouched), so the residual fix does not silently change
   that path.
3. `validateOutboundPayload(FORMATS.CLAUDE, body)` on a Claude body that still carries a
   `role:"developer"` message returns `ok:false` with a `messages[N].role` error. The validator's own
   contract is unchanged by the fix; what changes is that the request pipeline no longer produces a
   Claude body carrying a `developer` role, so the same body must validate `ok:true` after the local
   Claude normalization runs.
4. A Claude body with only `user`/`assistant` messages validates unchanged (`ok:true`).

Run it offline from `tests/`:

```
node node_modules/vitest/vitest.mjs run unit/omni-late-june-request-framework-leaves.test.js --maxWorkers=2
```

The fixture needs only the Claude translator format module and the outbound validator; no image,
no network, and no provider credentials.

---

## 2. OmniRoute #4730 — prepareUpstreamBody

### Exact source pin

- PR head: `a2a772892c0df3b830eae160d461d2b33e8f262b`, subject
  `refactor(chatCore): extrai prepareUpstreamBody (1ª sub-fatia do executeProviderRequest, #3501)`
- Enclosing merge: `5f4e9e73a423b5f4d0d866a11ee227aa91f3e4d8`, dated 2026-06-23, subject
  `refactor(chatCore): extrai prepareUpstreamBody (1ª sub-fatia do executeProviderRequest, #3501) (#4730)`
- PR base: `48dea489c1848881a6078f348fa04e0f9551c0c8`
- Changed paths (3): `open-sse/handlers/chatCore.ts`,
  `open-sse/handlers/chatCore/upstreamBody.ts` (new),
  `tests/unit/chatcore-upstream-body.test.ts` (new)

### Source contract

The inline upstream-body preparation block leaves `chatCore.ts` and becomes
`open-sse/handlers/chatCore/upstreamBody.ts`, split into four private steps
(`buildAppliedRulesSummary`, `truncateToolList`, `backfillQwenOAuthUser`, `injectPromptCacheKey`)
behind one exported `prepareUpstreamBody`. The step order is unchanged: model pinning, payload
rules plus the `PAYLOAD_RULES` debug summary, tool-list truncation plus the `TOOL_LIMIT` debug
line, the Qwen OAuth `user` backfill, then the OpenAI `prompt_cache_key` injection.

Two details were checked for equivalence and hold:

- The `TOOL_LIMIT` log line counts the already-truncated list in both the inline block and the
  extracted helper, so the emitted number is unchanged.
- The Qwen OAuth guard reads the handler-scope `credentials` (not the per-execution
  `executionCredentials`) in both the inline block and the extracted call, which passes
  `credentials` unchanged. The credential source is therefore identical; no credential value was
  read for this comparison.

The new file imports `getEffectiveToolLimit` from `open-sse/services/toolLimitDetector.ts`, the same
module the removed inline block imported it from, so the symbol is unchanged.

### Local implementation and fixture evidence

The local tree has no counterpart for the handler-owned body preparation, and no local component
performs these four steps upstream of the executor:

- **Payload rules** — absent. There is no `open-sse/services/payloadRules.ts`, no
  `applyConfiguredPayloadRules` / `resolvePayloadRuleProtocols`, and no payload-rules configuration
  file in the local tree.
- **Tool-limit truncation** — absent at the handler level. There is no `getEffectiveToolLimit`,
  no `MAX_TOOLS_LIMIT`, and no detected-limit store; the only tool caps are per-executor constants
  such as `GROK_CLI_MAX_TOOLS` in
  [`open-sse/executors/grok-cli.js`](../../../open-sse/executors/grok-cli.js) line 37.
- **Qwen OAuth `user` backfill** — absent. The Qwen executor
  ([`open-sse/executors/qwen.js`](../../../open-sse/executors/qwen.js)) builds its own request and
  sets no `user` field; the only `user` assignments in the tree are the Anthropic
  `metadata.user_id` projection in
  [`open-sse/translator/request/claude-to-openai.js`](../../../open-sse/translator/request/claude-to-openai.js)
  line 157 and unrelated `delete body.user` cleanups.
- **`prompt_cache_key` injection** — present, but owned by a different layer with a different
  default. The local injection lives in the executor,
  [`open-sse/executors/default.js`](../../../open-sse/executors/default.js) line 101
  (`injectPromptCacheKey`), and is **opt-in per connection**
  (`providerSpecificData.enablePromptCacheKey === true`, line 103) and **session-scoped**
  (`normalizePromptCacheKey`, line 80, a provider-scoped SHA-256 prefix over the resolved session
  id). The upstream helper is handler-owned, enabled by default for caching-capable providers,
  and content-derived (`generatePromptCacheKey(messages)`).

### Disposition

**Source-only plumbing.** The extraction is byte-equivalent on the source side and introduces no
behavioral change there. Locally, three of the four extracted steps have no counterpart at all
(payload rules, tool-limit truncation, the Qwen OAuth `user` backfill), and the fourth
(`prompt_cache_key`) exists with different ownership, different default, and a different key
derivation. Porting the extracted helper would move body preparation into the handler for steps
the local product does not have, and would move `prompt_cache_key` ownership away from the
executor, where the local tree keeps it.

No port is recommended and no local behavior needs to change. If the local product later gains
payload rules or a Qwen OAuth path, this row is the upstream reference for where that
preparation belongs; until then it is not applicable.

---

## 3. OmniRoute #4833 — maybeConvertJsonBodyToSse

### Exact source pin

- PR head: `52d0208c2a546482f4e1a1b600a46d9132281818`, subject
  `refactor(chatCore): extrai maybeConvertJsonBodyToSse (#3089 JSON→SSE streaming, #3501)`
- Enclosing merge: `c69bd6a4ebdc92aa2abf0e9b40956cdd41940968`, dated 2026-06-23, subject
  `refactor(chatCore): extrai maybeConvertJsonBodyToSse (#3089 JSON→SSE streaming, #3501) (#4833)`
- PR base: `867e9043f57e173568e670a971cc056c1bb85143`
- Changed paths (3): `open-sse/handlers/chatCore.ts`,
  `open-sse/handlers/chatCore/jsonBodyToSse.ts` (new),
  `tests/unit/chatcore-json-body-to-sse.test.ts` (new)

### Source contract

The inline JSON-to-SSE block leaves `chatCore.ts` and becomes
`open-sse/handlers/chatCore/jsonBodyToSse.ts`, with the two upstream dependencies injected for
testing (`withBodyTimeout`, `synthesizeOpenAiSseFromJson`). The gate and both branches are
unchanged: an `application/json` body that is neither `text/event-stream` nor
`application/x-ndjson` is read, converted to an equivalent OpenAI SSE stream when the body is a
convertible chat completion, and otherwise rebuilt so the readiness and error path still runs.
The rebuilt response keeps `status` and `statusText`, drops `content-length`, and sets
`content-type: text/event-stream` only in the converted branch. When the body is not a non-SSE
JSON body, the same response object is returned.

The upstream test pins exactly that: `status` and `statusText` are preserved on conversion, and
`content-length` is absent.

### Local implementation and fixture evidence

The local tree already performs this conversion, in a different module, from the earlier `#5320`
port:

- [`open-sse/handlers/chatCore/streamingHandler.js`](../../../open-sse/handlers/chatCore/streamingHandler.js)
  line 135 reads the upstream content type, and line 136 gates the branch on
  `application/json` **and** `targetFormat === FORMATS.OPENAI`.
- Line 140 frames the parsed body with `completionToStream`
  (line 52), which spreads the whole `message` into the chunk `delta`, so `content`,
  `reasoning_content`, `role` and `tool_calls` all survive, and emits the chunk's original
  `finish_reason` plus `data: [DONE]`.
- Lines 141-144 rebuild the response with `content-type: text/event-stream` and `content-length`
  removed.
- A body that is not a convertible chat completion throws inside `completionToStream`
  (lines 53-56, `Invalid JSON completion for streaming request`) and is turned into a
  `502 Bad Gateway` error result.

Offline probe of the local framer:

```
completionToStream({id:"x",choices:[{index:0,message:{role:"assistant",content:"hi",
  reasoning_content:"r",tool_calls:[{id:"c1",type:"function",function:{name:"f",arguments:"{}"}}]},
  finish_reason:"tool_calls"}]})
  -> "data: {...\"object\":\"chat.completion.chunk\"...}\n\ndata: [DONE]\n\n"

completionToStream({error:{message:"rate limited"}})  ->  throws "Invalid JSON completion for streaming request"
```

Offline probe of the pinned upstream helper (transcribed verbatim from
`open-sse/handlers/chatCore/jsonBodyToSse.ts` at the pinned head, dependencies stubbed):

```
429 + application/json, synthesizable
  -> status: 429 | statusText: "Too Many Requests" | content-type: text/event-stream | content-length: null
429 + application/json, not synthesizable
  -> status: 429 | content-type: application/json | body: {"error":{"message":"rate limited"}}
text/event-stream  -> returned unchanged (same reference)
application/x-ndjson -> returned unchanged (same reference)
```

The upstream behavior matches the local behavior for the pass-through cases and for the framing
itself. Two narrower local differences were already recorded for the underlying `#3089` contract in
[`internal/docs/port-reports/1073-june-existing-response-contracts.md`](1073-june-existing-response-contracts.md)
(the local branch is gated on `targetFormat === FORMATS.OPENAI`, and the local framer emits a
single chunk plus `[DONE]` instead of a content chunk, a terminal chunk and `[DONE]`). This row adds
one further difference that the extraction makes explicit:

**The local rebuild drops the upstream status and statusText.** `open-sse/handlers/chatCore/streamingHandler.js`
line 144 constructs `new Response(framed, { headers })` with no `status`, so the rebuilt response
carries the default `200`; the pinned upstream helper passes `status` and `statusText` through in
both branches. Offline probe:

```
new Response(framed, { headers })                      -> status: 200 | statusText: ""
same body rebuilt from a 429 upstream response        -> status: 200   (upstream: 429)
```

The observable consequence is bounded: when an upstream answers a streaming request with an
`application/json` body carrying a non-2xx status, the local rebuild hands the pipeline a `200`
(convertible body), or a generic `502 Invalid JSON completion for streaming request`
(non-convertible body), where the pinned upstream helper keeps the upstream status on the rebuilt
response so the readiness and error path can report it.

### Disposition

**Already in (adapted).** The local tree performs the same JSON-to-SSE projection, from the
earlier `#5320` port rather than from OmniRoute, and the upstream row itself is a byte-equivalent
extraction that introduces no new behavior. The narrow residual is the one above: the local
rebuild does not carry the upstream status and statusText over. No new capability is implied — the
gap is inside an existing path.

### Bounded ordinary offline acceptance (status residual)

A single offline unit file must pin the behavior without network, provider traffic, or e2e. When
the residual is closed, the file must assert:

1. A streaming request whose upstream answers `application/json` with status `429` and a
   chat-completion-shaped body yields a rebuilt response whose status is `429`, whose
   `content-type` is `text/event-stream`, and whose `content-length` is absent.
2. A streaming request whose upstream answers `application/json` with status `429` and a
   non-chat-completion body (for example `{"error":{"message":"rate limited"}}`) yields a rebuilt
   response whose status is `429` and whose body is the upstream body, rather than a `502` with the
   generic `Invalid JSON completion for streaming request` message.
3. A streaming request whose upstream answers `application/json` with status `200` keeps `200` and
   the same SSE framing as today.
4. An upstream `text/event-stream` and an upstream `application/x-ndjson` response are passed
   through untouched, matching the pinned upstream helper.

Run it offline from `tests/`:

```
node node_modules/vitest/vitest.mjs run unit/omni-late-june-request-framework-leaves.test.js --maxWorkers=2
```

The fixture needs only the streaming handler module and real `Response` objects; no provider
credentials, no upstream host, and no network.

---

## Cross-cutting notes

- **Header ownership is unchanged.** Nothing in this inventory moves upstream header construction
  out of the provider registry (`open-sse/providers/registry/*.js`) and the executors
  (`open-sse/executors/*.js`). The upstream `#4548` header leaf is recorded as source-only
  plumbing, and the local `prompt_cache_key` ownership stays with the executor
  (`open-sse/executors/default.js`).
- **No new route was inspected or introduced.** The Claude-format outbound shape was read through
  the existing translator and validator modules only.
- **No credential was read.** The header and body builders were compared as source; no key,
  token, or stored connection value was opened, and the comparison of the Qwen OAuth guard was
  made on the *variable binding* (`credentials` versus `executionCredentials`), not on values.
- **The three rows are refactors, not features.** In all three, the pinned upstream diff is
  byte-equivalent to the pre-refactor inline code, so no upstream behavior change needs to be
  ported from any of them. The only local deltas recorded above (the `developer` role on the
  Claude wire, and the dropped upstream status in the JSON-to-SSE rebuild) are pre-existing local
  properties that these rows make visible; they are not introduced by the rows.

## What this pass did not do

- No product code, test file, workflow, `AGENTS.md`, baseline file, or published document was
  changed. The acceptance fixtures above are specified, not added.
- No provider, integration, credential, sign-in, or route was added, and no live provider traffic,
  paid API, browser session, Docker image, or e2e run was performed.
- No upstream claim outside the three pinned heads and their enclosing merges was relied upon, and
  no earlier upstream PR was re-adjudicated: the JSON-to-SSE projection itself was already
  dispositioned for `#3108` in
  [`internal/docs/port-reports/1073-june-existing-response-contracts.md`](1073-june-existing-response-contracts.md),
  and that report's scope notes are carried forward here unchanged.
