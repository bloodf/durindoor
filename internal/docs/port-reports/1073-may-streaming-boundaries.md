# #1073 — May 2026 OmniRoute streaming boundaries

Reviewed 2026-11-21 against DurinDoor `4e3de852e260d03f90565065de371a75224a543f` on branch
`orq/tornf6/audit-omni-may-streaming-boundaries-a1-l2`. Source:
[`cheaper-inference/OmniRoute`](https://github.com/cheaper-inference/OmniRoute).
This is a bounded source-change comparison and a disposition ledger. It produces no owner selection list and
no product edit.

## Scope and method

Eight merged May 2026 OmniRoute pull requests were compared. Complete changed-path lists and exact merge records were checked against the linked upstream pull requests; every row is `MERGED`, every head and merge SHA is 40-character lowercase hex, and each row's path count matches its recorded total. Metadata was treated as data only.

The exact merged source diff for each pull request was reconstructed from the pinned upstream merge commits and **validated against the pull request changed-path list before any comparison**:

| PR | Head SHA | Merge SHA | Merge shape | Diff base used | Path list vs metadata |
| --- | --- | --- | --- | --- | --- |
| [#1840](https://github.com/cheaper-inference/OmniRoute/pull/1840) | `9710a9cd971c10f78d6b0d5c0560acfd626f02ac` | `3d70ad414ef9568c80f59e8f656fc8a0ddaa1459` | squash (one parent) | merge commit → first parent | identical, 4 paths |
| [#1868](https://github.com/cheaper-inference/OmniRoute/pull/1868) | `148a8bcd1abb0310073422bff794c18647c56dec` | `1e3c08565c7bfb0d51b8a0a1b929f7b71b9e0c4d` | squash (one parent) | merge commit → first parent | identical, 6 paths |
| [#1888](https://github.com/cheaper-inference/OmniRoute/pull/1888) | `3700db2d382e09b3f068e7918d471eecad1e0e97` | `d4408add0476169f9a28019210f302fb9248e08c` | squash (one parent) | merge commit → first parent | identical, 2 paths |
| [#1899](https://github.com/cheaper-inference/OmniRoute/pull/1899) | `8dfe648b7ad256de4aa95fe19d972f26f34f9b39` | `37a4a66e9375df74b51915758e757a0fbb8d0f38` | squash (one parent) | merge commit → first parent | identical, 2 paths |
| [#1923](https://github.com/cheaper-inference/OmniRoute/pull/1923) | `4c17c3527c435f57413878b2cea7e7ef045e34f8` | `3f063e5c52238d9e9bea4a135862aa7bdcf76f42` | squash (one parent) | merge commit → first parent | identical, 4 paths |
| [#1930](https://github.com/cheaper-inference/OmniRoute/pull/1930) | `bfcb068a5502c57dbaf3b4d31fdf08c0d7ef43c3` | `37058ad3d278ba1e22cd4a82370ab10bd5e261c3` | squash (one parent) | merge commit → first parent | identical, 5 paths |
| [#2061](https://github.com/cheaper-inference/OmniRoute/pull/2061) | `abe830101a720dc2f37aabaf092b9564c3ada448` | `962faa84e9c8dda1e43dc98854a2f48e99a60349` | squash (one parent) | merge commit → first parent | identical, 4 paths |
| [#2123](https://github.com/cheaper-inference/OmniRoute/pull/2123) | `fa524f4ac13eac8f56637af9a35fdce3ac065934` | `86db9bcf4768a6fcbd1d25325032c413f7edd40d` | squash marker with an **empty tree delta** | head commit `fa524f4ac` → its first parent | identical, 5 paths |

Two mirror-specific facts were recorded because they change how the patch must be read:

- For #2123 the merge commit `86db9bcf4768a6fcbd1d25325032c413f7edd40d` has the same tree as its parent
  (`1c9fd944480613f1dce0302344b5a3fcd8793378` for both). The merged content therefore lives on the head
  commit `fa524f4ac13eac8f56637af9a35fdce3ac065934`; diffing the merge commit alone would have produced an
  empty patch. The head-commit diff reproduces the metadata path list exactly.
- For #1888 the head object `3700db2d382e09b3f068e7918d471eecad1e0e97` is unavailable in the mirror. The
  merge commit is present and carries the full patch, so the comparison used the merge commit only.

Local comparison used static source reading of the current tree plus one focused offline probe. No runtime
change, no product edit, no provider request, no paid API, no browser, no Docker, no e2e run and no
full-suite run was made. Security-sensitive hunks were compared statically only; no exploit was developed and
no vulnerability was reproduced.

Offline probe (one-off script executed outside the repository tree, then removed; no probe file is part of
this change):

```
node /tmp/p1073/probe-usage.mjs
```

Result — the same DeepSeek-shaped payload through the two local extractors:

```
STREAM   extractUsage  : {"prompt_tokens":1000,"completion_tokens":100,"total_tokens":1100,"cached_tokens":768}
NONSTRM  canonicalize  : {"prompt_tokens":1000,"completion_tokens":100,"total_tokens":1100,"cached_tokens":0,"cache_creation_input_tokens":0}
```

## Disposition ledger

| Source PR | Head SHA | Merge SHA | Classification | Disposition |
| --- | --- | --- | --- | --- |
| [#1840](https://github.com/cheaper-inference/OmniRoute/pull/1840) | `9710a9cd971c10f78d6b0d5c0560acfd626f02ac` | `3d70ad414ef9568c80f59e8f656fc8a0ddaa1459` | New feature (compression control surface) | Already covered by a different, existing local mechanism. The master enable flag already wins over every per-engine and per-combo override before an engine is resolved, and the upstream combo-dropdown hunk has no local surface because the fork has no per-combo compression override at all. |
| [#1868](https://github.com/cheaper-inference/OmniRoute/pull/1868) | `148a8bcd1abb0310073422bff794c18647c56dec` | `1e3c08565c7bfb0d51b8a0a1b929f7b71b9e0c4d` | New feature (Codex request shaping + replay state) | Mixed. The streaming-boundary hunk is already implemented locally with the same restrictive rule. The CLI-fingerprint hunk and the remembered-conversation sanitization hunk are structurally absent, because the fork has neither module. |
| [#1888](https://github.com/cheaper-inference/OmniRoute/pull/1888) | `3700db2d382e09b3f068e7918d471eecad1e0e97` | `d4408add0476169f9a28019210f302fb9248e08c` | Authentication work (OAuth account rotation) | Covered by a different, existing local mechanism that is broader than the upstream change: account rotation on 429 is provider-agnostic in the fork, not Codex-specific, and does not depend on an explicit affinity delete. |
| [#1899](https://github.com/cheaper-inference/OmniRoute/pull/1899) | `8dfe648b7ad256de4aa95fe19d972f26f34f9b39` | `37a4a66e9375df74b51915758e757a0fbb8d0f38` | Provider addition (NanoGPT image generation) | Excluded as a provider addition. The fork has NanoGPT as a chat/transport provider only, with no image adapter and no image-provider registry to extend. |
| [#1923](https://github.com/cheaper-inference/OmniRoute/pull/1923) | `4c17c3527c435f57413878b2cea7e7ef045e34f8` | `3f063e5c52238d9e9bea4a135862aa7bdcf76f42` | New feature (request-log column) | Covered by a different, existing local mechanism. The fork has no `call_logs` table and reports compression savings through a response header and per-engine stats instead of a stored token column. |
| [#1930](https://github.com/cheaper-inference/OmniRoute/pull/1930) | `bfcb068a5502c57dbaf3b4d31fdf08c0d7ef43c3` | `37058ad3d278ba1e22cd4a82370ab10bd5e261c3` | Narrow usage-parser repair + catalog values | The non-streaming usage parser has a narrow existing repair gap for the provider flat cache-read field, confirmed by the offline probe. Dated promotional pricing is catalog data and is not part of the port. |
| [#2061](https://github.com/cheaper-inference/OmniRoute/pull/2061) | `abe830101a720dc2f37aabaf092b9564c3ada448` | `962faa84e9c8dda1e43dc98854a2f48e99a60349` | New non-provider capability (dynamic tool-limit learning + proactive truncation) | Out of scope. The fork has no provider-scoped tool-limit detection and no proactive tool truncation on the chat path; these static findings do not make the capability an applicable port. |
| [#2123](https://github.com/cheaper-inference/OmniRoute/pull/2123) | `fa524f4ac13eac8f56637af9a35fdce3ac065934` | `86db9bcf4768a6fcbd1d25325032c413f7edd40d` | Provider addition (Inworld TTS formats) + catalog refresh | Excluded as a provider addition and a provider-catalog refresh. The fork has no audio-provider `supportedFormats` concept and resolves Inworld voices from the live provider instead of a hardcoded preset list. |

## #1840 — hide combo compression controls when disabled

Source change, exact diff `3d70ad414ef9568c80f59e8f656fc8a0ddaa1459` → first parent:

- `open-sse/handlers/chatCore.ts` — the compression settings read is hoisted out of the pipeline block into a
  single guarded lookup, and the result becomes `promptCompressionEnabled`. The proactive threshold check
  becomes `promptCompressionEnabled && estimatedTokens > threshold`, so a disabled compression configuration
  can no longer trigger the reactive path either. The pipeline falls back to a disabled `CompressionConfig`
  when the settings read throws, and logs the skip.
- `src/app/(dashboard)/dashboard/combos/page.tsx` — the combos page fetches `/api/settings/compression` and
  passes `compressionEnabled` into each `ComboCard`; the compression-override `<select>` is only rendered when
  compression is enabled. The initial override value stops falling back to `combo.compressionOverride` once
  a runtime `config` object exists.
- `tests/integration/chatcore-compression-integration.test.ts`, `tests/unit/compression/strategySelector.test.ts`
  — the integration cases now set the enabled flag explicitly, and a new case asserts that a disabled
  configuration leaves the outgoing messages unchanged and records no analytics. The strategy-selector case
  asserts that a disabled configuration stays `off` "despite combo override and auto-trigger".

Local findings:

- **The upstream rule is already the local rule.** The fork's compression plan derivation is
  [open-sse/services/compression/deriveDefaultPlan.js:20](../../../open-sse/services/compression/deriveDefaultPlan.js),
  and its first rule is `if (!masterEnabled) return { mode: "off", stackedPipeline: [] };`
  ([deriveDefaultPlan.js:21](../../../open-sse/services/compression/deriveDefaultPlan.js)).
  The master flag is evaluated before any per-engine toggle is read, which is exactly the upstream assertion
  "keeps disabled config off despite combo override and auto-trigger".
- **The seam is operator-gated end to end.** The engine stack runs only inside
  `if (tokenSaverEnabled && compressionEnabled)`
  ([open-sse/handlers/chatCore.js:961](../../../open-sse/handlers/chatCore.js)),
  and the flag comes from the settings store at
  [src/sse/handlers/chat.js:1350](../../../src/sse/handlers/chat.js)
  (`compressionEnabled: !!chatSettings.compressionEnabled`). The seam contract itself documents that a
  disabled request returns before any engine is resolved or applied
  ([open-sse/handlers/chatCore/compressionHook.js:9](../../../open-sse/handlers/chatCore/compressionHook.js)).
- **The upstream dashboard hunk has no local surface.** The fork has no per-combo compression override:
  a whole-tree search for `compressionMode` and `compressionOverride` returns no hit in `src/`, `open-sse/` or
  `tests/`. The only occurrence of the upstream concept is the vestigial `comboOverrides: {}` default on the
  fork's compression config type
  ([open-sse/services/compression/types.js:30](../../../open-sse/services/compression/types.js)),
  which is never populated or consulted. There is therefore no combo card, no dropdown and no override write
  path to hide.
- **The upstream test-fixture change has a local analogue.** Local coverage for the seam is
  `tests/unit/compression-chatcore-f1b.test.js`, `tests/unit/compression-chatcore-header.test.js`,
  `tests/unit/compression/adaptive-budget.test.js` and `tests/unit/compression/plan-to-engine-ids.test.js`.

Disposition: no port required. The behavior the upstream change protects — a disabled compression
configuration cannot be overridden into activity — is already guaranteed locally at the plan-derivation
boundary, and the UI half of the upstream change is structurally absent.

## #1868 — sanitize Codex Responses replay state

Source change, exact diff `1e3c08565c7bfb0d51b8a0a1b929f7b71b9e0c4d` → first parent, three independent hunks:

- `open-sse/config/cliFingerprints.ts` — the Codex `bodyFieldOrder` is rewritten from the Chat Completions
  ordering (`model, messages, temperature, top_p, max_tokens, stream, tools, …`) to the Responses ordering
  (`model, stream, input, instructions, store, reasoning, tools, tool_choice, include, service_tier,
  prompt_cache_key, client_metadata, parallel_tool_calls, metadata`).
- `open-sse/services/responsesToolCallState.ts` — a new `sanitizeRememberedConversationItems` drops remembered
  assistant frames whose `phase` is present and not `final`. The rationale in the source is that OpenCode can
  emit assistant-side commentary or analysis frames in Responses shape; those are local runtime state, not
  durable conversation turns, and re-injecting them makes the model continue hidden notes. The sanitizer is
  applied on remember, on merge, and on read-back.
- `open-sse/utils/stream.ts` — in the Responses branch of the SSE passthrough, generic `parsed.delta` values
  still count toward the content-length estimate, but only `response.output_text.delta` deltas are appended to
  the accumulated assistant content. Reasoning-summary deltas and function-call argument deltas therefore stop
  reaching the logged and replayed assistant content.

Local findings:

- **The streaming-boundary hunk is already implemented, with the same restrictive rule.** The fork's provider
  summary gates assistant text on the Responses output-text event:
  `if (chunk.type === "response.output_text.delta") responseText = append(responseText, chunk.delta, MAX_TEXT);`
  ([open-sse/utils/stream.js:322](../../../open-sse/utils/stream.js)).
  Reasoning-summary deltas are not handled in that branch at all, and function-call argument deltas are routed
  into `tool.arguments` rather than into text
  ([open-sse/utils/stream.js:330](../../../open-sse/utils/stream.js)).
  The summary is finalized into the provider response at
  [open-sse/utils/stream.js:411](../../../open-sse/utils/stream.js),
  where the assistant message is built from `responseText` only, and only when there are no tool calls — so the
  fork is at least as restrictive as the upstream fix.
  This hunk is security-sensitive: it is the boundary that keeps internal reasoning text and tool-call
  argument payloads out of logged and replayed assistant content. The comparison above is static reading and
  boundary tracing only. No exploit was developed and nothing was reproduced against a live provider.
- **The CLI-fingerprint hunk has no local counterpart.** A whole-tree search for `CLI_FINGERPRINTS` and
  `bodyFieldOrder` returns no hit in `src/`, `open-sse/` or `tests/`. The fork does not reorder request body
  keys by CLI fingerprint. The Codex executor instead strips unsupported fields from the forwarded body
  ([open-sse/executors/codex.js:1080](../../../open-sse/executors/codex.js)
  through
  [open-sse/executors/codex.js:1098](../../../open-sse/executors/codex.js)),
  and the local Responses request translator owns the field set it emits.
- **The remembered-conversation hunk has no local counterpart.** A whole-tree search for
  `responsesToolCallState`, `rememberResponseFunctionCalls`, `rememberResponseConversationState` and
  `getRememberedResponseConversationItems` returns no hit in `src/`, `open-sse/` or `tests/`. The fork keeps no
  server-side store of remembered Responses conversation items or function calls keyed by response id. The
  Codex executor removes `previous_response_id` before forwarding
  ([open-sse/executors/codex.js:1098](../../../open-sse/executors/codex.js)),
  so there is no replay path in which a stale internal frame could be re-injected. The closest local surface,
  [open-sse/translator/response/openai-responses/historyToolIdentity.js:1](../../../open-sse/translator/response/openai-responses/historyToolIdentity.js),
  reads only the client-supplied request `input`, not a server-side remembered store, and its purpose is
  recovering namespaced tool identities.

Disposition: mixed, no port required. The one hunk that changes a streaming boundary is already implemented
locally under the same rule. The remaining two hunks belong to modules the fork does not have, so there is no
local behavior for them to change.

## #1888 — Codex 429 mid-task failover with account rotation

Source change, exact diff `d4408add0476169f9a28019210f302fb9248e08c` → first parent:

- `open-sse/handlers/chatCore.ts` — the rate-limit retry budget becomes `provider === "qwen" ? 3 : provider ===
  "codex" ? 3 : 1`. On a Codex 429 with attempts left, the failing connection is marked rate-limited in the
  database (`rateLimitedUntil`, `testStatus: "unavailable"`, `lastError`, `errorCode: 429`), the session
  affinity record for the request is deleted so the next attempt is not pinned to the failing account, the next
  Codex connection is fetched with the failing ids excluded, an audit event is written, and the in-scope
  credentials object is patched in place with the new account before the retry.
- `tests/unit/codex-failover.test.js` — new file covering affinity-key extraction, the attempt budget, the
  excluded-id accumulator, `Retry-After` parsing, the credential mutation, the 429-only trigger, and the
  stop conditions.

Local findings:

- **The fork already rotates accounts on 429, and does so for every provider.** The chat entry point owns
  the retry loop: an `excludeConnectionIds` set is created at
  [src/sse/handlers/chat.js:1065](../../../src/sse/handlers/chat.js),
  and each attempt re-selects credentials through
  `getProviderCredentialsWithQuotaPreflight(provider, excludeConnectionIds, model, …)`
  ([src/sse/handlers/chat.js:1102](../../../src/sse/handlers/chat.js)).
  A failed attempt is turned into a rotation by `markAccountUnavailable` and its `shouldFallback` verdict
  ([src/sse/handlers/chat.js:1578](../../../src/sse/handlers/chat.js)),
  after which the connection is excluded and the loop continues
  ([src/sse/handlers/chat.js:1606](../../../src/sse/handlers/chat.js)).
- **429 is a rotation trigger in the fork.** The fallback rule table marks 429 as a backoff-and-rotate status
  (`{ status: 429, backoff: true }`, [open-sse/config/errorConfig.js:220](../../../open-sse/config/errorConfig.js)),
  and `checkFallbackError` is the single decision point
  ([open-sse/services/accountFallback.js:53](../../../open-sse/services/accountFallback.js)).
- **The fork's affinity model differs, and the outcome is the same.** Session affinity is an in-memory map
  ([src/sse/services/auth.js:129](../../../src/sse/services/auth.js)),
  consulted only for the round-robin strategy
  ([src/sse/services/auth.js:1047](../../../src/sse/services/auth.js)),
  and it is honored only when the remembered connection is still among the eligible connections. A connection
  that has just been benched by the 429 handling is no longer eligible, so the sticky pin does not survive the
  failure and the next attempt lands on a different account without an explicit affinity delete. The fork
  therefore reaches the upstream outcome by a different route: the upstream delete of a database affinity row
  has no local counterpart because the fork has no such table.
- **The attempt budget is bounded locally, and more generously.** `MAX_ACCOUNT_ATTEMPTS_PER_REQUEST` is 1024
  ([src/sse/handlers/chat.js:93](../../../src/sse/handlers/chat.js)),
  and the per-connection attempt count is capped by `allowedAttempts`
  ([src/sse/handlers/chat.js:1199](../../../src/sse/handlers/chat.js)).
- **Existing local coverage.** `tests/unit/account-fallback-request-errors.test.js`,
  `tests/unit/account-fallback-request-scoped-4xx.test.js`,
  `tests/unit/account-fallback-cloudcode.test.js`, `tests/unit/chat-quota-fallback.test.js` and
  `tests/unit/provider-session-sticky.test.js` cover the fallback decision and the affinity behavior.
- **The upstream test file is not a local fixture.** `tests/unit/codex-failover.test.js` does not exist here;
  its assertions describe logic the fork expresses through different modules.

Disposition: no port required. The upstream change adds a Codex-specific rotation path where the fork
already has a provider-agnostic one, with the same observable outcome: the failing account is benched, the
next eligible account is used, and the client sees the retried result. The fork's mechanism is strictly
broader, and its affinity state is process-local rather than persisted.

## #1899 — NanoGPT image generation provider

Source change, exact diff `37a4a66e9375df74b51915758e757a0fbb8d0f38` → first parent:

- `open-sse/config/imageRegistry.ts` — a new `nanogpt` image provider entry with base URL
  `https://nano-gpt.com/api/v1/images/generations`, bearer API-key auth, the OpenAI response format, four
  models (`qwen-image`, `z-image-turbo`, `chroma`, `hidream`) and three supported sizes.
- `open-sse/handlers/imageGeneration.ts` — `qwen-image` is added to the set of models that may take an image
  input and are routed through the OpenAI image-to-image shape.

Local findings:

- **NanoGPT exists here as a chat provider only.** The registry entry
  ([open-sse/providers/registry/nanogpt.js:19](../../../open-sse/providers/registry/nanogpt.js))
  declares a `transport` with base URL `https://nano-gpt.com/api/v1/chat/completions` and the OpenAI format,
  and carries a chat model list only.
- **There is no image-provider registry to extend.** The fork's image adapters are a fixed map in
  [open-sse/handlers/imageProviders/index.js:22](../../../open-sse/handlers/imageProviders/index.js)
  through
  [open-sse/handlers/imageProviders/index.js:50](../../../open-sse/handlers/imageProviders/index.js),
  with no `nanogpt` entry and no per-provider size or modality registry. A search for `nanogpt` across
  `open-sse/handlers/imageProviders/` and `open-sse/handlers/imageGenerationCore.js` returns no hit.
- The fork's provider capability map does know NanoGPT for text
  ([open-sse/providers/capabilities.js:524](../../../open-sse/providers/capabilities.js)),
  which confirms the provider is present but only on the chat surface.

Disposition: excluded. This is a provider addition — a new upstream service, endpoint and model catalog on a
surface the fork does not have — not a behavior change to an existing path.

## #1923 — show compression tokens in the request log

Source change, exact diff `3f063e5c52238d9e9bea4a135862aa7bdcf76f42` → first parent:

- `src/lib/db/migrations/041_compression_tokens.sql` — new migration adding
  `tokens_compressed INTEGER DEFAULT NULL` to `call_logs`, documented as "NULL = compression not applied,
  N > 0 = tokens eliminated".
- `open-sse/handlers/chatCore.ts`, `open-sse/services/compression/caveman.ts`,
  `open-sse/services/compression/validation.ts` — reformatting only; the diffs contain no semantic change
  beyond line wrapping.

Local findings:

- **The fork has no `call_logs` table.** A whole-tree search for `call_logs` under `src/lib/db/` returns no
  hit, and there is no `tokens_compressed` or `tokensCompressed` field anywhere in `src/`, `open-sse/` or
  `tests/`. The fork's request log is the request-detail record built by
  [open-sse/handlers/chatCore/requestDetail.js:59](../../../open-sse/handlers/chatCore/requestDetail.js),
  whose `tokens` field carries prompt, completion, cache-read and cache-creation counts.
- **Compression savings are surfaced by a different, existing mechanism.** When at least one engine actually
  compressed the body, the fork stamps an `X-DurinDoor-Compression` response header
  ([open-sse/handlers/chatCore.js:99](../../../open-sse/handlers/chatCore.js),
  applied at
  [open-sse/handlers/chatCore.js:138](../../../open-sse/handlers/chatCore.js)),
  whose value is `"<engineId>[,<engineId>…]|<overallSavingsPercent>%"`
  ([open-sse/handlers/chatCore/compressionHook.js:23](../../../open-sse/handlers/chatCore/compressionHook.js)).
  The percentage is computed from the stack input versus the final output token estimate, and per-engine
  counters are produced by
  [open-sse/services/compression/stats.js:92](../../../open-sse/services/compression/stats.js).
  The fork therefore reports compression savings as a percentage plus engine list rather than as a persisted
  count of eliminated tokens.
- Existing local coverage: `tests/unit/compression-chatcore-header.test.js`,
  `tests/unit/compression-header.test.js`, `tests/unit/compression-token-estimate.test.js`.

Disposition: no port required. The upstream column belongs to a table the fork does not have, and the
information the column would carry is already published through the response header and the engine stats.

## #1930 — DeepSeek V4 native cache token extraction

Source change, exact diff `37058ad3d278ba1e22cd4a82370ab10bd5e261c3` → first parent:

- `open-sse/handlers/usageExtractor.ts` — the non-streaming extractor adds a third fallback,
  `?? responseBody.usage.prompt_cache_hit_tokens`, after `prompt_tokens_details.cached_tokens` and
  `input_tokens_details.cached_tokens`. The source comment records that DeepSeek's native API uses the flat
  `prompt_cache_hit_tokens` and not the nested detail object, and that the fallback lets the V4 cache reach
  the call log.
- `open-sse/utils/usageTracking.ts` — the streaming extractor receives the same third fallback.
- `open-sse/handlers/responseTranslator.ts` — a new `firstPositiveNumber` helper makes the non-streaming
  Responses translator read cached tokens from `input_tokens_details.cached_tokens`, then
  `prompt_tokens_details.cached_tokens`, then `cache_read_input_tokens`; cache creation tokens get the same
  three-way fallback, and reasoning tokens get a two-way fallback.
- `src/shared/constants/pricing.ts` — new pricing rows for `deepseek-v4-pro` (input 0.435, output 0.87,
  cached 0.0036, reasoning 0.87, cache creation 0.435) and `deepseek-v4-flash` (input 0.07, output 0.28,
  cached 0.014, reasoning 0.28, cache creation 0.07), annotated as a promotion until 2026-05-31 and then list
  pricing of $0.145 / $3.48.

Local findings:

- **The streaming extractor already reads the flat field.**
  [open-sse/utils/usageTracking.js:465](../../../open-sse/utils/usageTracking.js)
  resolves `cached_tokens` from `prompt_tokens_details?.cached_tokens` **or** `prompt_cache_hit_tokens`, and
  the comment above it names DeepSeek as the reason.
- **The non-streaming extractor does not read it, and this is a confirmed divergence.** The non-streaming
  path is `extractUsageFromResponse`
  ([open-sse/handlers/chatCore/requestDetail.js:26](../../../open-sse/handlers/chatCore/requestDetail.js)),
  called from
  [open-sse/handlers/chatCore/nonStreamingHandler.js:668](../../../open-sse/handlers/chatCore/nonStreamingHandler.js),
  which canonicalizes with `canonicalizeUsage`
  ([open-sse/handlers/chatCore/requestDetail.js:31](../../../open-sse/handlers/chatCore/requestDetail.js)).
  The canonicalizer selects its detail object as
  `usage.prompt_tokens_details ?? usage.input_tokens_details`
  ([open-sse/utils/usageTracking.js:256](../../../open-sse/utils/usageTracking.js))
  and then computes the cache-read count as
  `cached = num(usage.cached_tokens ?? inputDetails?.cached_tokens)`
  ([open-sse/utils/usageTracking.js:280](../../../open-sse/utils/usageTracking.js)).
  There is no `prompt_cache_hit_tokens` term. The offline probe above shows the consequence on an identical
  payload: the streaming extractor reports `cached_tokens: 768`, the non-streaming canonicalizer reports
  `cached_tokens: 0`.
- **The upstream Responses-translator hunk is already covered locally.** The fork's shared usage projection
  reads `raw.input_tokens_details || raw.prompt_tokens_details`
  ([open-sse/translator/concerns/usage.js:125](../../../open-sse/translator/concerns/usage.js))
  and prefers the flat `cache_read_input_tokens` / `cache_creation_input_tokens` when present
  ([open-sse/translator/concerns/usage.js:132](../../../open-sse/translator/concerns/usage.js)).
  The Responses response translator applies the same cache-read sources, checking
  `cache_read_input_tokens`, `cached_tokens`, `input_tokens_details.cached_tokens` and
  `prompt_tokens_details.cached_tokens`
  ([open-sse/translator/response/openai-responses.js:946](../../../open-sse/translator/response/openai-responses.js)).
- **The pricing rows are a catalog divergence, not a mechanism gap.** The fork already prices both models:
  `deepseek-v4-pro` is input 0.435, output 0.87, cached 0.003625, reasoning 0.87, cache creation 0.435, and
  `deepseek-v4-flash` is input 0.14, output 0.28, cached 0.0028, reasoning 0.28, cache creation 0.14
  ([open-sse/providers/pricing.js:300](../../../open-sse/providers/pricing.js),
  [open-sse/providers/pricing.js:301](../../../open-sse/providers/pricing.js)).
  The `deepseek-v4-pro` row matches upstream apart from a rounding difference on the cached rate
  (0.003625 against 0.0036). The `deepseek-v4-flash` row differs from upstream's promoted row on input
  (0.14 against 0.07) and cached (0.0028 against 0.014). Upstream's own comment states that its row is a
  promotion expiring on 2026-05-31 with list pricing of $0.145 / $3.48 afterwards, so the two catalogs
  describe different price points for the same model id. The fork's prices are operator-overridable through
  the pricing store
  ([src/lib/db/repos/pricingRepo.js:99](../../../src/lib/db/repos/pricingRepo.js)),
  so the catalog is not a fixed upstream copy.
- **The divergence is untested locally.** A search for `prompt_cache_hit_tokens` across `tests/` returns no
  hit; `tests/unit/cached-token-usage.test.js` exercises `canonicalizeUsage` and `extractUsage` for the
  Claude, OpenAI and Ollama cache shapes but not for the DeepSeek flat field.

Disposition: narrow existing usage-parser repair only. The non-streaming extractor does not read the flat cache-read field; the Responses-translator hunk is already covered. The dated promotional pricing rows are catalog values and are not ported.

## #2061 — dynamic tool limit detection with proactive truncation

Source change, exact diff `962faa84e9c8dda1e43dc98854a2f48e99a60349` → first parent:

- `open-sse/config/constants.ts` — a new `MAX_TOOLS_LIMIT = 128`, described as the OpenAI default.
- `open-sse/services/toolLimitDetector.ts` — new module. It keeps an in-memory per-provider map of detected
  limits with a 24-hour TTL, defaults to `MAX_TOOLS_LIMIT`, only ever lowers the effective limit, parses a
  limit out of an error body with five patterns, gates detection on HTTP 400 plus one of five indicator
  substrings, and rejects a parsed value that is not a positive integer in the range 1 to 10000.
- `open-sse/handlers/chatCore.ts` — before the request is sent, if the effective limit for the provider is
  below the default and the outgoing body carries more tools, the tool array is truncated to the effective
  limit. After an upstream error, the error body is inspected and a detected limit is recorded.
- `tests/unit/tool-limit-detector.test.ts` — new file covering the default, the cached value, the
  lower-only update, the two positive parse cases, the negative parse case, the detection gate on 400, and
  the refusal to detect on 500 or 429.

Local findings:

- **No provider-scoped tool-limit detection exists here.** A whole-tree search for `toolLimit`,
  `parseToolLimitFromError`, `getEffectiveToolLimit`, `MAX_TOOLS_LIMIT` and `shouldDetectLimit` returns no hit
  in `src/`, `open-sse/` or `tests/`. The fork has no constant for a default tool ceiling and no error-body
  inspection that reads a provider's advertised tool limit.
- **The only tool cap on the request path is provider-specific and fixed.** The Grok CLI executor caps its
  flattened namespace tools at `GROK_CLI_MAX_TOOLS = 200`
  ([open-sse/executors/grok-cli.js:35](../../../open-sse/executors/grok-cli.js))
  and truncates the body at
  [open-sse/executors/grok-cli.js:449](../../../open-sse/executors/grok-cli.js).
  That is one provider, a static ceiling, and it is not error-driven: nothing in the fork learns a limit from
  a rejection.
- **The other tool cap in the tree is not a request cap.**
  `const MAX_TOOLS = 64` inside the provider summary
  ([open-sse/utils/stream.js:247](../../../open-sse/utils/stream.js))
  bounds how many tool calls the summary retains while parsing a stream; it does not alter the outgoing
  request, and it is not derived from any provider limit.
- **The chat path performs no proactive tool truncation.** The request body is assembled and forwarded
  without any ceiling on `body.tools`; the only `tools.slice` in the request path is the Grok CLI one above.
- **No local fixture covers a tool-limit rejection.** There is no test that feeds a tool-limit error body
  through the chat path, and no test asserting a truncated tool array.

Disposition: out of scope. Dynamic upstream tool-limit learning and proactive tool truncation add a new non-provider capability. The fork has no provider-scoped tool-limit detection and no proactive tool truncation on the chat path; the existing Grok CLI static cap and stream-summary retention cap remain distinct mechanisms.

## #2123 — enhance Inworld TTS support

Source change, exact diff `fa524f4ac13eac8f56637af9a35fdce3ac065934` → its first parent (the merge commit
`86db9bcf4768a6fcbd1d25325032c413f7edd40d` carries an empty tree delta):

- `open-sse/config/audioRegistry.ts` — the audio provider config gains a `supportedFormats` field; Inworld
  declares `["mp3", "wav", "opus", "pcm"]` and the Xiaomi MiMo provider declares `["mp3", "wav"]`; the Inworld
  model list replaces `inworld-tts-1.5-max` with `inworld-tts-2`; the OpenAI and Cartesia model lists are
  reordered.
- `open-sse/handlers/audioSpeech.ts` — a new `INWORLD_AUDIO_FORMATS` table maps each accepted
  `response_format` to an Inworld `audioEncoding` and a MIME type. An unsupported format is rejected with
  HTTP 400 and a message naming the accepted set. The response MIME type now prefers the provider's own
  `contentType` when present, falling back to the mapped type.
- `src/app/(dashboard)/dashboard/cache/media/MediaPageClient.tsx` — the per-provider format list is derived
  from the registry's `supportedFormats` instead of a hardcoded map, and the Inworld voice preset list is
  expanded by roughly 120 entries across several locales.
- `open-sse/config/runway.ts` — `veo3` and `gen3a_turbo` are removed from the supported video model list, and
  `gen3a_turbo` is removed from the set of models that require an input image.
- `tests/unit/audio-speech-handler.test.ts` — the Inworld case moves to the new model id and the WAV encoding,
  and new cases assert the registry's declared formats, the Opus mapping, and the rejection of FLAC.

Local findings:

- **The fork has no audio-provider format declaration.** The `supportedFormats` identifier that exists in
  this tree is unrelated: it names model wire formats such as `openai-responses`
  ([open-sse/providers/models/schema.js:55](../../../open-sse/providers/models/schema.js)),
  not audio output formats. No provider registry entry declares an output format set.
- **The Inworld adapter hardcodes one format.**
  [open-sse/handlers/ttsProviders/genericFormats.js:85](../../../open-sse/handlers/ttsProviders/genericFormats.js)
  builds the request with `audioConfig: { audioEncoding: "MP3" }`
  ([genericFormats.js:93](../../../open-sse/handlers/ttsProviders/genericFormats.js))
  and returns `format: "mp3"`
  ([genericFormats.js:99](../../../open-sse/handlers/ttsProviders/genericFormats.js)).
  The core handler does accept a `response_format` and forwards it to the adapter
  ([open-sse/handlers/ttsCore.js:93](../../../open-sse/handlers/ttsCore.js)),
  but the Inworld adapter ignores it. A request for WAV or Opus is therefore not rejected; it silently returns
  MP3 bytes labeled as MP3. There is no 400 for an unsupported format.
- **The Inworld model list differs.** The registry entry lists `inworld-tts-1.5-mini` and
  `inworld-tts-1.5-max`
  ([open-sse/providers/registry/inworld.js:27](../../../open-sse/providers/registry/inworld.js),
  [open-sse/providers/registry/inworld.js:31](../../../open-sse/providers/registry/inworld.js));
  there is no `inworld-tts-2`.
- **Voice resolution differs, and the fork's route is not a smaller capability.** The fork has no hardcoded
  voice preset table. Inworld voices are read from the provider's live voices endpoint through
  [src/app/api/media-providers/tts/inworld/voices/route.js:7](../../../src/app/api/media-providers/tts/inworld/voices/route.js),
  with the adapter's default voice being `Alex`
  ([genericFormats.js:91](../../../open-sse/handlers/ttsProviders/genericFormats.js)).
  The upstream change adds a large static preset list instead, which is a catalog refresh of a different shape
  rather than a boundary change.
- **The Runway hunk concerns a surface the fork does not have.** The fork's Runway entry is an image provider
  whose models are `gen4_image`, `gen4_image_turbo`, `gen4_turbo` and `gen3a_turbo`
  ([open-sse/providers/registry/runwayml.js:31](../../../open-sse/providers/registry/runwayml.js)),
  with `serviceKinds: ["image"]`. The upstream file is a video model allowlist with a different membership
  (`gen4_turbo`, `veo3.1`, `veo3.1_fast` after the change) and a companion image-required model set. The fork
  has no equivalent of `RUNWAYML_IMAGE_REQUIRED_MODELS`, and its Runway adapter is an asynchronous image
  submit-and-poll
  ([open-sse/handlers/imageProviders/runwayml.js:1](../../../open-sse/handlers/imageProviders/runwayml.js)).
- **Existing local coverage.** `tests/unit/native-speech-adapters.test.js` and
  `tests/unit/audio-voices-internal-auth.test.js` cover the local speech adapters and the voice routes.

Disposition: excluded as a provider addition and a provider-catalog refresh. The upstream change introduces a
per-provider audio format declaration, a new Inworld model id and a new upstream video catalog on surfaces
the fork does not have. The one behavior worth noting is that the local Inworld adapter accepts a
`response_format` and then ignores it, which is a catalog-consistency observation for the TTS surface rather
than a boundary this comparison covers.

## Confirmed applicable gap

One narrow existing usage-parser repair is confirmed. No implementation is proposed, started or described as scheduled here.

### Non-streaming extraction of a provider's flat cache-read field

Confirmed applicable. The streaming extractor reads the flat field
([open-sse/utils/usageTracking.js:465](../../../open-sse/utils/usageTracking.js));
the non-streaming canonicalizer does not
([open-sse/utils/usageTracking.js:280](../../../open-sse/utils/usageTracking.js)).
The offline probe above shows the same provider payload yielding a cache-read count of 768 on the streaming
path and 0 on the non-streaming path.

Safe expected behavior:

- The same provider payload must yield the same cache-read count on the streaming and non-streaming paths.
  The flat field is a fallback, not a new precedence level: it applies only when no nested detail object
  supplies a cache-read count.
- Cache-read is a subset of the inclusive prompt count for these providers. Accepting the flat field must not
  change `prompt_tokens` and must not change `total_tokens`; it populates the cache-read component only.
- The fallback must not fire twice. A provider that reports both a nested detail count and the flat field must
  be counted once, using the nested value.
- A missing, zero, negative, non-numeric or non-finite flat field must be ignored rather than coerced.
- The same rule applies to the flat cache-creation field only if a provider reports one; no such field is
  known in this tree today, and the gap is scoped to the cache-read field.
- The behavior must hold for both the JSON response path and the Responses-translated path, so a client sees
  one consistent usage block regardless of which path served the request.


## Evidence collected

- Source PR merged diffs and descriptions: [PR #1840](https://github.com/cheaper-inference/OmniRoute/pull/1840/files),
  [PR #1868](https://github.com/cheaper-inference/OmniRoute/pull/1868/files),
  [PR #1888](https://github.com/cheaper-inference/OmniRoute/pull/1888/files),
  [PR #1899](https://github.com/cheaper-inference/OmniRoute/pull/1899/files),
  [PR #1923](https://github.com/cheaper-inference/OmniRoute/pull/1923/files),
  [PR #1930](https://github.com/cheaper-inference/OmniRoute/pull/1930/files),
  [PR #2061](https://github.com/cheaper-inference/OmniRoute/pull/2061/files),
  [PR #2123](https://github.com/cheaper-inference/OmniRoute/pull/2123/files); commits pinned in the table above.
- Local source: `open-sse/services/compression/deriveDefaultPlan.js`,
  `open-sse/handlers/chatCore.js`, `open-sse/handlers/chatCore/compressionHook.js`,
  `open-sse/handlers/chatCore/requestDetail.js`, `open-sse/handlers/chatCore/nonStreamingHandler.js`,
  `open-sse/utils/stream.js`, `open-sse/utils/usageTracking.js`,
  `open-sse/translator/concerns/usage.js`, `open-sse/translator/response/openai-responses.js`,
  `open-sse/translator/response/openai-responses/historyToolIdentity.js`, `open-sse/providers/pricing.js`,
  `open-sse/providers/registry/nanogpt.js`, `open-sse/providers/registry/inworld.js`,
  `open-sse/providers/registry/runwayml.js`, `open-sse/handlers/imageProviders/index.js`,
  `open-sse/handlers/ttsProviders/genericFormats.js`, `open-sse/handlers/ttsCore.js`,
  `open-sse/executors/codex.js`, `open-sse/executors/grok-cli.js`, `open-sse/services/accountFallback.js`,
  `open-sse/config/errorConfig.js`, `src/sse/handlers/chat.js`, `src/sse/services/auth.js`,
  `src/lib/db/repos/pricingRepo.js`, `src/app/api/media-providers/tts/inworld/voices/route.js`.
- Existing focused fixtures: `tests/unit/compression-chatcore-f1b.test.js`,
  `tests/unit/compression-chatcore-header.test.js`, `tests/unit/compression-header.test.js`,
  `tests/unit/cached-token-usage.test.js`, `tests/unit/account-fallback-request-errors.test.js`,
  `tests/unit/account-fallback-request-scoped-4xx.test.js`, `tests/unit/chat-quota-fallback.test.js`,
  `tests/unit/provider-session-sticky.test.js`, `tests/unit/native-speech-adapters.test.js`,
  `tests/unit/audio-voices-internal-auth.test.js`.
- The one-off offline probe under `/tmp` was executed and removed; no probe file is part of this change. No
  test suite was run for this documentation-only disposition, and no provider traffic was generated.
- Required evidence:
  `test -s internal/docs/port-reports/1073-may-streaming-boundaries.md && rg -q -F 9710a9cd971c10f78d6b0d5c0560acfd626f02ac internal/docs/port-reports/1073-may-streaming-boundaries.md && rg -q -F 148a8bcd1abb0310073422bff794c18647c56dec internal/docs/port-reports/1073-may-streaming-boundaries.md && rg -q -F 3700db2d382e09b3f068e7918d471eecad1e0e97 internal/docs/port-reports/1073-may-streaming-boundaries.md && rg -q -F 8dfe648b7ad256de4aa95fe19d972f26f34f9b39 internal/docs/port-reports/1073-may-streaming-boundaries.md && rg -q -F 4c17c3527c435f57413878b2cea7e7ef045e34f8 internal/docs/port-reports/1073-may-streaming-boundaries.md && rg -q -F bfcb068a5502c57dbaf3b4d31fdf08c0d7ef43c3 internal/docs/port-reports/1073-may-streaming-boundaries.md && rg -q -F abe830101a720dc2f37aabaf092b9564c3ada448 internal/docs/port-reports/1073-may-streaming-boundaries.md && rg -q -F fa524f4ac13eac8f56637af9a35fdce3ac065934 internal/docs/port-reports/1073-may-streaming-boundaries.md`.

Refs #1073
