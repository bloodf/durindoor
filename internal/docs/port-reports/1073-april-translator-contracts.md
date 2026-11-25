# #1073 — April 2026 OmniRoute translator contracts

## Scope and verification

Eight merged OmniRoute PRs from April 2026 were compared against the local DurinDoor runtime on
branch `orq/tornf6/audit-omni-april-translator-contracts-a1-l2` (base `454e135922`). This unit is a
comparison only: it ports nothing, selects nothing, and calls no provider.

**Merged source records.** All eight rows come from `/var/tmp/durindoor-omni-early-metadata.gnjcuh68/2026-04.json`
(340 merged records, UTC merge dates 2026-04-02 through 2026-04-27). Every record carries a 40-character
lowercase-hex `headRefOid` and `mergeCommit.oid`, and a complete changed-path list (`files.totalCount`
equals the number of path nodes, no further page). The head and merge pins are reproduced verbatim in the
ledger below.

**Upstream diffs.** Behavior was read from the read-only public-source mirror
`/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git` using the merged record itself
(`git diff <merge-sha>^1 <merge-sha>`), not the PR head alone. That distinction matters for two rows:
the pinned head of [#909](https://github.com/cheaper-inference/OmniRoute/pull/909) is a pure readability
refactor, while the merged record carries the behavior change; and [#1098](https://github.com/cheaper-inference/OmniRoute/pull/1098),
[#1245](https://github.com/cheaper-inference/OmniRoute/pull/1245), [#1414](https://github.com/cheaper-inference/OmniRoute/pull/1414),
[#1483](https://github.com/cheaper-inference/OmniRoute/pull/1483), [#1528](https://github.com/cheaper-inference/OmniRoute/pull/1528) and
[#1645](https://github.com/cheaper-inference/OmniRoute/pull/1645) are squash merges with a single parent, so the merge diff is the
whole change.

**Published #1073 dispositions checked first.** All eight PRs already appear in the in-tree ledger as
*unresolved runtime* rows — `internal/docs/port-reports/1073-april-recovered-1-dispositions.md`
([#909](https://github.com/cheaper-inference/OmniRoute/pull/909), [#944](https://github.com/cheaper-inference/OmniRoute/pull/944),
[#1098](https://github.com/cheaper-inference/OmniRoute/pull/1098), [#1245](https://github.com/cheaper-inference/OmniRoute/pull/1245)) and
`internal/docs/port-reports/1073-april-recovered-2-dispositions.md`
([#1414](https://github.com/cheaper-inference/OmniRoute/pull/1414), [#1483](https://github.com/cheaper-inference/OmniRoute/pull/1483),
[#1528](https://github.com/cheaper-inference/OmniRoute/pull/1528), [#1645](https://github.com/cheaper-inference/OmniRoute/pull/1645)), plus
`internal/docs/port-reports/1073-first-quarter-row-dispositions.md` — none of them claims parity, so no
earlier disposition is contradicted here. `internal/docs/omniroute-open-prs-1073.md` is the *open*-PR
selection list (575 still-open PRs, none of them these eight) and was read only to confirm that it
contains no disposition for this set.

**Local fixtures checked before reporting a gap.** `tests/translator/openai-responses-max-tokens.test.js`
(output-limit rename), `tests/translator/gemini-thought-signature-store.test.js` and
`tests/translator/gemini-thought-signature.test.js` (thought-signature round trip),
`tests/translator/port-3241-namespace-tools.test.js` (namespace tools) and `tests/translator/bugs-kiro.test.js`
(Kiro request translation). The only contract in this set that no local fixture pins is the
`max_completion_tokens` half of [#1245](https://github.com/cheaper-inference/OmniRoute/pull/1245) — see the residual.

**Method.** Static reading of the local runtime plus temporary Vitest probes placed under `tests/unit/`,
executed against the local translator entry points (`translateRequest`, `translateResponse`, `initState`,
`openaiToOpenAIResponsesRequest`, `openaiResponsesToOpenAIResponse`, `openaiToKiroRequest`) and then deleted.
Probe output is quoted inline below as observed values. No provider traffic, no credential access, no paid
API, no browser, no Docker, no e2e, no whole-suite run, and no product implementation were used.

**Classification.** All eight upstream PRs are corrections to existing translator/executor runtime paths.
None of them adds a provider, a sign-in or auth flow, a catalog, or any other new product surface. The only
non-runtime path in the set is `.github/workflows/build-fork.yml` in [#1528](https://github.com/cheaper-inference/OmniRoute/pull/1528)
(CI-only). Two rows are therefore routed to the Provider Sign-in lane in the sense of "not a provider or
auth change": none.

## Disposition ledger

| Source PR | Merged (UTC) | Head SHA | Merge SHA | Disposition |
| --- | --- | --- | --- | --- |
| [#909](https://github.com/cheaper-inference/OmniRoute/pull/909) | 2026-04-02T04:00:34Z | `9588c1ea3e1a8aa5fb0fda61f709c150a3df970f` | `6c669abb2300cb7a8f890bed6ffa6e77bb0c566e` | Already present — correction to an existing runtime path, covered locally by different code; no port. |
| [#944](https://github.com/cheaper-inference/OmniRoute/pull/944) | 2026-04-03T06:20:49Z | `587bab3eb11a0d72a0fc4cf43b556f5297b9c024` | `34c41d5f3d82d1592cf37be0df5cbd1ffa2504f1` | Already present and extended — correction to an existing runtime path; one recorded divergence, no port. |
| [#1098](https://github.com/cheaper-inference/OmniRoute/pull/1098) | 2026-04-10T00:15:09Z | `26b84abb38381083d4e22eae70d78d83ce973681` | `586e9f328fe12f4975081d8aea1e0cd0c930e8b1` | Already present — correction to an existing runtime path, covered locally by different code; no port. |
| [#1245](https://github.com/cheaper-inference/OmniRoute/pull/1245) | 2026-04-15T03:25:32Z | `d55e3e4e18d1edd38bc82893a9a70adcd99ba08e` | `678298f2420b08dd36e9ea9f17cbe65b74a827d5` | **Residual — portable.** Correction to an existing runtime path; `max_completion_tokens` is dropped on the Chat→Responses transport. Focused port described below. |
| [#1414](https://github.com/cheaper-inference/OmniRoute/pull/1414) | 2026-04-19T09:46:54Z | `6fd8a75e03343425bcfa5605fc602c0b2bf83162` | `5be86907d79b629e22b401e9b9f1fd96f258a469` | Partially present — the converter keeps the nested effort, the generic request path relocates it; recorded divergence, no port here. |
| [#1483](https://github.com/cheaper-inference/OmniRoute/pull/1483) | 2026-04-21T20:18:26Z | `9bfd1792723e7a686c56fa74f8107989cb60c96e` | `9cd36af3e8bcd7c73feec83bf5c962efb30e6dad` | Already present — correction to an existing runtime path, covered locally by a different tool-name contract; no port. |
| [#1528](https://github.com/cheaper-inference/OmniRoute/pull/1528) | 2026-04-23T11:23:14Z | `0138b8ca7d63056c8f476092c7a03175ba256fe8` | `2a58543b4d71349416ada11f91755cec60169d75` | Already present — correction to an existing runtime path, covered locally by the centralized thinking normalizer; no port. |
| [#1645](https://github.com/cheaper-inference/OmniRoute/pull/1645) | 2026-04-27T04:09:23Z | `6c5ae12e80a11f164a59afa0ee430db76c7062d5` | `97912c7d9c20a9122c47550636b13675d8171326` | Already present for the defect classes upstream fixed; two narrow divergences recorded; no port here. |

## Per-PR comparison

### [#909](https://github.com/cheaper-inference/OmniRoute/pull/909) — `9588c1ea…` / `6c669abb…`

Upstream merged change (two parts): `open-sse/translator/index.ts` forwards a `null` flush chunk into the
source-format translator even when the first conversion step produced no output, and
`open-sse/translator/response/openai-responses.ts` captures usage from *any* chunk, normalizes Chat
`prompt_tokens`/`completion_tokens` into Responses `input_tokens`/`output_tokens`, and derives `total_tokens`.

Local behavior — the same outcome is produced by different code:

- Flush sentinel: `open-sse/translator/index.js:414-420` forwards the `null` sentinel into the source-side
  translator loop when the first step produced nothing, so the terminal event is still emitted. Observed:
  `translateResponse(GEMINI, OPENAI_RESPONSES, null, state)` returned `["response.completed"]`.
- Usage normalization: `open-sse/translator/response/openai-responses.js:48-70` (`completedUsage`) normalizes
  `input_tokens`/`prompt_tokens` and `output_tokens`/`completion_tokens`, rejects non-integer or zero-sum
  counts, and recomputes `total_tokens` from the two normalized values rather than trusting the upstream total.
  `:92-96` captures usage from any chunk that carries it, not only from usage-only chunks, and `:661-689`
  (`sendTerminal`) puts the normalized usage into the terminal `response.completed` payload.
  Observed `response.completed.response.usage` for an upstream chunk carrying
  `{prompt_tokens:5, completion_tokens:7, total_tokens:12, prompt_tokens_details:{cached_tokens:2}}`:
  `{"input_tokens":5,"output_tokens":7,"total_tokens":12,"cached_tokens":2,"input_tokens_details":{"cached_tokens":2}}`.

The pinned head commit (`9588c1ea…`) only extracts two local constants — a readability refactor with no
behavior change, so it needs no port of its own.

**Disposition: already present; no port.**

### [#944](https://github.com/cheaper-inference/OmniRoute/pull/944) — `587bab3e…` / `34c41d5f…`

Upstream merged change: keep the Gemini `thoughtSignature` on the `functionCall` part itself instead of a
sibling part, persist the provider-issued signature per tool-call id, replay it on the next request, stop
stripping `thoughtSignature` from Antigravity content that carries a function call, and normalize
namespace-prefixed Antigravity tool names.

Local behavior — all of the contract exists, and further:

- Store: `open-sse/services/geminiThoughtSignatureStore.js` (session-namespaced, persisted, 1-hour memory TTL)
  and `open-sse/services/thoughtSignatureStore.js` (adds a model-family check so a signature is only replayed
  to a backend of the same family). Upstream's store was an in-memory map with a 1000-entry cap and a
  1-hour TTL; the local pair is a superset.
- Signature on the `functionCall` part: `open-sse/translator/request/openai-to-gemini.js:270-284` attaches the
  provider-issued signature, the stored signature, or the provider default to the `functionCall` part;
  `open-sse/translator/request/claude-to-gemini.js:92` attaches a known signature to the `functionCall` part.
- Capture at response time: `open-sse/translator/response/gemini-to-openai.js:44-47` and `:120-122` store the
  provider-issued signature against the raw tool-call id.
- Antigravity executor: `open-sse/executors/antigravity.js:327-358` keeps `thoughtSignature` on parts that
  carry a function call and backfills from the store.
- Observed: an OpenAI→Gemini request whose assistant turn holds a function call produced a model part
  `{"functionCall":{"id":"c1","name":"read","args":{"p":1}},"thoughtSignature":"EuwGCukGAXLI2…"}`.

Recorded divergence: the direct Claude→Gemini route (`open-sse/translator/request/claude-to-gemini.js`)
attaches a signature only when the client or the store supplies one; it has no synthetic default. Observed
for a Claude turn carrying a `tool_use` block: the model part is `{"functionCall":{"id":"c1","name":"read","args":{"p":1}}}`
with no `thoughtSignature`, and the paired `tool_result` degrades to the text placeholder
`"[Historical tool result for read]: ok"` instead of a Gemini `functionResponse`
(`open-sse/translator/request/claude-to-gemini.js:103-109`). Upstream always attaches at least a default
signature to the first `functionCall` of a model turn, which keeps the pairing. The local behavior follows
from a deliberate local design — signatures are never fabricated on this route, and a fabricated one is
rejected by strict Gemini backends — so this is recorded as a divergence, not as a port candidate.

**Disposition: already present and extended; no port.**

### [#1098](https://github.com/cheaper-inference/OmniRoute/pull/1098) — `26b84abb…` / `586e9f32…`

Upstream merged change: on a Responses `response.failed` / `error` event, record a normalized upstream
failure (429 for `rate_limit_exceeded`, otherwise 502), stop the stream, keep the upstream model in the
translated state, and terminate the SSE with an error body.

Local behavior — the failure is surfaced, by a different mechanism:

- `open-sse/translator/response/openai-responses.js:970-999` handles `error` and `response.failed`: it sets
  `state.error`, sets `state.finishReasonSent` so later chunks are dropped, sanitizes the message so no
  credential can leak, releases text that was already streamed, and emits an OpenAI-compatible error chunk.
  Observed for a `response.failed` event carrying `{code:"rate_limit_exceeded", message:"slow down"}`:
  a chunk `{"id":"chatcmpl-…","model":"unknown","choices":[{"index":0,"delta":{"content":"[Error] slow down"},"finish_reason":"stop"}]}`
  with `state.finishReasonSent === true`.
- The stream layer keeps a structured copy: `open-sse/utils/streamLifecycle.js:72-82` (`extractStreamErrorPayload`)
  recognizes `response.failed` (nested `response.error`) and `error` frames and carries `{type, code, message}`;
  `open-sse/utils/stream.js:70-90` sanitizes the public error envelope and forwards the raw payload as
  `upstreamError` to the completion callback, so a stream that failed after HTTP 200 is recorded as an error
  and not as a success.
- Upstream model identity: upstream's change only applies when `state.model` is unset. Locally the translate
  state always carries the requested model (`open-sse/utils/stream.js:237`) and the lifecycle `response.model`
  is rewritten to the client-requested id by `open-sse/services/responseModelEcho.js`, so upstream's guard is
  equally inert here and there is no distinct local behavior to port.

Recorded divergence: upstream aborts the stream with a 429/502 error body, while the local fork keeps the SSE
shape and reports the failure as an in-band error chunk. Both stop the stream and both carry the upstream
error code.

**Disposition: already present; no port.**

### [#1245](https://github.com/cheaper-inference/OmniRoute/pull/1245) — `d55e3e4e…` / `678298f2…`

Upstream merged change: in the Chat→Responses request converter, translate `max_completion_tokens` to
`max_output_tokens` (taking priority over `max_tokens`), because the Responses API accepts neither
`max_tokens` nor `max_completion_tokens`.

Local behavior — the `max_tokens` half is present, the `max_completion_tokens` half is missing:

- `open-sse/translator/request/openai-responses.js:814-821` (`normalizeResponsesOutputLimit`) maps a source
  `max_output_tokens` or `max_tokens` to the target `max_output_tokens` and deletes `max_tokens`. It never
  reads `max_completion_tokens`. It is called at `:1006` for the Chat-shaped request and at `:858` for the
  Responses-envelope request.
- Observed, Chat-shaped request `{messages:[…], max_completion_tokens: 8}` → the Responses body keys are
  `["model","input","stream","store","instructions"]`: no limit field at all.
- Observed, Responses-envelope request `{input:[…], max_completion_tokens: 8}` → the body keeps
  `max_completion_tokens: 8` verbatim. That field is not part of the Responses API contract, so it is
  forwarded upstream as-is.
- Observed, `{messages:[…], max_tokens: 8, max_completion_tokens: 13}` → `max_output_tokens: 8`. Upstream
  yields 13, because `max_completion_tokens` takes priority.
- The local tree already documents the drop: `open-sse/executors/github.js:141-143` states that the
  `/responses` route bypasses `transformRequest` and that "its converter maps max_tokens but drops
  max_completion_tokens, so running the forward rename there would lose the cap". The rename that would
  otherwise recover it (`open-sse/translator/concerns/paramSupport.js:248-264`, `applyParamRenames`) is
  deliberately scoped to the Chat route.
- Impact on the GitHub Copilot `/responses` route: `open-sse/executors/github.js:712` builds the body with
  `openaiToOpenAIResponsesRequest` and `:717-719` clamps the custom-model output cap on `max_output_tokens`.
  A client that sent `max_completion_tokens` therefore loses its output cap entirely on that route.
- No local fixture pins this: `tests/translator/openai-responses-max-tokens.test.js` covers `max_tokens`
  renaming, an explicit `max_output_tokens`, the envelope path, and the plain Chat transport — but has no
  `max_completion_tokens` case.

**Disposition: residual — portable.** Focused port described below.

### [#1414](https://github.com/cheaper-inference/OmniRoute/pull/1414) — `6fd8a75e…` / `5be86907…`

Upstream merged change: in the Chat→Responses request converter, preserve an explicit `reasoning` object, or
map `reasoning_effort` to `reasoning.effort`.

Local behavior — the converter honors the contract, and the generic request path relocates the effort:

- `open-sse/translator/request/openai-responses.js:1017-1021` keeps `body.reasoning` and maps
  `body.reasoning_effort` into `reasoning.effort`. Observed for
  `{messages:[…], reasoning_effort:"high"}`: the converter alone produces
  `reasoning: {"summary":"auto","effort":"high"}` — exactly upstream's shape.
- The generic request path then runs the centralized thinking normalizer, which strips `reasoning.effort`
  again for Responses targets (`open-sse/translator/concerns/thinkingUnified.js:288-303`, `stripAll` with
  `preserveResponsesReasoning`) and re-applies the effort in the format it resolved for the provider.
  Observed end-to-end through `translateRequest(OPENAI, OPENAI_RESPONSES, …)`:
  `{"reasoning":{"summary":"auto"},"reasoning_effort":"high"}` — the nested effort is gone and a top-level
  `reasoning_effort` is present instead.
- The executor paths that build the Responses body directly are unaffected: the Codex executor re-homes a
  top-level `reasoning_effort` into `reasoning.effort` before the wire
  (`open-sse/executors/codex.js:1043-1065`), and the GitHub Copilot `/responses` route calls the converter
  directly (`open-sse/executors/github.js:712`), which keeps the nested effort.
- The relocation only affects transports whose resolved thinking format is not the Responses shape; a
  transport that declares `thinkingFormat: "openai-responses"` keeps the nested field.

Recorded divergence: on the generic request path for such transports, the requested effort is carried in a
field the Responses API does not read, and the nested `reasoning.effort` is dropped. This is a property of
the local centralized thinking normalizer rather than of the Chat→Responses converter, and it interacts with
other local thinking ports, so it is recorded rather than proposed for a port here.

**Disposition: partially present; recorded divergence, no port here.**

### [#1483](https://github.com/cheaper-inference/OmniRoute/pull/1483) — `9bfd1792…` / `9cd36af3…`

Upstream merged change: accept `type: "namespace"` tools in the Responses tool-type validation instead of
rejecting them as an unsupported feature, and keep the namespace tool when normalizing Codex tools while
registering its sub-tool names for `tool_choice` validation.

Local behavior — the contract holds, with a different tool-name contract:

- `open-sse/translator/request/openai-responses.js:656-672` expands a Responses namespace tool into Chat
  function tools with a qualified name instead of throwing. Observed for
  `{input:[…], tools:[{type:"namespace", name:"mcp", tools:[{name:"read", …}]}]}`: the translated body carries
  `{"type":"function","function":{"name":"mcp_read_e78dffd5cb83","description":"d","parameters":{…}}}` — no
  unsupported-feature error.
- `open-sse/executors/codex.js:369-393` keeps a `namespace` tool, registers each sub-tool name in the
  valid-name set used for `tool_choice` validation, and sanitizes the sub-tool schemas.
- The local qualified-name form (dotted, then length-hashed) is the local aliasing contract
  (`open-sse/translator/index.js:195-212`), not upstream's verbatim pass-through, and
  `tests/translator/port-3241-namespace-tools.test.js` pins it. The upstream shape is preserved end to end
  by the local alias/restore pair, so no upstream behavior is missing.

**Disposition: already present; no port.**

### [#1528](https://github.com/cheaper-inference/OmniRoute/pull/1528) — `0138b8ca…` / `2a58543b…`

Upstream merged change: map a Claude `output_config.effort` to the OpenAI `reasoning_effort` and to a
Gemini `thinkingConfig.thinkingBudget`, and derive `reasoning_effort` from a Claude `thinking.budget_tokens`
bucket when no explicit effort is present. The merged record also adds `.github/workflows/build-fork.yml`
(CI-only, no runtime surface).

Local behavior — the intent is handled centrally, with local budget tables:

- `open-sse/translator/request/claude-to-openai.js:141-147` maps a Claude `output_config.effort` — including a
  per-turn system directive — to `reasoning_effort`. Observed for `{output_config:{effort:"high"}}` on a
  reasoning-capable OpenAI-format transport: `reasoning_effort: "high"`. With only
  `thinking:{type:"enabled", budget_tokens:2048}`: `reasoning_effort: "low"` — the local bucket table differs
  from upstream's, the intent does not.
- `open-sse/translator/concerns/thinkingUnified.js:34-41` gives `output_config.effort` priority over adaptive
  thinking when extracting the intent, and `:461-467` renders a Gemini budget transport as
  `generationConfig.thinkingConfig = {thinkingBudget, includeThoughts:true}`. Observed for
  `{output_config:{effort:"high"}}` on a Gemini transport:
  `{"maxOutputTokens":32768,"thinkingConfig":{"thinkingBudget":24576,"includeThoughts":true}}`; with
  `thinking.budget_tokens: 2048`: `{"maxOutputTokens":16384,"thinkingConfig":{"thinkingBudget":2048,"includeThoughts":true}}`.
  Upstream's effort table is `{low:1024, medium:10240, high:32768, max:131072, xhigh:131072}`; the local
  table differs, and both map an effort to a positive budget with thoughts included.
- `.github/workflows/build-fork.yml` is a CI workflow in the upstream repository and has no local runtime
  counterpart; it is out of scope for runtime parity.

**Disposition: already present; no port.**

### [#1645](https://github.com/cheaper-inference/OmniRoute/pull/1645) — `6c5ae12e…` / `97912c7d…`

Upstream merged change: remove the shared per-request client-header field on the GitHub executor (a
concurrency defect) and pass the client headers through `buildHeaders` instead, forward the client's
`x-initiator` value, drop the GitHub streaming transform that discarded the `data: [DONE]` frame, reuse a
module-level `TextEncoder`/`TextDecoder` in the Kiro executor, and parse Kiro tool inputs defensively.

Local behavior:

- Concurrency defect: not present. The local GitHub executor holds no per-request client-header state —
  `open-sse/executors/github.js:65-83` (`buildHeaders(credentials, stream)`) is stateless, so there is no
  shared mutable field to fix.
- `data: [DONE]` handling: not present. The local GitHub executor emits its own terminal frame
  (`open-sse/executors/github.js:676` and `:807`) and has no transform that drops an upstream `[DONE]` chunk.
- Defensive Kiro tool-input parsing: present for the function branch —
  `open-sse/translator/request/openai-to-kiro.js:415` uses `safeJSONParse(tc.function.arguments, {})`, which
  returns `{}` for unparsable JSON. The sibling branch at `:419` still passes `tc.input || {}` through
  unchanged, where upstream routes both branches through one `parseToolInput` helper.
- Kiro encoder reuse: not present — `open-sse/executors/kiro.js:705-1253` still constructs a `TextEncoder`
  per frame. This is a per-frame allocation with no contract change, and the local Kiro executor has since
  diverged substantially from the upstream file, so there is no upstream-shaped hunk to apply.

Recorded divergences: the client's `x-initiator` value is not forwarded to the Copilot endpoint (the local
executor always sends `X-Initiator: user`, while upstream forwards an `agent`/`user` value case-insensitively
and falls back to `user`) — the local tree reads that header elsewhere
(`open-sse/utils/clientDetector.js:25`, `src/mitm/handlers/base.js:23`) but not on the executor path; and the
non-function Kiro tool-input branch is not parsed defensively.

**Disposition: already present for the defect classes upstream fixed; two narrow divergences recorded, no port here.**

## Residual — one focused port

**Target: [#1245](https://github.com/cheaper-inference/OmniRoute/pull/1245), head `d55e3e4e18d1edd38bc82893a9a70adcd99ba08e`,
merge `678298f2420b08dd36e9ea9f17cbe65b74a827d5`.**

**Concrete behavior.** On the Chat Completions → OpenAI Responses request translation, a client-supplied
`max_completion_tokens` is not translated to `max_output_tokens`:

- Chat-shaped body `{messages:[…], max_completion_tokens: 8}` → Responses body
  `{model, input, stream, store, instructions}` — the output limit is dropped silently, and the upstream
  request carries no limit at all.
- Responses-envelope body `{input:[…], max_completion_tokens: 8}` → the Responses body keeps
  `max_completion_tokens: 8` verbatim, a field the Responses API does not define.
- Chat-shaped body `{messages:[…], max_tokens: 8, max_completion_tokens: 13}` → `max_output_tokens: 8`;
  upstream yields 13 because `max_completion_tokens` takes priority.

**Why it matters.** The Responses API accepts `max_output_tokens` only. A Chat client that caps its output
with `max_completion_tokens` — the current Chat Completions field — loses that cap on every Responses
transport, including the GitHub Copilot `/responses` route
(`open-sse/executors/github.js:712-719`), where the custom-model clamp also runs against `max_output_tokens`
and therefore has nothing to clamp.

**Local evidence.**

- `open-sse/translator/request/openai-responses.js:814-821` — `normalizeResponsesOutputLimit` reads
  `source.max_output_tokens` and `source.max_tokens` only; `max_completion_tokens` is never consulted.
- `open-sse/translator/request/openai-responses.js:1006` and `:858` — the two call sites (Chat-shaped body and
  Responses-envelope body).
- `open-sse/executors/github.js:141-143` — the in-tree note that the `/responses` converter "maps max_tokens
  but drops max_completion_tokens".
- `open-sse/translator/concerns/paramSupport.js:248-264` — `applyParamRenames`, the Chat-route-only rename
  that would otherwise carry `max_completion_tokens` into `max_tokens`; it is deliberately not applied on the
  Responses route.
- `tests/translator/openai-responses-max-tokens.test.js` — the existing fixture covers `max_tokens` and an
  explicit `max_output_tokens`, and has no `max_completion_tokens` case.

**Proposed scope (one focused port).** In `open-sse/translator/request/openai-responses.js`, extend
`normalizeResponsesOutputLimit` so that a source `max_completion_tokens` maps to the target
`max_output_tokens`, with `max_completion_tokens` taking priority over `max_tokens` (upstream's ordering), and
so that the envelope path stops forwarding `max_completion_tokens` verbatim. Extend
`tests/translator/openai-responses-max-tokens.test.js` with the three cases above. No executor, provider,
credential, or stream code is touched.

**Acceptance check.** A local unit assertion that `{max_completion_tokens: 8}` yields
`max_output_tokens: 8` and no `max_tokens`/`max_completion_tokens`, that `{max_tokens: 8, max_completion_tokens: 13}`
yields `max_output_tokens: 13`, and that the envelope-shaped body no longer carries `max_completion_tokens`.

**Why this is safe to prepare.** The change is confined to one request-translation helper plus its fixture.
It is verifiable offline against the local translator with no provider traffic, no credential access, and no
change to any provider, sign-in, catalog, or stream path.

## Limits

- The upstream PR titles, bodies, and review threads were not read. Behavior was taken from the merged source
  records (merge commit diffs) in the read-only mirror, which is the pinned upstream state for each row.
- No upstream provider was contacted. Provider-side behavior (for example, whether a Responses upstream
  rejects an unknown `max_completion_tokens` field) is described from the upstream contract and the upstream
  test changes, not reproduced live.
- Probe values quoted above come from temporary Vitest files under `tests/unit/` that were created, executed,
  and then deleted. The committed tree contains only this report.
- The `reasoning_effort` relocation recorded under [#1414](https://github.com/cheaper-inference/OmniRoute/pull/1414) was
  observed through the generic `translateRequest` path with a reasoning-capable capability row; it was not
  observed against a live Responses transport, and its interaction with the other local thinking ports was not
  evaluated.
- The divergence recorded under [#944](https://github.com/cheaper-inference/OmniRoute/pull/944) (no synthetic default
  signature on the direct Claude→Gemini route) was observed on the local translator only; whether the pairing
  loss is acceptable product behavior is a product decision, not a comparison result.
- The whole suite was not run, and no browser, Docker, or e2e surface was used.

Refs #1073
