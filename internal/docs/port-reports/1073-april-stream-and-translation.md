# #1073 — April 2026 OmniRoute stream and translation source changes

Reviewed 2026-11-21 against DurinDoor `454e1359220c6a8b2cd9a43c0f82758f29340cd3` on branch
`orq/tornf6/audit-omni-april-stream-and-translation-a1-l2`. Source: [`cheaper-inference/OmniRoute`](https://github.com/cheaper-inference/OmniRoute).
This is a bounded source-change comparison and a disposition ledger. It produces no owner selection list.

Gate: Heitor's orq gate supersedes the older HOLD and the independent gate-receipt rules for this unit;
work ships continuously instead of waiting on a separate approval step.

## Scope and method

Six merged April 2026 OmniRoute pull requests were compared. Complete changed-path lists come from the
April 2026 OmniRoute pull-request metadata capture (`2026-04.json`); every row is `MERGED`, every head and
merge SHA is 40-character lowercase hex, and each row's `totalCount` equals its path list. Metadata was
treated as data only.

The exact merged source diff for each pull request was reconstructed from the upstream Git history and
**validated against the metadata path list before any comparison**:

| PR | Head SHA | Merge SHA | Merge shape | Diff base used | Path list vs metadata |
| --- | --- | --- | --- | --- | --- |
| [#937](https://github.com/cheaper-inference/OmniRoute/pull/937) | `bcc374eb312200c2c37f35b74ef4b2a281872a90` | `954c40067e7cb31857dfba1e9fbc1c8b6bb43977` | two parents (`6a36606bd5`, head) | merge-base `9a681a27ad` → head | identical, 10 paths |
| [#975](https://github.com/cheaper-inference/OmniRoute/pull/975) | `231ca8a935d08ecef9f258928eebc1bc6e1fc83c` | `c62145af312943d711992326d2798c50495ad34f` | two parents (head, `9148dc9e03`) | branch base `c96221c70` → head | identical, 9 paths |
| [#1135](https://github.com/cheaper-inference/OmniRoute/pull/1135) | `85fe52bf8c091d262e786e02baaf110b6a7ccb58` | `1d6739b6833b8f8f4c3f02c0ba2ef1b6227fca1d` | squash (one parent `e75baed4b6`) | merge-base `515674b6cf` → head | identical, 12 paths |
| [#1230](https://github.com/cheaper-inference/OmniRoute/pull/1230) | `c3cabbcc8081438997a5b0e6884ec528399d0091` | `ff183f8135275248bc771549bc5f3e2ed16badb7` | squash (one parent `b6e8597ef8`) | merge-base `eaec3279ab` → head | identical, 7 paths |
| [#1257](https://github.com/cheaper-inference/OmniRoute/pull/1257) | `05453b972be8083ffb824dfa78d71fbb568c669f` | `a17b7234fe8d2faa95cb84bd4a2eef3e116329c6` | squash (one parent `da9af4af59`) | merge-base `da9af4af59` → head | identical, 12 paths |
| [#1292](https://github.com/cheaper-inference/OmniRoute/pull/1292) | `b73d2359e263db3ae6b9fc0ffe937d78aeef835f` | `16e6fd878614efca9ec7ae6e5d442ec182b95e1b` | two parents (head, `8b21c7b19f`) | head parent `eaec3279a` → head | identical, 2 paths |

Local comparison used static source reading of the current tree plus focused offline fixtures. No runtime
change, no provider request, no paid API, no browser, no Docker, no e2e run and no full-suite run was made.
Dependencies were installed locally (`npm install` at the root and in `tests/`) only to execute the focused
offline fixtures; the generated lockfiles were removed again and the tree carries only this report.

Local file citations are repository-relative links into this tree, with the line anchor carrying the
observed line number. The single citation whose path contains parentheses uses a pinned public repository
link, because a Markdown link destination cannot carry that path shape.

Offline fixture evidence, focused run (no full suite):

```
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/github-claude-messages.test.js unit/github-responses-streaming.test.js \
  unit/adaptive-budget-chatcore.test.js unit/compression-chatcore-f1b.test.js \
  unit/compression-token-estimate.test.js unit/combo-timeout.test.js \
  unit/stream-first-chunk-timeout.test.js unit/body-timeout.test.js
```

Result: **8 files passed, 68 tests passed**. Three additional one-off probes (written to
`tests/unit/`, executed, then deleted; no probe file is part of this change) confirmed the GitHub streaming
error-body property, the non-SSE body behavior and the response-start timeout property described below.

## Disposition ledger

| Source PR | Head SHA | Merge SHA | Disposition |
| --- | --- | --- | --- |
| [#937](https://github.com/cheaper-inference/OmniRoute/pull/937) | `bcc374eb312200c2c37f35b74ef4b2a281872a90` | `954c40067e7cb31857dfba1e9fbc1c8b6bb43977` | Mixed. Claude Code-compatible bridge, catalog and OAuth paths are structurally absent or out of scope. The GitHub executor path is already safe for the defect the source fixed; one narrow residual difference remains and is the only candidate in this report for a small isolated port. |
| [#975](https://github.com/cheaper-inference/OmniRoute/pull/975) | `231ca8a935d08ecef9f258928eebc1bc6e1fc83c` | `c62145af312943d711992326d2798c50495ad34f` | Excluded. The entire change is a new per-connection custom `User-Agent` feature (runtime, validation probe, dashboard UI). |
| [#1135](https://github.com/cheaper-inference/OmniRoute/pull/1135) | `85fe52bf8c091d262e786e02baaf110b6a7ccb58` | `1d6739b6833b8f8f4c3f02c0ba2ef1b6227fca1d` | Excluded. Semantic cache toggle plus cache-management redesign are new surfaces with no local counterpart; the `chatCore` settings-read consolidation has no local counterpart either. |
| [#1230](https://github.com/cheaper-inference/OmniRoute/pull/1230) | `c3cabbcc8081438997a5b0e6884ec528399d0091` | `ff183f8135275248bc771549bc5f3e2ed16badb7` | Structural exclusion. Every hunk belongs to the Claude Code-compatible bridge, which does not exist in this fork. |
| [#1257](https://github.com/cheaper-inference/OmniRoute/pull/1257) | `05453b972be8083ffb824dfa78d71fbb568c669f` | `a17b7234fe8d2faa95cb84bd4a2eef3e116329c6` | Already covered for the runtime behavior that matters locally (response-start timeout); the remaining hunks are bridge-specific or target caps this fork does not have. |
| [#1292](https://github.com/cheaper-inference/OmniRoute/pull/1292) | `b73d2359e263db3ae6b9fc0ffe937d78aeef835f` | `16e6fd878614efca9ec7ae6e5d442ec182b95e1b` | No isolated port required. The fork already owns a context-budget-aware compression seam at the same pipeline position; the only difference is that the source made the trigger unconditional while the fork's equivalent is operator-gated. |

## #937 — GitHub executor stream guard, Claude Code-compatible bridge, catalog and OAuth

Source change, exact diff `9a681a27ad` → `bcc374eb3`:

- `open-sse/executors/github.ts` — the SSE response transform is applied only when the upstream response is
  `ok` **and** its content type contains `text/event-stream`; the response is cloned first so the original
  body stays readable for downstream error handling.
- `open-sse/services/claudeCodeCompatible.ts` — large rewrite of the Claude Code-compatible request builder
  (Claude-native body preparation, `preserveCacheControl`, per-message cache strategy).
- `open-sse/handlers/chatCore.ts` — passes `claudeBody` and `preserveCacheControl` into that builder.
- `src/app/api/v1/models/catalog.ts`, `src/shared/components/ModelSelectModal.tsx` — expose
  Claude Code-compatible fallback models under the provider node prefix.
- `src/lib/oauth/providers/claude.ts` — the OAuth provider uses the runtime `redirectUri` instead of the
  static config value.

Local findings:

- **Bridge paths are structurally absent.** The fork has no Claude Code-compatible provider mode: the tree
  contains no `anthropic-compatible-cc-*` handling, no `claudeCodeCompatible` module, no
  `CLAUDE_CODE_COMPATIBLE_PREFIX`, and no `ENABLE_CC_COMPATIBLE_PROVIDER` flag (whole-tree search, zero
  hits). The fork does support generic `anthropic-compatible-*` nodes
  ([open-sse/executors/base.js:215](../../../open-sse/executors/base.js),
  [open-sse/executors/default.js:26](../../../open-sse/executors/default.js)),
  but that is a different provider surface, not the bridge the source edits.
- **The upstream defect does not reproduce locally.** The source's own regression test asserts that a
  streaming `401` response keeps its status and a readable body. Locally the GitHub Claude route returns
  the upstream response untouched when it is not `ok`
  ([open-sse/executors/github.js:547](../../../open-sse/executors/github.js)),
  the `/responses` route does the same
  ([open-sse/executors/github.js:730](../../../open-sse/executors/github.js)),
  and the generic executor only clones the body for an optional bounded probe, so the original body stays
  intact ([open-sse/executors/base.js:579](../../../open-sse/executors/base.js)).
  Probe result: a `401 text/plain` streaming response comes back with status `401` and the exact body text.
  The `ok` half of the upstream guard is therefore already satisfied.
- **One narrow residual difference remains.** The fork has no content-type precondition on the SSE
  transform, so an `ok` response whose content type is not `text/event-stream` is still piped through the
  Claude SSE translator ([open-sse/executors/github.js:688](../../../open-sse/executors/github.js),
  [open-sse/executors/github.js:819](../../../open-sse/executors/github.js)).
  Probe result: a `200 application/json` body `{"error":{"message":"boom"}}` is converted into
  `data: {"error":{"message":"GitHub Messages stream failed","type":"stream_error"}}`; the upstream body is
  lost. The source would have passed it through untouched. This is the only applicable local difference in
  this report that still warrants a small isolated port.
- The catalog and model-selector hunks add Claude Code-compatible fallback models only; with no bridge
  provider there is nothing to expose.
- The OAuth hunk is authentication work and is left to Provider Sign-in.

**Disposition:** the bridge, catalog and OAuth portions are structural exclusions or out of scope. The
GitHub executor portion is already correct for the behavior the source fixed. **A small isolated port is
still needed for one thing:** add a content-type precondition before the SSE transform on the GitHub
Claude `/v1/messages` and `/responses` routes, so an `ok` non-SSE response is returned unchanged instead of
being rewritten into a `stream_error` frame. Scope must stay inside
`open-sse/executors/github.js`; no provider protocol, header or auth behavior may change, and the existing
error-body and stream-validation contracts must stay intact.

**Expected existing behavior (today):** a non-`ok` GitHub response is returned with its original status and
body, readable by the caller; an `ok` SSE response is translated and validated as today (a truncated or
contradicted stream still emits a failure frame instead of a success terminal, and the finish frame is still
held until end of stream). Offline evidence: `unit/github-claude-messages.test.js` and
`unit/github-responses-streaming.test.js` pass unchanged (part of the 8-file / 68-test focused run).

## #975 — per-connection custom `User-Agent`

Source change, exact diff `c96221c70` → `231ca8a93`: a new per-connection `customUserAgent` field stored in
`providerSpecificData`, applied to upstream requests (`open-sse/executors/base.ts`,
`open-sse/handlers/chatCore.ts`), to provider validation probes
(`src/lib/providers/validation.ts`, `src/app/api/providers/validate/route.ts`), validated to 500 characters
in `src/shared/validation/schemas.ts`, and editable from the provider dashboard
(`src/app/(dashboard)/dashboard/providers/[id]/page.tsx`). The only non-cosmetic edit outside that feature is
a behavior-preserving rewrite of the `baseUrl` super-refine condition.

Local findings: the fork has no general per-connection `User-Agent` override for API-key providers. The only
`customUserAgent` in the tree is a ChatGPT-web browser-fingerprint field, consumed by
[open-sse/utils/chatgptWebExecutorAdapter.js:444](../../../open-sse/utils/chatgptWebExecutorAdapter.js);
it is a provider-specific browser identity, not a request-header override.

**Disposition:** excluded. This is a new feature with a new persisted field, a new validation path and new
dashboard UI; it is out of the scope of this comparison and is not an eligible port.

**Expected existing behavior (today):** upstream `User-Agent` comes from the executor/provider configuration
and environment overrides; a connection cannot currently override it per request.

## #1135 — semantic cache toggle and cache-management redesign

Source change, exact diff `515674b6cf` → `85fe52bf8`: a new `semanticCacheEnabled` runtime switch that gates
the semantic-cache lookup and store in `open-sse/handlers/chatCore.ts`, a cache-settings read consolidated
through `getCachedSettings()`, a redesigned cache dashboard page, cache-metrics SQL rewritten to report
`totalRequests` / `cachedRequests` / `tokensSaved`, `clearCache()` returning the removed-row count, an
`/api/cache` route contract change, and an MCP `cache_stats` output extension.

Local findings: the fork has no semantic cache. There is no `src/lib/semanticCache.js`, no `/api/cache`
route, no `getCacheMetrics` provider cache-metric query, no `idempotencyLayer`, and no
`alwaysPreserveClientCache` setting anywhere in `src/` or `open-sse/`. The fork's cache-control handling is
provider-scoped instead: `preserveCacheControl` is a per-provider registry quirk applied by the translators
([open-sse/translator/index.js:169](../../../open-sse/translator/index.js),
[open-sse/translator/index.js:283](../../../open-sse/translator/index.js)),
and Claude-native cache breakpoints are re-anchored on the final body
([open-sse/handlers/chatCore.js:1054](../../../open-sse/handlers/chatCore.js)).

**Disposition:** excluded. The semantic cache, its toggle, the cache dashboard and the MCP cache-stats shape
are new surfaces for this fork, and the `chatCore` settings-read consolidation has no local counterpart to
re-align. No port.

**Expected existing behavior (today):** no request is served from or stored in a semantic cache, so there is
no cache-toggle state to honor; cache-control behavior is decided per provider and, for Claude-native
passthrough, cache breakpoints are anchored on the final translated body.

## #1230 — conservative beta set and cache passthrough for the Claude Code-compatible bridge

Source change, exact diff `eaec3279ab` → `c3cabbcc8`: the Claude Code-compatible `anthropic-beta` header set
drops `fast-mode-2025-04-01` and `redact-thinking-2025-06-20`; the bridge stops auto-injecting
`cache_control` on the last user message; the billing-header system block loses its own
`cache_control: { type: "ephemeral" }` marker; the 4-block cache-control cap stays but only limits markers
that already exist; the dashboard wording for "Client Cache Control" is rewritten.

Local findings: every hunk of this pull request edits the Claude Code-compatible bridge
(`open-sse/services/claudeCodeCompatible.ts`, `open-sse/handlers/chatCore.ts`), its beta-flag set, its cache
strategy, or the bridge's dashboard copy. None of those surfaces exist in this fork (whole-tree search for
`claudeCodeCompatible`, `CLAUDE_CODE_COMPATIBLE`, `compatible-cc` and `ENABLE_CC_COMPATIBLE` returns zero
hits).

**Disposition:** structural exclusion. There is no bridge, no bridge beta-flag set, no bridge cache strategy
and no bridge cache-control setting to trim; a port would be a port of a feature the fork does not carry.

**Expected existing behavior (today):** the fork sends `anthropic-beta` flags per provider and per request
shape — for example it removes `redact-thinking-2026-02-12` when the request asks for summarized thinking
([open-sse/executors/base.js:437](../../../open-sse/executors/base.js)) —
and client `cache_control` is preserved or dropped per provider quirk, never by a bridge-owned marker
strategy.

## #1257 — response-start timeout, combo timeout caps, bridge SSE restore

Source change, exact diff `da9af4af59` → `05453b972`:

- `open-sse/executors/base.ts` — the fetch timeout stops covering the whole request. A one-shot timer is
  armed before `fetch()` and cleared as soon as the response arrives, so an active stream is no longer cut
  off by total elapsed time; post-start stalls are left to `STREAM_IDLE_TIMEOUT_MS` and the Undici body
  timeout. `mergeAbortSignals` additionally propagates the aborting signal's reason.
- `open-sse/config/constants.ts`, `README.md` — the timeout is redefined as a response-start timeout.
- `src/shared/validation/schemas.ts`, `src/app/(dashboard)/dashboard/combos/page.tsx`,
  `ComboDefaultsTab.tsx` — the combo `timeoutMs` upper bound (600000 in the schema, 300000 in the UI) is
  removed.
- `open-sse/handlers/chatCore.ts`, `open-sse/services/claudeCodeCompatible.ts` — bridge-specific: force SSE
  upstream for bridge providers, restore the bridge's upstream SSE handling.

Local findings:

- **The response-start timeout is already the local behavior.** The generic executor arms a per-attempt
  connect/header timer and clears it once the response arrives
  ([open-sse/executors/base.js:442](../../../open-sse/executors/base.js),
  [open-sse/executors/base.js:564](../../../open-sse/executors/base.js));
  the only case that keeps the timer alive is the relayed-SSE path, which deliberately bounds the whole
  stream lifetime ([open-sse/executors/base.js:546](../../../open-sse/executors/base.js)).
  Abort-reason propagation is likewise already present through `AbortSignal.any`
  ([open-sse/executors/base.js:451](../../../open-sse/executors/base.js)),
  which is what the source's rewritten `mergeAbortSignals` achieves. Probe result: with a 150 ms header
  timeout, a stream whose headers arrive immediately and whose terminal chunk arrives 400 ms later
  completes normally (`data: {"a":1}` then `data: [DONE]`), i.e. the timeout does not cover the stream.
  Offline evidence: `unit/stream-first-chunk-timeout.test.js`, `unit/body-timeout.test.js`,
  `unit/combo-timeout.test.js` pass unchanged.
- **The combo timeout caps do not exist here.** The fork stores the combo strategy timeout in seconds with
  no upper bound in the dashboard ([src/app/(dashboard)/dashboard/combos/page.js:733](https://github.com/bloodf/durindoor/blob/6b07e66fc54f2391783cd1862bda15d4a6f8f25a/src/app/%28dashboard%29/dashboard/combos/page.js)),
  and the combo per-model timeout is a first-response deadline that does not replace the streaming stall
  timeouts ([open-sse/services/combo.js:1637](../../../open-sse/services/combo.js)).
- The bridge hunks have no local target, as in #1230.

**Disposition:** already covered for the runtime behavior; the cap removal has nothing to remove and the
bridge hunks are structural exclusions. **No port.**

**Expected existing behavior (today):** an upstream that never returns headers is aborted at the connect/header
deadline and classified as `connect_timeout`; once headers have arrived, an active stream is governed by the
stream idle timeout and the body inactivity timeout, not by the connect deadline, and a relayed SSE stream
keeps its own bounded lifetime.

## #1292 — proactive context compression in the request pipeline

Source change, exact diff `eaec3279a` → `b73d2359`: `open-sse/handlers/chatCore.ts` gains a post-translation,
pre-dispatch block that estimates the token size of the translated messages, compares it with 85 % of the
resolved model's context limit, and on overflow runs the three-layer `compressContext()` (trim tools,
compress thinking, purify history), replacing the body and emitting a `context.proactive_compression` audit
event with before/after token counts and the applied layers.

Local findings: the fork owns an equivalent mechanism at the same pipeline position, with a different and
larger implementation.

- The compression seam runs after translation and before dispatch
  ([open-sse/handlers/chatCore.js:965](../../../open-sse/handlers/chatCore.js)).
- It is context-budget aware: the seam receives `estimatedTokens` for the translated body and the resolved
  model's `contextWindow`, and the adaptive resolver turns that into a target and escalates an engine ladder
  until the request fits, never dropping content
  ([open-sse/services/compression/adaptiveCompression/resolveAdaptivePlan.js:15](../../../open-sse/services/compression/adaptiveCompression/resolveAdaptivePlan.js),
  [open-sse/services/compression/adaptiveCompression/computeTarget.js:11](../../../open-sse/services/compression/adaptiveCompression/computeTarget.js)).
- The fork's percentage policy default is the same 85 % threshold the source used
  ([open-sse/services/compression/adaptiveCompression/types.js:23](../../../open-sse/services/compression/adaptiveCompression/types.js)).
- The difference is the trigger's default: the source compresses unconditionally above the threshold, while
  the fork's context-budget mode is persisted as `off`
  ([src/lib/db/repos/settingsRepo.js:146](../../../src/lib/db/repos/settingsRepo.js),
  [open-sse/services/compression/adaptiveCompression/types.js:19](../../../open-sse/services/compression/adaptiveCompression/types.js)),
  and the seam itself runs only when the token saver is enabled and compression is turned on.
- The fork has no `contextManager`, no `compressContext`, and no `getTokenLimit`; its model context window
  comes from the resolved model capabilities, and the estimate from `estimateTokens`.

**Disposition:** no isolated port is required. The capability exists locally with the same threshold, the
same pipeline position and a strictly larger engine ladder, and the source's `compressContext` layers
(trim tools, compress thinking, purify history) have local equivalents inside the Lite/Caveman/RTK engine
set. Making the trigger unconditional would be a default-behavior product decision for the fork's own
compression stack, not a port of a missing capability. The fork's existing published evidence for this
subsystem is in `internal/docs/port-reports/1073-oct-model-unavailability-compression.md`,
`1073-safe-compression-tool-output.md` and `1073-compression-engine-clear.md`.

**Expected existing behavior (today):** with the persisted default `compressionAdaptive.mode = "off"` and no
explicit engine selection, the seam returns the base plan unchanged and the request is dispatched as
translated; an oversized request is not compressed proactively and the upstream context-window error
surfaces. With the compression stack enabled and `compressionAdaptive.mode` set to `floor` or
`replace-autotrigger` (policy `percentage` with `pct 0.85`, or `reserve-output`), the seam estimates the
translated body's tokens, compares them against the resolved model's context window, escalates the engine
ladder until the request fits the target, reports the applied stages and savings through the compression
response header, and still never drops content. Offline evidence: `unit/adaptive-budget-chatcore.test.js`,
`unit/compression-chatcore-f1b.test.js` and `unit/compression-token-estimate.test.js` pass unchanged (part of
the focused run).

## Exclusions and scope boundaries

- **Provider Sign-in left open.** The Claude OAuth redirect-URI change in #937 is authentication work and is
  explicitly not dispositioned here.
- **New providers and integrations left open.** No new provider, provider mode, dashboard surface, MCP tool
  shape or integration was judged applicable; #975, #1135 and the bridge paths of #937/#1230/#1257 are
  excluded on that basis.
- **New features left open.** #975 (per-connection custom `User-Agent`) is a feature addition and is excluded.
- **No owner selection list** was produced, and no implementation, runtime change or product decision is made
  by this report.

## Verification limits

This review establishes the exact merged source diff of the six named pull requests (each validated against
the metadata path list), the current local runtime behavior of the compared surfaces, and the focused offline
fixture results quoted above. It does not re-audit the rest of the April 2026 OmniRoute window, does not
classify any other merged record, and does not claim that the remaining April records are unported or safe.
The single open port candidate (#937's content-type precondition on the GitHub streaming routes) is stated as
a candidate with its expected behavior and scope, not as a change already made here; it stays open for the
isolated port it describes, and no code was modified by this review.
