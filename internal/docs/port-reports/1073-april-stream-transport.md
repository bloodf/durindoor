# #1073 — April 2026 OmniRoute stream transport and upstream request-path changes

Reviewed 2026-11-21 against DurinDoor `f48468be7942784d7d8a68e235beb4690e17731c` on branch
`orq/tornf6/audit-omni-april-stream-transport-a1-l2`. Source: [`cheaper-inference/OmniRoute`](https://github.com/cheaper-inference/OmniRoute).
This is a bounded source-change comparison and a disposition ledger. It produces no owner selection list and no
product implementation.

## Scope and method

Eight merged April 2026 OmniRoute pull requests were compared: #929, #942, #959, #1014, #1036, #1104, #1146 and
#1227. Complete changed-path lists come from `/var/tmp/durindoor-omni-early-metadata.gnjcuh68/2026-04.json`;
every row is `MERGED`, every head and merge SHA is 40-character lowercase hex, and each row's `totalCount` equals
its path list. Metadata was treated as data only.

The exact merged source diff for each pull request was reconstructed from the private source mirror at
`/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git` and **validated against the metadata path list before
any comparison**:

| PR | Head SHA | Merge SHA | Merge shape | Diff base used | Path list vs metadata |
| --- | --- | --- | --- | --- | --- |
| [#929](https://github.com/cheaper-inference/OmniRoute/pull/929) | `df206d9792cb1f5ae9e5e940f8a6302dd4879662` | `88cbd1bd83f00c3e2f868f79042dd181101cac29` | two parents (`27fe556bab8`, head) | merge-base `4b0bcf4464` → head | identical, 2 paths |
| [#942](https://github.com/cheaper-inference/OmniRoute/pull/942) | `0288bc681b247ac20dce67d0e5c887e55336313d` | `da6481f96b843f8e0fc820fc540c4b54995ef9eb` | two parents (`7dea0441ac`, head) | merge-base `86030a0fab` → head | identical, 5 paths |
| [#959](https://github.com/cheaper-inference/OmniRoute/pull/959) | `f7fbe3946d79d264d9a4c26858530f3cecb944c4` | `dd814d159125f16fd2ee81662d5843bfe1e8ef30` | two parents (`1ba9ff8153`, head) | merge-base `08f1f05d58` → head | identical, 4 paths |
| [#1014](https://github.com/cheaper-inference/OmniRoute/pull/1014) | `20a27852f4980d072f59283be9e3272a3f3ba237` | `3d9503658b8ec05161a6f35097940243807dd610` | squash (one parent `5a1ffbc904`) | parent → merge tree | identical, 2 paths |
| [#1036](https://github.com/cheaper-inference/OmniRoute/pull/1036) | `44b54ba09de52902ad719f4447ffa6577851f1ed` | `58c5f7e373acfbfc28d5fce7f6726fcad15738f2` | squash (one parent `47d188541b`) | parent → merge tree | identical, 3 paths |
| [#1104](https://github.com/cheaper-inference/OmniRoute/pull/1104) | `d0efab8222df9e63050f6f90dae91ccd520eba66` | `f8045744b3ec0974eeb0ac3feb0ab039302592af` | squash (one parent `54d908c624`) | parent → merge tree | identical, 6 paths |
| [#1146](https://github.com/cheaper-inference/OmniRoute/pull/1146) | `1e7df542df2e5ed17cb49195ccdeab4b7ec9bf51` | `bd33b53805cc69f90a161383273f921f8b71d3ff` | squash (one parent `1d6739b683`) | parent → merge tree | identical, 6 paths |
| [#1227](https://github.com/cheaper-inference/OmniRoute/pull/1227) | `9b4314ab7dff1c524d4dd99958144907186cd336` | `5acb40cf3e5d5c3a941b181c6b8a8fe10de9083b` | squash (one parent `711812a207`) | parent → merge tree | identical, 3 paths |

The four squash rows need the merge-commit tree as the diff target. Diffing the same rows from the parent to the
recorded *head* SHA instead yields an unrelated 122–860 path change (the PR branch's own history, not the merged
result), which is why the path-list validation above is recorded before any behavioral conclusion.

Local comparison used static source reading of the current tree plus focused offline fixtures. No runtime change,
no provider request, no paid API, no credential access, no browser, no Docker, no e2e run and no whole-suite run
was made. Dependencies were installed locally (`npm install` at the root and in `tests/`) only to execute the
focused offline fixtures; the generated lockfiles and the installed trees were removed again, and the working tree
carries only this report.

Offline fixture evidence, focused run (no full suite). One temporary probe file was written to `tests/unit/`,
executed, and deleted; no probe file is part of this change:

```
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/passthrough-sse-field-only-5441.test.js unit/nonstream-json-contracts-10258.test.js \
  unit/github-claude-messages.test.js unit/resolve-stream-flag.test.js \
  unit/responses-explicit-stream-route.test.js unit/keepalive-error-frame-status.test.js \
  unit/messages-early-stream-keepalive.test.js unit/port-3457-sse-keepalive.test.js
```

Result: **8 files passed, 60 tests passed**. The temporary probe file
(`tests/unit/_probe-1073-april-stream-transport.test.js`, 9 assertions, all passing) characterized the local
behavior quoted below; it was deleted after the run.

## Disposition ledger

| Source PR | Head SHA | Merge SHA | Disposition |
| --- | --- | --- | --- |
| [#929](https://github.com/cheaper-inference/OmniRoute/pull/929) | `df206d9792cb1f5ae9e5e940f8a6302dd4879662` | `88cbd1bd83f00c3e2f868f79042dd181101cac29` | Structural exclusion. The defect class does not exist in this fork: there is no format-conditioned OpenAI-SDK-compat sanitizer to re-key. No port. |
| [#942](https://github.com/cheaper-inference/OmniRoute/pull/942) | `0288bc681b247ac20dce67d0e5c887e55336313d` | `da6481f96b843f8e0fc820fc540c4b54995ef9eb` | Structural exclusion. The entire change lives inside the Claude Code-compatible bridge and the global cache-control policy, neither of which exists here. No port. |
| [#959](https://github.com/cheaper-inference/OmniRoute/pull/959) | `f7fbe3946d79d264d9a4c26858530f3cecb944c4` | `dd814d159125f16fd2ee81662d5843bfe1e8ef30` | Excluded — new feature. An operator-configurable usage-token buffer (env var, DB setting, dashboard field) over a hardcoded local constant. Not a correction to an existing runtime path. |
| [#1014](https://github.com/cheaper-inference/OmniRoute/pull/1014) | `20a27852f4980d072f59283be9e3272a3f3ba237` | `3d9503658b8ec05161a6f35097940243807dd610` | No applicable residual. The upstream defect (an empty-name tool filter discarding built-in Responses tool types) has no local counterpart, because the fork has no empty-name tool filter at all. No port. |
| [#1036](https://github.com/cheaper-inference/OmniRoute/pull/1036) | `44b54ba09de52902ad719f4447ffa6577851f1ed` | `58c5f7e373acfbfc28d5fce7f6726fcad15738f2` | Excluded — new compatibility feature. Non-standard stream aliases are a new accepted request surface, not a correction to an existing path. |
| [#1104](https://github.com/cheaper-inference/OmniRoute/pull/1104) | `d0efab8222df9e63050f6f90dae91ccd520eba66` | `f8045744b3ec0974eeb0ac3feb0ab039302592af` | Mixed. The HTML-error-page detection is an applicable residual (diagnostics on an existing 502 path); the row-count retention caps are a new feature surface with no local counterpart and are excluded. |
| [#1146](https://github.com/cheaper-inference/OmniRoute/pull/1146) | `1e7df542df2e5ed17cb49195ccdeab4b7ec9bf51` | `bd33b53805cc69f90a161383273f921f8b71d3ff` | Mixed, and the source of the one focused port candidate. The passthrough keepalive-block drop is an applicable residual; the recurring mid-stream Responses heartbeat is a separate applicable residual that needs its own decision. |
| [#1227](https://github.com/cheaper-inference/OmniRoute/pull/1227) | `9b4314ab7dff1c524d4dd99958144907186cd336` | `5acb40cf3e5d5c3a941b181c6b8a8fe10de9083b` | Correction to an existing runtime path (GitHub Copilot header forwarding), **not** an auth flow. Applicable residual, but the forwarded value changes upstream billing classification, so it needs an explicit product decision before it can be ported. |

## #929 — sanitize the response by source format, not target format

Source change, exact diff `4b0bcf4464` → `df206d9792`:

- `open-sse/handlers/chatCore.ts` — the post-translation response sanitizer runs when the **source** (client)
  format is OpenAI or OpenAI-Responses, instead of when the **target** (provider) format is.
- `open-sse/utils/stream.ts` — the same re-keying for the per-chunk streaming sanitizer.

The sanitizer strips provider-specific non-standard fields and extracts `<think>` / `<thinking>` tags into
`reasoning_content`. Keying it on the provider's format meant a Claude client talking to an OpenAI-shaped provider
received an OpenAI-shaped sanitization pass, and a non-OpenAI client talking to an OpenAI-shaped provider lost
fields the client expected.

Local findings:

- **The defect class does not exist here.** This fork has no `sanitizeOpenAIResponse` and no
  `sanitizeStreamingChunk`. The response path is a registry-based translator
  ([open-sse/translator/index.js:378](../../../open-sse/translator/index.js))
  plus targeted, purpose-built field strips — Azure content-filter fields
  ([open-sse/utils/stream.js:919](../../../open-sse/utils/stream.js)),
  MiniMax thinking markers ([open-sse/utils/stream.js:956](../../../open-sse/utils/stream.js)),
  and per-format encrypted-content removal
  ([open-sse/translator/formats/responsesApi.js:207](../../../open-sse/translator/formats/responsesApi.js)).
  A whole-tree search of `open-sse/` and `src/` for `sanitizeOpenAIResponse|sanitizeStreamingChunk` returned zero
  hits (probe assertion, passing).
- Nothing in the local response path is keyed on the provider's format in the way the upstream sanitizer was, so
  there is no source/target confusion to correct.

**Disposition:** structural exclusion. The upstream defect cannot reproduce because the construct it corrects is
absent. **No port.**

## #942 — Claude Code-compatible cache markers and cache-control policy

Source change, exact diff `86030a0fab` → `0288bc681b`:

- `open-sse/services/claudeCodeCompatible.ts` — cache-marker strategy rework: a `preserveCacheControl` option
  threads through the request builder, system blocks and message blocks; a new
  `applyClaudeCodeCompatibleToolCacheStrategy` marks the last cacheable tool; `extractCustomSystemBlocks` stamps
  the last custom system block with a 1h TTL; `markLastContentCacheControl` gains a `preserveExisting` mode.
- `open-sse/utils/cacheControlPolicy.ts` — `shouldPreserveCacheControl` returns `false` for any
  `anthropic-compatible-cc-*` target provider, so the bridge uses OmniRoute-managed markers instead of client
  markers.
- `src/app/(dashboard)/dashboard/settings/components/RoutingTab.tsx` — the "Auto" cache-control description text.
- Two upstream test files.

Local findings:

- **The bridge does not exist in this fork.** A whole-tree search across `open-sse/`, `src/`, `tests/` and `docs/`
  for `anthropic-compatible-cc`, `cc-compatible`, `CC_COMPATIBLE` and `claudeCodeCompatible` returned zero hits.
  There is no `open-sse/services/claudeCodeCompatible.ts` and no `open-sse/utils/cacheControlPolicy.ts`.
- **There is no global cache-control policy here.** The fork's `preserveCacheControl` is a per-provider registry
  quirk, not an operator setting with `auto` / `always` / `never` modes
  ([open-sse/translator/index.js:169](../../../open-sse/translator/index.js),
  [open-sse/translator/index.js:283](../../../open-sse/translator/index.js));
  no `alwaysPreserveClientCache` key exists in the settings surface.
- The `RoutingTab.tsx` hunk is dashboard copy for a setting that has no local counterpart.

**Disposition:** structural exclusion. Both the bridge internals and the policy/dashboard surface they extend are
absent, so there is nothing to correct and nothing to carry over. **No port.** (The upstream hunk set is also
new-surface work rather than a correction to an existing runtime path.)

## #959 — configurable usage token buffer

Source change, exact diff `08f1f05d58` → `f7fbe3946d`:

- `open-sse/utils/usageTracking.ts` — the hardcoded `BUFFER_TOKENS = 2000` becomes a runtime value: a 30-second
  TTL cache in front of an env var (`USAGE_TOKEN_BUFFER`) and a DB setting (`usageTokenBuffer`), with
  `invalidateBufferTokensCache()` for write-through invalidation. A buffer of `0` disables the safety margin
  entirely.
- `src/shared/validation/settingsSchemas.ts` — a new `usageTokenBuffer` field (integer, 0–50000).
- `src/app/api/settings/route.ts` — invalidates the runtime cache when the setting is patched.
- `src/app/(dashboard)/dashboard/settings/components/ProxyTab.tsx` — a new dashboard card.

Local findings:

- The local buffer is a hardcoded constant:
  `const BUFFER_TOKENS = 2000;` ([open-sse/utils/usageTracking.js:27](../../../open-sse/utils/usageTracking.js)),
  applied by `addBufferToUsage`
  ([open-sse/utils/usageTracking.js:39](../../../open-sse/utils/usageTracking.js)).
- A whole-tree search of `open-sse/` and `src/` for `USAGE_TOKEN_BUFFER|usageTokenBuffer` returned zero hits
  (probe assertion, passing). No env var, no setting key, no dashboard field, and no cache-invalidation hook
  exists.

**Disposition:** excluded as a **new feature**. The upstream change adds an operator-facing configuration surface
(env var, persisted setting, dashboard control) over a value that is already correct at its default. It is not a
correction to an existing runtime path, and the local constant already produces the same reported usage as the
upstream default. **No port** — this would be a product-surface addition, not a fix.

## #1014 — preserve built-in Responses API tool types

Source change, exact diff `5a1ffbc904` → `3d9503658b`:

- `open-sse/handlers/chatCore.ts` — the empty-name tool filter gains an early return: a tool whose `type` is set,
  is not `function`, carries no `function` object and has no `name` is preserved. Built-in Responses tool types
  (`web_search`, `file_search`, `computer`, `code_interpreter`, `image_generation`) are identified solely by `type`
  and carry no name, so the filter was discarding them and upstream providers answered
  `400 Invalid 'tools[0].name': empty string`.
- `tests/unit/tools-filter-anthropic-format.test.mjs` — regression coverage.

Local findings:

- **The fork has no empty-name tool filter.** `open-sse/handlers/chatCore.js` never filters `body.tools` by tool
  name; the only `tools` filters in the request path are the Codex additional-tools envelope strip
  ([open-sse/handlers/chatCore.js:734](../../../open-sse/handlers/chatCore.js)),
  tool dedupe ([open-sse/handlers/chatCore.js:843](../../../open-sse/handlers/chatCore.js))
  and schema normalization ([open-sse/handlers/chatCore.js:850](../../../open-sse/handlers/chatCore.js)).
  A whole-tree search found no `Invalid 'tools` guard and no empty-name tool filter.
- **The fork already preserves typed server tools.** The transport resolver treats a tool whose `type` is not
  `function` / `custom` / `tool` as a native server tool and keeps the request on the Responses transport
  ([open-sse/handlers/chatCore.js:173](../../../open-sse/handlers/chatCore.js)),
  and the Responses request builder maps tool entries through `convertChatAllowedToolEntry`
  ([open-sse/translator/request/openai-responses.js:196](../../../open-sse/translator/request/openai-responses.js),
  [open-sse/translator/request/openai-responses.js:245](../../../open-sse/translator/request/openai-responses.js)).

**Disposition:** no applicable residual. The upstream defect has no local counterpart because the discarding filter
does not exist here, and the local transport selection and request builder already keep typed server tools.
**No port** — porting the upstream hunk would add a filter the fork does not need.

## #1036 — explicit stream aliases

Source change, exact diff `47d188541b` → `58c5f7e373`:

- `open-sse/utils/aiSdkCompat.ts` — new `resolveExplicitStreamAlias(body)` (returning `true` / `false` /
  `undefined`) and `hasExplicitNoStreamParam(body)`.
- `open-sse/handlers/chatCore.ts` — the resolved alias is written onto `body.stream` before provider translation,
  and the non-standard keys `non_stream`, `disable_stream`, `disable_streaming` and `streaming` are removed from
  the body so they never reach a provider.
- `tests/unit/t26-ai-sdk-accept-header-compat.test.mjs` — regression coverage.

Local findings:

- The local streaming decision reads only the standard `stream` key. `resolveStreamFlag` takes an options object
  and derives the decision from `bodyStream === true`
  ([open-sse/handlers/chatCore/streamFlag.js:22](../../../open-sse/handlers/chatCore/streamFlag.js),
  [open-sse/handlers/chatCore/streamFlag.js:29](../../../open-sse/handlers/chatCore/streamFlag.js));
  the chat core derives client streaming intent from `body.stream === true`
  ([open-sse/handlers/chatCore.js:535](../../../open-sse/handlers/chatCore.js));
  and the Responses handler reads `convertedBody.stream === true`
  ([open-sse/handlers/responsesHandler.js:65](../../../open-sse/handlers/responsesHandler.js)).
- A whole-tree search of `open-sse/` and `src/` for `non_stream`, `disable_stream` and `disable_streaming` returned
  zero hits (probe assertion, passing). There is no alias support and no alias-stripping step.
- The resulting behavior difference is narrow and one-directional: a client that sends `{"streaming": true}` and
  omits `stream` is served a **non-streaming** response locally, whereas upstream would stream. A client that
  sends `{"streaming": false}` is served non-streaming either way.

**Disposition:** excluded as a **new compatibility feature**. Accepting non-standard request keys at the API
boundary is an added request surface, not a correction to an existing runtime path; there is no local behavior
that is wrong, only one that upstream extends. Porting it would also require an explicit decision about alias
precedence (upstream's alias overrides an explicit `stream` value) and about which keys are stripped before
provider translation. **No port.**

## #1104 — HTML error responses and row-count retention limits

Source change, exact diff `54d908c624` → `f8045744b3`:

- `open-sse/handlers/chatCore.ts` — when the provider body fails to parse, the change sniffs the raw body for an
  HTML error page (`/^\s*(?:\s|<!|<[a-zA-Z]|<\?xml)/`). An HTML body yields the message "Provider returned HTML
  error page instead of JSON - check credentials and endpoint" instead of the generic "Invalid JSON response from
  provider", persists only the first 500 raw characters as the provider response, and records the failure reason
  `html_error_response` instead of `invalid_json_payload`.
- `src/lib/logEnv.ts` — new `CALL_LOGS_TABLE_MAX_ROWS` / `PROXY_LOGS_TABLE_MAX_ROWS` accessors, default 100000.
- `src/lib/compliance/index.ts` — `cleanupExpiredLogs` additionally trims `call_logs` and `proxy_logs` down to the
  configured row caps in 5000-row batches, oldest first, and reports `trimmedCallLogs` / `trimmedProxyLogs`.
- `src/app/api/storage/health/route.ts` and `SystemStorageTab.tsx` — surface the caps.
- `tests/unit/log-retention.test.mjs` — regression coverage.

Local findings, part (a) — HTML error-page detection:

- The local non-streaming path returns the generic message for every unparseable body:
  [open-sse/handlers/chatCore/nonStreamingHandler.js:590](../../../open-sse/handlers/chatCore/nonStreamingHandler.js),
  [open-sse/handlers/chatCore/nonStreamingHandler.js:595](../../../open-sse/handlers/chatCore/nonStreamingHandler.js),
  [open-sse/handlers/chatCore/nonStreamingHandler.js:609](../../../open-sse/handlers/chatCore/nonStreamingHandler.js).
- Probe result: a provider body of `<!DOCTYPE html><html><body>502 Bad Gateway</body></html>` returns
  `{"status":502,"error":"Invalid JSON response from galadriel"}` — no HTML hint, and the caller cannot tell a
  captive-portal / proxy interception page from a genuine malformed-JSON response. There is no HTML sniffing and
  no `html_error_response` reason in the local failure taxonomy.
- The existing local fixture `tests/unit/nonstream-json-contracts-10258.test.js` pins the generic message as the
  current contract, and it passes unchanged.

Local findings, part (b) — row-count retention caps:

- The fork has no `src/lib/logEnv`, no `src/lib/compliance/index`, no `src/app/api/storage/health` route and no
  `SystemStorageTab` component (all verified absent). There is no `CALL_LOGS_TABLE_MAX_ROWS`,
  `PROXY_LOGS_TABLE_MAX_ROWS` or `tableMaxRows` anywhere in the tree.
- Local retention is **age-based only**: `runDataRetention({ days, now, trigger })`
  ([src/lib/dataRetention/runner.js:46](../../../src/lib/dataRetention/runner.js))
  prunes usage history, request details, proxy-timeline traces and provider quota snapshots by age, driven by
  `src/lib/dataRetention/scheduler.js`. There is no row-count ceiling and no storage-health surface to extend.

**Disposition:** mixed.
Part (b) is **excluded as a new feature** — a row-count cap on log tables plus two new env vars, a new compliance
implementation and a new storage-health dashboard surface, against a retention model that is structured differently
here. **No port.**
Part (a) is an **applicable residual**: it is a correction to an existing runtime path (the 502 on an unparseable
provider body), it changes only the diagnostic message and the recorded failure reason, and it touches no provider
protocol, header, auth or credential behavior. It is recorded below as a secondary residual, deliberately not the
nominated port, because it is diagnostic-only and therefore lower impact than the nominated candidate.

## #1146 — Responses SSE keepalives and passthrough keepalive blocks

Source change, exact diff `1d6739b683` → `bd33b53805`:

- `open-sse/utils/sseHeartbeat.ts` (new) — `createSseHeartbeatTransform({ intervalMs = 15000, signal })` emits an
  SSE comment frame `: keepalive <ISO timestamp>\n\n` every 15 seconds while the stream is open. The interval is
  cleared on `flush()`, on abort (via `signal`), and on an enqueue failure, and the timer is `unref`'d so it
  cannot hold the process open.
- `open-sse/handlers/responsesHandler.ts` — `handleResponsesCore` gains a `signal` option and pipes the Responses
  body through the heartbeat transform after the Responses transform
  (`response.body.pipeThrough(transformStream).pipeThrough(createSseHeartbeatTransform({ signal }))`).
- `open-sse/utils/stream.ts` — in the passthrough path, a whole `event: keepalive` block is dropped instead of
  being relayed: the block's payload is skipped and the next data line is not paired with it. Upstream's stated
  reason: "Drop whole keepalive event blocks — strict OpenAI-compatible SDKs try to JSON.parse empty keepalive
  payloads and crash."
- Three upstream test files.

Local findings, part (a) — recurring mid-stream heartbeat:

- The local Responses handler has exactly one transform on the body and no heartbeat:
  `const transformedBody = response.body.pipeThrough(transformStream);`
  ([open-sse/handlers/responsesHandler.js:132](../../../open-sse/handlers/responsesHandler.js)).
  Probe result: the file contains exactly one `.pipeThrough(` call and no `keepalive` or `heartbeat` token at all.
- The local fork's keepalive is **pre-first-byte only**. `withEarlyStreamKeepalive` holds the response open and
  emits `: keepalive\n\n`
  ([open-sse/utils/earlyStreamKeepalive.js:23](../../../open-sse/utils/earlyStreamKeepalive.js),
  [open-sse/utils/earlyStreamKeepalive.js:166](../../../open-sse/utils/earlyStreamKeepalive.js))
  only while the handler promise is still pending, wired at the route level
  ([src/app/api/v1/responses/route.js:39](../../../src/app/api/v1/responses/route.js)).
  Once the upstream response starts flowing, no further keepalive is emitted, so a long reasoning turn can still
  leave the connection idle.

Local findings, part (b) — passthrough keepalive blocks:

- The passthrough path has two separate behaviors. `filterEmptyOpenAIFrames`
  ([open-sse/utils/stream.js:182](../../../open-sse/utils/stream.js))
  holds field-only frames for the **OpenAI** target only; `responsesPassthrough`
  ([open-sse/utils/stream.js:188](../../../open-sse/utils/stream.js))
  is the **Responses** path and has no field-only-frame filter at all.
- **Probe result — the defect reproduces in both passthrough formats.** Feeding a source stream that contains
  `event: keepalive\ndata:\n\n` followed by a real delta produces, verbatim on the client wire:
  - Responses passthrough: `event: keepalive\ndata: \n\ndata: {"type":"response.output_text.delta","delta":"Hello"}\n\ndata: [DONE]\n\n…`
  - OpenAI passthrough: `event: keepalive\ndata: \n\ndata: {"choices":[{"index":0,"delta":{"content":"Hello"},…}]…}\n\ndata: [DONE]\n\n`
- The reason the existing OpenAI filter does not catch it: the frame is released because the empty `data:` line
  still counts as a data line (`sseFrameHasData = true`), so the held `event: keepalive` label is flushed in front
  of it. The local #5441 work dropped `event: ping` frames that carry **no** data line at all
  (`tests/unit/passthrough-sse-field-only-5441.test.js`, passing), but not a keepalive block whose only data line
  is empty — and the Responses passthrough path has no filter to begin with.
- The consequence is a client-visible one: the client receives an `event: keepalive` label followed by a `data:`
  line with an empty payload. That is precisely the shape upstream #1146 drops.

**Disposition:** mixed.
Part (a) is an applicable residual but a **behavioral addition on a hot path**: it introduces a recurring timer
into the Responses stream, requires an `AbortSignal` to be threaded through `handleResponsesCore` so the timer is
always cleared, and changes on-the-wire timing for every streaming Responses request. It needs its own decision
and its own port; it is not folded into the nominated port below.
Part (b) is an applicable residual that is **narrow, deterministic and free of provider, header, auth and
credential surface**, and it is the one focused port candidate recorded in this report.

## #1227 — forward the client `x-initiator` header to GitHub Copilot

Source change, exact diff `711812a207` → `5acb40cf3e5d5c3a941b181c6b8a8fe10de9083b`:

- `open-sse/executors/base.ts` — `ExecuteInput` gains `clientHeaders`, documented as "Original client request
  headers (read-only). Executors may forward select headers upstream."
- `open-sse/executors/github.ts` — the executor stashes the per-request client headers and, in `buildHeaders`,
  sends `X-Initiator: agent` or `X-Initiator: user` instead of the hardcoded `user`. The value is taken from the
  client's `x-initiator` header and is accepted only when it is exactly `agent` or `user`; anything else (or an
  absent header) falls back to `user`, preserving the existing default. Upstream's stated reason: OpenCode and
  other Copilot-aware clients use this to distinguish user-initiated turns from autonomous tool-call
  continuations, and GitHub Copilot's billing treats "agent" turns as free.
- `open-sse/handlers/chatCore.ts` — passes `clientHeaders: clientRawRequest?.headers ?? null` into the executor
  call, including the retry and fallback paths.

Local findings:

- **This is not an auth flow.** The diff contains no credential, token, refresh or OAuth change; it forwards a
  client request header to an already-authenticated upstream. The April ledger row in
  `internal/docs/port-reports/1073-april-recovered-1-dispositions.md` labels this pull request "Provider Sign-in
  scope"; that label is too broad for this diff and is corrected here.
- The local GitHub Copilot executor hardcodes the initiator and cannot see client headers at all:
  `buildHeaders(credentials, stream = true)`
  ([open-sse/executors/github.js:65](../../../open-sse/executors/github.js))
  and `"X-Initiator": "user"`
  ([open-sse/executors/github.js:78](../../../open-sse/executors/github.js)).
  Probe result: `buildHeaders` returns `X-Initiator: "user"` for every call, and the extracted signature is
  `buildHeaders(credentials, stream = true)` — no `requestContext` parameter, so no client header can reach it.
- **The local fork already has the exact idiom the upstream change introduces.** The fork contract is
  `buildHeaders(credentials, stream, requestContext, model)`
  ([open-sse/executors/base.js:419](../../../open-sse/executors/base.js),
  [open-sse/executors/base.js:428](../../../open-sse/executors/base.js)),
  `requestContext.clientHeaders` is already consumed by the Codex, OpenCode, Kiro, default and chatgpt-web
  executors, and the chat core already freezes the inbound headers
  ([open-sse/handlers/chatCore.js:248](../../../open-sse/handlers/chatCore.js)).
  The GitHub executor already reads `requestContext?.clientHeaders` on its Claude path
  ([open-sse/executors/github.js:340](../../../open-sse/executors/github.js)),
  so only the header-building path is missing.

**Disposition:** applicable residual — a correction to an existing runtime path, scoped to one file. It is **not**
the nominated port because the forwarded value changes upstream **billing classification** (upstream's own
rationale is that "agent" turns are not charged as premium requests). That is an operator-facing policy decision
rather than a defect fix, and it must be settled explicitly before any port. Port-ready shape: extend the
executor's `buildHeaders` to accept
`requestContext` per the fork contract, read `requestContext.clientHeaders["x-initiator"]`, accept only the exact
values `agent` and `user`, and fall back to `user` otherwise — no change to the Authorization header, the Copilot
token, the URL selection or the stream/materialization logic.

## Applicable residuals and the one focused port candidate

Three residuals are applicable. One is nominated as the focused port; the other two are recorded with their
scope and their blocking decision so they can be prepared independently.

| Residual | Source PR | Local surface | State |
| --- | --- | --- | --- |
| Drop `event: keepalive` blocks in the passthrough stream path | #1146 (b) | `open-sse/utils/stream.js` | **Nominated focused port** |
| Recurring mid-stream SSE heartbeat on the Responses route | #1146 (a) | `open-sse/handlers/responsesHandler.js` | Applicable; needs its own decision (timer on a hot path, abort wiring, wire-timing change) |
| HTML provider error page distinguished in the 502 path | #1104 (a) | `open-sse/handlers/chatCore/nonStreamingHandler.js` | Applicable; diagnostic-only, lower impact |
| Forward the client `x-initiator` header to GitHub Copilot | #1227 | `open-sse/executors/github.js` | Applicable; blocked on an explicit billing-classification decision |

### Focused port candidate — drop `event: keepalive` blocks in the passthrough stream path

**Current behavior (today), reproduced offline.** When an upstream provider emits an `event: keepalive` block
whose only payload line is an empty `data:` line, the local gateway relays the block to the client verbatim, in
both passthrough formats:

```
event: keepalive
data:

data: {"type":"response.output_text.delta","delta":"Hello"}
```

The OpenAI passthrough form is the same shape with an OpenAI chunk in place of the Responses delta. The block
reaches the client because (i) the Responses passthrough path has no field-only-frame filter at all, and (ii) on
the OpenAI path the empty `data:` line is treated as a data line, so the held `event:` label is released in front
of it instead of being held back.

**Expected behavior after the port.** The whole keepalive block is dropped, exactly as upstream #1146 does. The
surrounding frames — the Responses `response.output_text.delta` event, the terminal `response.completed` event,
the `data: [DONE]` sentinel, and any failure frame — are unchanged. A keepalive block must not consume, pair
with, or displace the payload that follows it.

**Scope.** `open-sse/utils/stream.js` only. The change belongs in the passthrough framing path alongside the
existing `filterEmptyOpenAIFrames` / `responsesPassthrough` handling, and it must apply to both passthrough
formats, not only to the OpenAI one.

**Boundaries that must hold.**

- No provider protocol, URL, header, auth or credential behavior may change.
- The Anthropic `event: ping` frame with its `{"type":"ping"}` payload and the `: keepalive` SSE comment frame
  must keep flowing — only a `keepalive` **event block with an empty payload** is in scope.
- The `data: [DONE]` sentinel, the terminal frames and the failure frames must be byte-for-byte unchanged.
- The existing field-only-frame contract from #5441 must stay intact: a field-only frame with no data line is
  still dropped for the OpenAI target.

**Offline verification.** A focused fixture in `tests/unit/` that feeds `event: keepalive\ndata:\n\n` followed by a
real delta and a `[DONE]` sentinel through `createSSEStream({ mode: "passthrough" })` for both
`FORMATS.OPENAI` and `FORMATS.OPENAI_RESPONSES`, asserting that the output contains no `event: keepalive` and no
empty `data:` line, while the delta payload and the `[DONE]` sentinel are present. The sibling fixtures
`tests/unit/passthrough-sse-field-only-5441.test.js`, `tests/unit/port-3457-sse-keepalive.test.js`,
`tests/unit/messages-early-stream-keepalive.test.js` and `tests/unit/keepalive-error-frame-status.test.js` must
keep passing unchanged.

**Status.** This is a port candidate with its expected behavior and scope stated; no runtime code was modified by
this comparison unit.

## Exclusions and scope boundaries

- **No new providers or integrations.** None of the eight pull requests adds a provider, provider mode, MCP tool
  shape or third-party integration. #1227 touches an existing provider's header path and adds no provider.
- **No auth flows.** #1227 is header forwarding on an already-authenticated upstream; it contains no credential,
  token or OAuth change. #942's cache-marker work sits inside the Claude Code-compatible bridge and carries no
  credential change, but the bridge does not exist in this fork.
- **New features left open.** #959 (configurable usage-token buffer), #1036 (non-standard stream aliases),
  #1104 part (b) (row-count retention caps plus storage-health surface) and #942's cache-control policy and
  dashboard copy are feature additions rather than corrections to existing runtime paths, and are excluded on that
  basis.
- **Provider Sign-in left open.** No OAuth, sign-in, credential or token-refresh work was dispositioned here.
- **No owner selection list** was produced, and no implementation, runtime change or product decision is made by
  this report.

## Verification limits

This review establishes the exact merged source diff of the eight named pull requests (each validated against the
metadata path list), the current local runtime behavior of the compared surfaces, and the focused offline fixture
results quoted above. It does not re-audit the rest of the April 2026 OmniRoute window, does not classify any
other merged record, and does not claim that the remaining April records are unported or safe.

Two limits are worth recording. First, the local behavior of the keepalive and HTML-error paths was characterized
with offline fixtures that drive the production functions directly; no request was sent to any provider, so the
upstream provider behaviors that emit `event: keepalive` blocks or HTML error pages are inferred from the source
diff and the local reproduction, not observed live. Second, the upstream diffs are TypeScript and the local tree is
JavaScript with a different module layout, so every comparison was made on behavior and call sites rather than by
line-for-line correspondence.

The open port candidate (#1146's passthrough keepalive-block drop) is stated with its expected behavior and scope;
no code was modified by this review.

Refs #1073
