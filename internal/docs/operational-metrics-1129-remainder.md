# Operational metrics: issue #1129 remainder

Status: partial implementation in author validation, based on
`f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46`. The integration owner granted the
exclusive ordinary author slot after #1649 released it. Focused evidence below
does not complete #1129. The full checkpoint remains independently blocked.

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

The common `withRequestCorrelation` wrapper in
`src/sse/utils/requestCorrelation.js:98-107` wraps route and shared handlers.
The same Request is frequently nested. Legacy completions additionally create a
new Request at `src/app/api/v1/completions/route.js:273` and inherit its existing
trusted correlation ID at line 280. A WeakMap alone misses this case. The draft
must test nested same objects, that derived-object path, concurrent independent
objects, pre-dispatch rejections, thrown handlers, stream EOF/error/cancel and
request abort. Existing `getRequestId` ignores caller headers, generating an ID
unless its explicit trusted argument supplies one. The telemetry draft never
compares ID strings or deduplicates globally by ID. Only an explicit trusted-ID
copy inside an executing outer observation binds the derived Request to that
opaque scope. Distinct nested Requests without that operation, and top-level
Requests with identical trusted IDs, remain independent. Completed Request
objects retain their once-only observation on reuse.

The proposed contract counts observed client HTTP starts and exactly one
transport terminal outcome: clean EOF, HTTP error, stream transport error or
cancellation. HTTP 200 with a provider error envelope still has a clean HTTP
transport; these metrics do not assert semantic provider success. Handler errors
remain the existing sanitized HTTP 500. No upstream-attempt counter is implied.
Durations include handler work and body consumption until terminal observation;
an unread body remains in flight until cancellation or abort.

Covered: existing correlated chat/completions/messages/responses, embeddings,
media/search/fetch/rerank/moderation/token-count, files/batches and catch-all
routes, plus the assigned native HTTP wrapper. OPTIONS is excluded. The music
alias re-exports the already wrapped music route. Explicitly excluded: unwrapped
root models listing (including `/v1` alias), models/info, plugin manifest,
chatgpt-web image artifact download, internal realtime auth/control requests,
WebSocket upgrades/sessions/turns, and middleware denials before handlers.
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

The owned draft now connects `operationalMetrics.js` to the common correlation
wrapper, native HTTP exports, gate rejection sites, cache publication/clear
sites and the authenticated metrics route. Fixed HTTP outcomes, buckets,
admission reasons and provider states are documented in the operator guide.
The observer uses a zero-high-water-mark stream, a lazy single upstream reader
and the existing response bytes/status/headers. Its abort listener observes the
request signal without aborting or cancelling upstream work and is removed at
terminal accounting. Admission instrumentation changes no resolution/rejection,
queue, timeout, rollback or release decision.

The new runtime test file has focused author evidence below. It includes
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
  the same wrapper/scrape comparison on the candidate. Two Kimchi dynamic-import
  errors appeared in stderr, despite exit 0. These diagnostics are retained and
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

Mandatory hooks, root lint, docs checks and commitlint must pass before normal
push and a focused draft PR. Independent exact-head review, unresolved client
denial/stream bridges, startup integration, real process/overhead/artifact proof
and the authorized full checkpoint remain open. No build, server, provider,
deployment, release or status publication is part of this author slot.
