# Operational metrics: issue #1129 remainder

Status: author-validated correction prepared against independently reviewed PR #1656 head
`d9fbe83ba9d8ba532b68fbf61b9d5e73dc61f11f`, originally based on
`f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46`. Historical author evidence below
applies to that published head. The correction has separate ordinary author
evidence below; it awaits publication and a new independent exact-head review.
The slot was granted after the path/export inventory was recorded. The full
checkpoint remains independently blocked.

## Acceptance and existing evidence

[Issue #1129](https://github.com/bloodf/durindoor/issues/1129) includes transferred
issue #1132. It has no comments at discovery. Neither merged PR closes it:

- [#1629](https://github.com/bloodf/durindoor/pull/1629), merge
  `985ddaf1a3c2afedf50df43560e9305a783a2103`, added authenticated Prometheus export,
  active requests, uptime, RSS and one process-local 20 ms event-loop histogram.
- [#1645](https://github.com/bloodf/durindoor/pull/1645), merge
  `f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46`, added queue depth, process-global
  gate state, and middleware-to-handler credential tests. Its body explicitly
  leaves counters, latency histograms, provider availability, admission failures
  and stall diagnostics open.

| Acceptance | Existing source | Remaining draft and proof obligation |
| --- | --- | --- |
| Counters, histograms, gauges and bounded labels | Metrics route, queue gauge | Client HTTP observations with fixed terminal outcomes and latency buckets; admission timeout/abort counts; cached provider connection states |
| Management authorization and scraping | Metrics route and operational guide; middleware/auth tests | Preserve the same credentials, 401/503 behavior and no-store headers; document each new series |
| Reset/restart and privacy | Global sampler and gate state; metrics tests | Process-only aggregates, reload reuse, no scrape/reset coupling, no credential/session/prompt/model/URL dimensions |
| Existing latency probes and overhead | Chat terminal handlers already save total/TTFT; health monitor records probe latency | Do not recount usage writes or treat probe/attempt latency as client latency; bound observations, timer and exported series |
| Bounded stall events and admission correlation | No stall recorder in local tree | Monotonic timer drift, fixed-capacity numeric event history, queue/failure/RSS snapshot; bootstrap assignment and real overhead evidence remain open |
| Unusable sampler without log spam | Existing p99 omits invalid readings | Preserve unknowns, fixed warning at most once per process, no raw exception strings |

## Ownership

Granted: this document, `src/app/api/monitoring/metrics/route.js`,
`docs/operations/operational-metrics.mdx`, the three existing operational metrics
tests, and new `tests/unit/operational-metrics-runtime.test.js`.

Additional grants: instrumentation only in
`open-sse/services/concurrencyGate.js`; outer HTTP observation in
`src/sse/utils/requestCorrelation.js`; wrapper exports in
`src/app/api/v1/native/[provider]/[...operation]/route.js`; an integrated
`open-sse/services/operationalMetrics.js`; numeric cached projection on existing
publish/clear sites in `src/lib/healthMonitor.js`. The projection must not move
cache authority or cause refreshes.

`src/instrumentation.node.js` belongs to #1652. Its startup hook needs an
additive recorder call after that owner's lifecycle fix lands. Other auth,
chat, combo, native/media/stream implementations, DB, registry, updater, gate
policy and dependencies remain read-only. No behavior of admission, queueing,
cancellation or concurrency limits may change.

## Lifecycle discovery and counting boundary

`src/lib/db/repos/usageRepo.js:458-497` tracks pending chat attempts. Its only
production start/finish callers are `open-sse/handlers/chatCore.js:1108,1139`.
It starts after early validation, expires pending work with a default non-error
finish, and does not cover native/media routes. It cannot supply client totals.
Usage persistence also has billing deduplication and async job updates; counting
those writes would couple telemetry to accounting and duplicate logical work.

Chat terminal handlers already measure total and TTFT latency in
`open-sse/handlers/chatCore/{streamingHandler,nonStreamingHandler,sseToJsonHandler}.js`.
Those describe attempts and parsed terminal events. HTTP observation must use
its own monotonic elapsed time at the public boundary, without new body parsing.

The correlation-only `withRequestCorrelation` wrapper in
`src/sse/utils/requestCorrelation.js` wraps shared handlers. Explicit
`withHttpRequestCorrelation` wraps public HTTP exports.
The same Request is frequently nested. Legacy completions additionally create a
new Request at `src/app/api/v1/completions/route.js:273` and inherit its existing
trusted correlation ID at line 280. A WeakMap alone misses this case. The draft
must test nested same objects, that derived-object path, concurrent independent
objects, pre-dispatch rejections, thrown handlers, stream EOF/error/cancel and
request abort. Existing `getRequestId` ignores caller headers, generating an ID
unless its explicit trusted argument supplies one. The telemetry draft never
compares ID strings or deduplicates globally by ID. An explicit trusted-ID
copy (legacy completions), or `inheritHttpObservation` (Gemini), inside an
executing outer observation binds a derived Request to that opaque scope. Distinct nested Requests without that operation, and top-level
Requests with identical trusted IDs, remain independent. Completed Request
objects retain their once-only observation on reuse.

The proposed contract counts observed client HTTP starts and exactly one
transport terminal outcome: clean EOF, HTTP error, stream transport error or
cancellation. HTTP 200 with a provider error envelope still has a clean HTTP
transport; these metrics do not assert semantic provider success. Handler errors
remain the existing sanitized HTTP 500. No upstream-attempt counter is implied.
Durations include handler work and body consumption until terminal observation;
an unread non-HEAD body remains in flight until cancellation or abort. HEAD and
bodyless responses finish at return without consuming or cancelling a body.

Covered: existing correlated chat/completions/messages/responses, embeddings,
media/search/fetch/rerank/moderation/token-count, files/batches and catch-all
routes, model detail, public realtime credential/session HTTP operations, the
Gemini v1beta POST (including parse failures/native TTS), and the assigned native
HTTP wrapper. OPTIONS is excluded. The music
alias re-exports the already wrapped music route. Explicitly excluded: unwrapped
root models listing (including `/v1` alias), models/info, plugin manifest,
chatgpt-web image artifact download, internal realtime auth/control requests,
the management translator/send diagnostic, WebSocket upgrades/sessions/turns,
and middleware denials before handlers.
These are coverage gaps, not zero traffic. The issue cannot close by calling
this draft an all-route total; the integration owner must assign any required
remaining lifecycle integrations.

## Provider availability without scrape traffic

`src/lib/healthMonitor.js` already probes configured connections, overlays recent
successful activity, and caches for 60 seconds. Its states are healthy, degraded,
down, blocked, unconfigured and unknown. The draft exports only numeric counts
by this fixed state set and cache expiry; it retains no provider/connection ID.
It does not claim these counts prove model eligibility, capacity or quota.

Only a generation-approved cache publication updates the projection. Existing
invalidation and forced refresh clear it. Missing, expired, invalidated or
failed collection is unknown, not six zero counts. A fresh empty inventory can
truthfully report all zero counts. A scrape must never call `getHealthPayload`,
the prober, credential lookup or network refresh. Existing cache authority,
generation checks and concurrent refresh behavior remain unchanged. A numeric
projection-only generation also fences late publication after another server
module instance clears the projection; it never invalidates or replaces either
instance's existing payload cache. Cross-module late-publication coverage is
drafted in the runtime test file.

## Upstream source review

The issue's historical OPEN state is stale. GitHub reports both merged:

- [OmniRoute #15888](https://github.com/cheaper-inference/OmniRoute/pull/15888),
  merge `97eb6e4f9bacca53048de6f555a976c3e68b81c2`, final head
  `ae1f96a5a804cb35234d74d93820ea6fa6816769`.
- [OmniRoute #15978](https://github.com/cheaper-inference/OmniRoute/pull/15978),
  merge `279bbec796e819005f5cd961d741c120552d4353`, final head
  `52f19fc73c4e27abeb286bd18029c17dbc8014e3`.

Reviewed both file diffs and the reachable
[`src/lib/healthzLag.ts` at the second merge](https://github.com/cheaper-inference/OmniRoute/blob/279bbec796e819005f5cd961d741c120552d4353/src/lib/healthzLag.ts).
Useful mechanisms: a single unref'd one-second timer, monotonic elapsed time
minus the nominal interval, cumulative count/maximum, idempotent start, and one
warning for thrown/NaN/infinite/negative readings. Local adaptation must preserve
unknown readings instead of the upstream `inflight=0` fallback. Do not reset the
existing process-lifetime p99 histogram to calculate window peaks. Boot wiring
belongs to the #1652 owner; a first-scrape start cannot establish boot coverage.

## Prepared implementation and remaining integration

The owned draft connects `operationalMetrics.js` to explicit public HTTP
wrappers, native/Gemini HTTP exports, gate rejection sites, cache publication/clear
sites and the authenticated metrics route. Fixed HTTP outcomes, buckets,
admission reasons and provider states are documented in the operator guide.
The observer uses a zero-high-water-mark stream, a lazy single upstream reader
and the existing response bytes/status/headers. Its abort listener observes the
request signal without aborting or cancelling upstream work and is removed at
terminal accounting. Admission instrumentation changes no resolution/rejection,
queue, timeout, rollback or release decision.

The published runtime test file has historical author evidence below. Its
correction draft uses explicit HTTP wrappers and adds HEAD and expired async
scope coverage; these additions have separate correction evidence below. The published file includes
real wrapper nesting/derivation, identical-ID independent top-level Requests,
independent nested Requests, early rejection/handler throw, abort before headers,
already-aborted input, lazy binary stream pulls, original body error/cancel
reason and cancellation rejection, unread body limits, HTTP 200 error-envelope
transport semantics, cumulative histogram boundaries, native response contracts,
OPTIONS exclusion, reload/fresh-state simulation, actual cache invalidation and
late-build fencing, fixed projection states, gate timeout/abort, explicit runtime
start, bounded events, unusable readings, sampler enable failure/retry,
start-first/route-first reuse, timer unref and unchanged process listener counts.
The fresh-state simulation is not real child-process restart proof.

The #1652 owner supplied this source-only bootstrap contract while retaining
`src/instrumentation.node.js` ownership at head `255ff329`:

```js
// Inside bootstrapNodejsRuntime, immediately after process-title normalization.
void import("../open-sse/services/operationalMetrics.js")
  .then(({ startOperationalMetricsRuntime }) => startOperationalMetricsRuntime())
  .catch(() => { console.warn("[metrics] Runtime recorder not started"); });
```

This is a proposed later integration, not installed code. Keep the existing
Edge-safe compile-time guard in `src/instrumentation.js`. Start no drift timer
at top level, on scrape, or in a getter; add no signal handlers. Initiating the
import early does not guarantee resolution before other asynchronous startup
imports. `runtime_recorder_started=0` truthfully covers that interval. The
process-global guard retains the existing timer callback across HMR until
process restart. No owned shutdown API is needed; unref must permit process exit.
The shared p99 histogram is allocated and enabled locally before global
publication, allowing retry after enable failure. The route still initializes
that histogram when evaluated, as it did before this draft; not every import is
inert and no build-time histogram absence is claimed.

After #1652 merges, reconcile the current base normally and obtain an explicit
one-writer handoff for the additive bootstrap block and dedicated integration
fixture. Required later proof includes real Node register-to-start, Edge/module
evaluation without drift timer, real unref/process exit, no reset on reads,
failure/retry, route-first/start-first/HMR reuse, existing Kimchi/Headroom
lifecycle checks and independent updated-head app/website/CLI/standalone/packed
artifact coverage. #1652's old evidence cannot establish this draft's readiness.

## Read-only proposal for remaining admission signals

No auth, quota, policy, chat, media or stream implementation was edited for this
discovery. Current gate telemetry covers actual concurrency timeout and abort
rejections only. An intentional abort is explicitly separate from HTTP errors
and provider failure evidence. HTTP status 401/403/429 alone cannot identify a
local admission denial: providers also return those statuses, and a rejected
candidate may be followed by successful fallback.

| Existing bounded source | Exact integration point to consider after assignment | Counting boundary |
| --- | --- | --- |
| Credential evaluation has `ok` plus `missing`/`invalid`, with local optional-auth behavior | `src/sse/services/auth.js:1649-1662,1680-1690`; actual client return in `src/sse/handlers/chat.js:436-443`, native provider `:60`, image `:55`, TTS `:48`, STT `:45`, embeddings `:53-58` | Mark the selected client rejection, not each credential candidate; realtime operator bypass means `resolveClientApiKey` failure alone is not proof of a denial |
| Invalid policy, model allowlist/access, lifetime token/cost limits | `src/sse/services/apiKeyPolicy.js:126-204` at existing denial Response construction | Associate a fixed reason with that Response, without incrementing there; vision-bridge rejection in chat `:927-929` deliberately keeps the original model |
| Per-Request window/RPM/TPM check, existing checked-Request WeakSet | `src/lib/apiKeyLimits.js:160-175` at its returned limit Response; chat `:475-476` is the outer use | Preserve rate accounting and fail-open query behavior; do not count quota queries, checked calls or successful requests as failures |
| Daily key token limit | Chat `:454-469`; `src/sse/services/nativeUsage.js:78-82`, called by native provider `:137-138` | Mark actual denial Response with a fixed `client_limit` reason; no token totals or key identifiers in telemetry |
| Provider selection returns `providerDisabled`, `allRateLimited`; quota capacity has typed code `QUOTA_DISPATCH_UNAVAILABLE` | `src/sse/services/auth.js:530-539,677-683,763-769`; chat final selection `:1091-1145`; native provider `:176-177`; `open-sse/handlers/chatCore.js:369-373,1372-1376,1498-1502,1511-1515` | Selection/dispatch failures are candidate/attempt evidence until the outer handler chooses the final result; map typed local capacity to one constant, never export arbitrary `error.reason` |

Minimal proposed integration, subject to root's assignment:

1. Add an internal weak Response-to-fixed-reason annotation at the existing
   denial construction sites. Keep it out of headers, bodies, serialized errors
   and routing decisions. Reasons can be a small fixed set such as `auth_missing`,
   `auth_invalid`, `policy`, `client_limit`, `provider_unavailable`,
   `quota_capacity`. No message parsing or credential/DB IDs are needed.
2. Preserve that annotation when `correlateResponse` rebuilds a selected response
   (`src/sse/utils/requestCorrelation.js:86-95`). Count only the final selected
   outer client denial once, in a separate client-admission series. A candidate
   policy failure followed by successful fallback contributes zero denials.
3. Assign the delayed-response bridge separately:
   `open-sse/utils/earlyStreamKeepalive.js:160-295` can send HTTP 200 keepalive
   before a later denial is converted into a protocol error frame. That source
   knows the final selected denial; the HTTP observer does not. Preserve its
   bytes/status/timing/cancellation and transfer only the opaque observation
   token plus fixed reason. Without this bridge, delayed streaming admission
   denials remain unknown rather than being inferred from HTTP 200.

Before adding these hooks, assign the exact affected producer paths and test
ownership. Required regressions: optional auth and valid CLI/operator bypass;
multiple credential candidates; denied vision bridge with successful original
model; denied combo member with successful fallback; same-Request limit reuse;
local capacity versus upstream 429/503; intentional client abort; final native/
media/chat denial; and denial after early keepalive. No policy enforcement,
credential selection, allowance mutation, quota settlement or retry changes are
part of this proposal. WebSocket sessions remain a separate protocol and are
explicitly excluded from the HTTP contract, not fabricated as HTTP coverage.

## Validation and publication still required

Draft regressions must exercise the actual correlation wrapper and metrics
handler, lazy stream reads, preserved bytes/status/headers, cancellation reason
and thrown-error identity, once-only accounting, reload/restart, exact fixed
label domains, fresh/stale/empty/invalid provider projection, gate timeout/abort
without admission changes, bounded stall history and unusable-reading warnings.

Author validation uses a fresh private source copy, Node 26.13.0 (ABI 147,
darwin-arm64), private dependencies/HOME/DATA_DIR/cache/reports and an allowlisted
environment. Before application imports, both the real parent and spawned child
received EPERM on network and synthetic outside-home read/write probes under an
OS sandbox. Dependency acquisition disabled scripts. The reused private native
SQLite binary matched lockfiles and had a recorded Node 26 source-build receipt;
the author verified its ABI with a synthetic in-memory database. No real DB or
credentials were read. Commands have a 295-second supervisor; focused Vitest uses
at most two fork workers. No baseline entry was added.

Private evidence root: `/private/tmp/dd1129-author-f00piv16`. Logs retain command
arguments, environment, profile hash, stdout/stderr hashes, timestamps and exits.
Test attempts retain fresh JSON and JUnit. This path is machine-local evidence,
not a published artifact or independent review receipt.

- Attempt 07: 31 passed, one failed. The formatter omitted a final newline;
  the HTTP route already supplied one. The one-line formatter correction makes
  the helper's standalone text complete. Attempt 09: all 32 focused tests passed.
- Attempt 08: comparison started before its private source/dependency copy
  finished and failed before collection with MODULE_NOT_FOUND. It is retained,
  not counted as a regression result. After copy completion, attempt 10's single
  actual-wrapper/scrape comparison failed on the exact base because the client
  request counter was absent, as expected.
- Attempt 11: 201 assertions passed across 11 caller/fixture files, including
  the same wrapper/scrape comparison on the candidate. Seven Kimchi dynamic-import
  errors appeared in stderr, despite exit 0, alongside four expected stale-epoch
  save rejections. These separate diagnostics are retained and
  prevent calling the caller run clean runtime evidence. Protected Kimchi source
  was not changed or suppressed.
- Attempt 12: 51 assertions passed on the unchanged base's two diagnostic
  fixtures and reproduced the same Kimchi error origin. This attributes the
  protected-source diagnostic; it does not make it clean validation evidence.
- Attempt 13: root lint failed the new observer's `typeof` guard under the
  existing anti-slop rule. The observer now uses the repository's existing
  `isObject` and `isFunction` helpers. Attempt 14 passed root lint with zero
  errors and 327 existing warnings, plus zero anti-slop diagnostics. Attempt 15
  passed changed-code ESLint with `--max-warnings=0`.
- Attempt 16: 233 assertions passed across 15 files, zero skipped. This includes
  232 checked-in tests and the private retained before/after fixture. The final
  run logged seven Kimchi dynamic-import errors and expected stale-billing-epoch
  rejection diagnostics from the native identity fixture's rejection assertions.
  All diagnostics remain retained. Passing assertions are not a clean runtime
  run, full coverage, an independent review or an authorized gate result.

## Independent review corrections in LIGHT

The source/evidence review at
`/var/folders/tw/_vvy7bzd4zd07mg54rph6kh00000gn/T/dd1656-light-review-wcpdjd5s`
identified three P2 source defects and one P3 narrative error at the published
head. All 29 review-manifest entries match their recorded sizes and hashes.
The original review and author artifacts remain untouched. Reading retained raw
attempt 11 stderr confirms seven Kimchi entries and four stale-epoch save
rejections; the earlier checked-in count of two was wrong. The final PR body's
seven-entry count was already correct. No historical evidence was rewritten.

The owned LIGHT draft treats HEAD as terminal at handler return even when the
reused GET handler returns a body. It returns that response unchanged, without
reading/cancelling the body or changing cancellation authority. Draft regressions
leave successful HEAD bodies deliberately unread/unaborted and check native
HEAD error status, headers, response identity and terminal accounting.

The granted correction separates HTTP observation from shared correlation.
`withRequestCorrelation` keeps the existing IDs, sanitization, error conversion
and response headers without starting an observation. Public exports use
`withHttpRequestCorrelation`. Native retains its explicit observer; Gemini POST
now observes its outer Request and explicitly binds its converted chat Request.
The derived Gemini Request's construction, including its absent copied abort
signal, is unchanged. No URL heuristic, ID-string equality or blanket nested
Request suppression is used. Shared internal batch rows do not start HTTP
observations; batch resource HTTP operations still do.

Regression drafts in `tests/unit/operational-metrics-http-boundary.test.js` use
real decorators, resource auth, shared handlers, default batch executor, legacy
and Gemini bridges. Only provider execution/transport is replaced. They cover
chat and embeddings batch rows, real file GET with unread HEAD body, actual
legacy derivation, Gemini final JSON/SSE unread/cancel/EOF, outer abort without
new derived signal inheritance, invalid JSON, native TTS, and independent nested
public observations. The existing runtime draft retains once-only, demand,
error/cancellation forwarding and identical-ID cases and adds HEAD plus an ALS
scope that outlives its handler. The public correlation inventory harness
forwards the new decorator while preserving the old shared-handler harness.

The three P2 findings remain open until authorized validation, publication and
new independent exact-head review. P3's narrative is corrected without changing
historical artifacts. The published head remains `d9fbe83b`. No correction test,
install, lint, build, hook, push or review execution preceded this inventory.
No protected auth/chat/fusion/core, default executor, Gemini bridge, instrumentation
bootstrap, denial or keepalive implementation was edited.

## Granted correction inventory before execution

There are 47 correction paths: five of the original nine paths, 39 v1 route
files, Gemini's route, the correlation inventory harness, and the new HTTP
boundary regression file. The complete PR draft spans 51 paths including four
unchanged original PR paths: metrics route, native route, health monitor and
concurrency gate. For the 39 v1 files below, changes are limited to adding the
`withHttpRequestCorrelation` import and substituting that decorator on the 55
listed non-OPTIONS exports. Every one of the 39 OPTIONS exports is unchanged.
Removing those exact substitutions recovers each published-head file byte for
byte. No route body, runtime declaration or re-export changes.

Paths below are relative to `src/app/api/v1/`:

| Route path | HTTP exports changed |
| --- | --- |
| `[...catchAll]/route.js` | GET, POST, PUT, PATCH, DELETE, HEAD |
| `api/chat/route.js` | POST |
| `audio/speech/route.js` | POST |
| `audio/transcriptions/route.js` | POST |
| `audio/translations/route.js` | POST |
| `audio/voices/route.js` | GET |
| `batches/[id]/cancel/route.js` | POST |
| `batches/[id]/route.js` | GET |
| `batches/route.js` | HEAD, GET, POST |
| `chat/completions/route.js` | POST |
| `completions/route.js` | HEAD, POST |
| `embeddings/route.js` | POST |
| `files/[id]/content/route.js` | GET |
| `files/[id]/route.js` | HEAD, GET, DELETE |
| `files/route.js` | HEAD, GET, POST |
| `images/edits/route.js` | POST |
| `images/generations/route.js` | POST |
| `live/sessions/route.js` | POST |
| `messages/batches/[id]/cancel/route.js` | POST |
| `messages/batches/[id]/results/route.js` | GET |
| `messages/batches/[id]/route.js` | GET |
| `messages/batches/route.js` | HEAD, GET, POST |
| `messages/count_tokens/route.js` | POST |
| `messages/route.js` | POST |
| `models/[...model]/route.js` | GET, HEAD |
| `moderations/route.js` | POST |
| `music/generations/[request_id]/route.js` | GET |
| `music/generations/route.js` | POST |
| `realtime/client_secrets/route.js` | POST |
| `realtime/transcription_sessions/route.js` | POST |
| `realtime/translations/client_secrets/route.js` | POST |
| `rerank/route.js` | POST |
| `responses/compact/route.js` | POST |
| `responses/route.js` | POST |
| `search/route.js` | POST |
| `systemone/route.js` | POST |
| `video/generations/route.js` | POST |
| `videos/[[...path]]/route.js` | POST, GET |
| `web/fetch/route.js` | POST |

Other changed paths and caller impact:

| Path | Correction and affected callers |
| --- | --- |
| `src/app/api/v1beta/models/[...path]/route.js` | POST outer observer plus explicit derived binding; OPTIONS and provider/conversion/catch bodies unchanged |
| `src/sse/utils/requestCorrelation.js` | Shared decorator correlation-only; explicit HTTP decorator reuses it; all 17 shared decorated handler exports stop starting observations, retain correlation |
| `open-sse/services/operationalMetrics.js` | HEAD terminal at return; preserves Response/body; documents explicit Gemini binding |
| `tests/unit/operational-metrics-runtime.test.js` | Explicit boundary calls, unread HEAD, expired async scope; existing lifecycle regression coverage retained |
| `tests/unit/public-route-correlation.test.js` | Forward the real new decorator through the existing response harness |
| `tests/unit/operational-metrics-http-boundary.test.js` | Real-route/default-executor/bridge regressions; correction evidence below |
| `docs/operations/operational-metrics.mdx` | Explicit boundary/HEAD/bridge semantics and precise exclusions |
| `internal/docs/operational-metrics-1129-remainder.md` | Acceptance map, P3 correction, this inventory and pending proof |

The unchanged `/v1/audio/music` alias re-exports its wrapped music route. Shared
chat, embeddings, countTokens, fetch, imageEdit, imageGeneration, moderations,
music (GET and generation), rerank, search, stt, systemone, tts and video
(generation/create/GET) exports remain correlation-only. The management
`/api/translator/send` POST keeps shared correlation and becomes unobserved,
explicitly excluded from public gateway totals. Internal default-batch calls
still execute real auth/policy/provider/translation paths. Gemini's final
Response owns completion; native's existing observer remains in place.
No explicit Edge runtime consumer was found in the granted route/correlation
callers; explicit runtime declarations there select Node, otherwise Next's Node
default applies. The existing Node ALS dependency is unchanged; instrumentation's
compile-time Edge guard and lifecycle ownership remain untouched.

Future author selectors include both metrics suites, request/public correlation,
metrics route/auth/queue, native-provider, v1-batches/full-batches, v1-completions,
Gemini native and Gemini gateway conformance. They are author regression evidence,
not an independently frozen scoped selection or full-checkpoint authorization.

Mandatory hooks, root lint, docs checks and commitlint must pass before normal
push and a focused draft PR. Independent exact-head review, unresolved client
denial/stream bridges, startup integration, real process/overhead/artifact proof
and the authorized full checkpoint remain open. No build, server, provider,
deployment, release or status publication is part of this author slot.

## Correction author evidence (separate from original receipts)

Private evidence root: `/private/tmp/dd1656-correction-25iau9to`. Original
`/private/tmp/dd1129-author-f00piv16` and the independent review directory were
not rewritten. This is ordinary author evidence, not a scoped/full gate,
approval, independent review or execution-boundary review.

Before application imports, actual Node 26.13.0 / ABI 147 / darwin-arm64 / uid
501 parent and child both received EPERM on network and synthetic outside-home
read/write probes. Dependencies were acquired into private storage with scripts
disabled. Root/test lockfiles matched the published tree. The retained native
SQLite build receipt/hash was checked before private copying and an offline
in-memory ABI smoke. Commands used an allowlisted environment, private HOME,
DATA_DIR/cache/reports and a 295-second supervisor; focused runs used at most two
fork workers. No failure baseline, timeout or concurrency policy changed.

Each application/check command records before/after SHA-256 manifests of the
actual source/test/config inputs, full stdout/stderr hashes, arguments, exit and
timestamps. Test JSON/JUnit case counts agree and report timestamps fit command
receipts. The final 417-assertion run has no source/input drift. Dependency
acquisition attempt 03's first input-root manifest was incorrect for nested
`tests/`; that harness defect is recorded and fixed before application runs.
Acquisition is not presented as application validation. All attempts remain.

- Attempt 06 reproduced both phantom batch counters on exact old `d9fbe83b`
  with the new boundary fixture copied into that comparison tree. It used only
  machine reporters and cannot support a raw diagnostic absence claim.
- Attempt 07 added the default reporter, preserved raw diagnostics, and exposed
  an absolute-zero test teardown assertion that cascaded HEAD's leaked active
  state into later cases. Teardown now requires zero per-case active delta;
  the HEAD behavior assertion itself still fails on the old head. Neither early
  attempt is substituted for final comparison evidence.
- Attempt 09 runs the identical corrected fixture on exact old source: eight
  expected failures, three passes. One newly introduced decorator-only case is
  deliberately outside the old-head selector because that API does not exist
  there. Actual legacy derivation and both SSE terminal cases already pass on
  the old head. The failures demonstrate two phantom batch-client cases, leaked
  unread HEAD, premature final Gemini JSON completion/cancellation, absent outer
  abort accounting and unobserved invalid-JSON/native-TTS branches.
- Attempt 08 on the correction passes all 42 boundary/runtime assertions, with
  zero skipped. It retains one inherited Kimchi import error.
- Attempt 10 passes 417 repository assertions across 23 files, zero skipped and
  no private fixture counted. It covers the reviewer-mapped native, batches,
  legacy, Gemini and correlation callers plus existing metrics/auth/queue,
  health, gate, native usage/identity, early keepalive and active-session tests.
  JSON SHA-256: `9f86c9c640f5fb00440834f830bc3b4c1af47f3f756d66adcef0f8a9e37cde28`.
  Raw stderr contains ten inherited Kimchi import errors and four expected
  stale-billing-epoch save rejections. The deliberate invalid-JSON test preserves
  Gemini's existing parse-error log. Passing assertions do not erase these
  diagnostics or establish clean runtime readiness.
- Attempt 11 passes root lint: zero errors, 327 existing warnings, anti-slop zero
  diagnostics. Its generated anti-slop bundle is retained as an output and
  excluded from the patch. Attempt 12 passes changed JavaScript ESLint with
  zero warnings. Docs, mandatory hook, title/range commitlint and final commit
  binding are recorded in this evidence root before normal publication.
- Attempt 14 staged correctly but macOS `/usr/bin/git` emitted denied xcrun
  cache writes outside the private home. Attempt 16 is not a hook pass:
  lint-staged reported no initial commit / failed staged-file lookup even though
  the hook's final anti-slop command returned zero. Both outputs remain. Private
  PATH now resolves directly to the installed CLT git binary, with its hash
  recorded; hook source/config and sandbox restrictions are unchanged. Attempt
  18 independently passes lint-staged for all 47 staged paths. The complete
  mandatory hook is rerun on the final matching staged tree before publication.

The three original P2 findings remain visible for the next independent review;
this author evidence supports their corrections without self-approving them.
P3's attempt-11 narrative is now seven Kimchi errors. Remaining issue acceptance
still includes unstarted bootstrap (#1652 handoff), protected denial/early
keepalive hooks, excluded metadata/artifact/middleware routes and WebSockets,
real process-exit/artifact/overhead proof, inherited runtime diagnostics and the
independently authorized full checkpoint. Refs #1129; this PR does not close it.
