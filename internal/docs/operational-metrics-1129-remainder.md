# Operational metrics: issue #1129 remainder

## Native configured eligibility increment

Published PR #1656 head `8287380248d44f21f7f7b3f9a2ad97c8d85861cb`
remains the immutable independent review target for the previous increment.
The coordinator reports its completed source/evidence review found no
actionable source defect and all three prior P3 coverage gaps were addressed.
It verified 234 current and 980 historical artifacts, with 3,858 passing tests
across 53 files matching JSON/JUnit. The 29 Kimchi diagnostics remain unresolved.
This is historical source clearance, without runtime, gate or acceptance approval.
The supplied report is
`/var/folders/tw/_vvy7bzd4zd07mg54rph6kh00000gn/T/dd1656-independent-final-review-137mnpwr/review.md`,
with coordinator-verified SHA-256
`159bde688c285e4449ddfc88e65d1130be62b816134929f82a1c8eae35cccae3`.
No reviewer was contacted or polled. No previous proof validates this new draft.

This increment owns exactly four existing paths:
`src/sse/handlers/nativeProvider.js`,
`tests/unit/operational-metrics-admission.test.js`,
`docs/operations/operational-metrics.mdx` and this document.
At the published head, the handler already imports the annotation helper at
line 18. Its only two changes wrap the existing final `fail(...)` Responses
at lines 137 and 149 with `annotateClientAdmissionFailure(..., "policy")`.
There are no other production edits, new labels, state, timers or imports.

The first return follows the existing background/non-account-bound batch
eligibility check at lines 135–137; the second follows the direct-session
check at lines 147–149. Both are local final refusals before provider
selection. `nativeDirectSessionAllowed` at `nativeUsage.js:86–94` rejects
configured daily, lifetime token/cost or positive window caps, and malformed
policy. It does not ask whether those allowances have been spent. These are
configured eligibility restrictions (`policy`), not exhaustion (`client_limit`).
Malformed policy on these public requests normally selects the earlier
model-policy denial at `nativeProvider.js:113–115`; the draft preserves and
tests that earlier outcome instead of forcing eligibility to run.
The weak annotation alone never increments a counter. Body/status/headers,
branch order, auth, dispatch, ownership, billing and cancellation stay unchanged.

The 46 new regression cases use real public native background, native batch,
native session and all four public realtime/live session alias handlers.
They cover EOF exactly-once, unread then cancel, request abort, configured
unspent/zero caps, prior missing/invalid auth and model/malformed policy,
eligible session success, upstream 403 and no-dispatch/wire controls.
Only the existing provider transport mock is used for eligible upstream cases;
the Anthropic batch refusal requires no provider mock or connection.
Internal discarded shared-handler refusals and actual realtime auth/native
control responses must not add phantom client observations.

Native routes have no HEAD handler and these two producers always return JSON
bodies. Three explicitly named observer-contract adapters therefore retain a
real selected eligibility cell for HEAD, bodyless and body-error cases; they
do not claim those are additional public native exports or producer shapes.
HEAD retains the actual selected Response/body unread and counts at return;
bodyless selection uses the existing weak-cell copy API; an errored replacement
body contributes zero admission failures. All prior assertions remain intact.
The initial LIGHT phase ran no candidate imports, tests, installs, lint,
build, hooks, DB/provider commands or publication. The later authorized
ordinary-author results below apply to the unchanged app/test inputs.
Fresh exact-head review and the independent full checkpoint remain required.
Native owner/billing/epoch,
opaque resource ownership, middleware, provider-capacity, WebSocket, keepalive
and runtime-bootstrap acceptance remains unresolved; this patch closes none
of those gaps by exclusion.

### Native increment ordinary-author evidence

The new isolated root is `/private/tmp/dd1656-native-author-l473vs5v`.
Its initial four-path patch SHA-256 is
`ad00d16e0cb0e06b3a7a607e41629c566e1ef4be4cec1f30cb3db10a572e5d55`;
initial source-manifest SHA-256 is
`a4d4d465bbf2a5d2c9dee43322ee4620a96deff7f6ff335eef6b0dda8f22f6e3`.
This evidence narrative supersedes only that initial internal-document input;
the production diff remains exactly the two return wrappers and all app/test
inputs remain unchanged. Per-command manifests freeze 5,127 tracked inputs.

Fresh private Node 26.13.0/ABI 147, newly acquired scripts-disabled root/test/
commitlint dependencies and an explicit offline native addon rebuild/smoke
were used. Every candidate launch first proved actual parent and spawned-child
external TCP and real-home synthetic read/write `EPERM`, using the same
`sandbox-exec`/`env -i` path and private HOME/DATA/cache/reports. Commands have
a 295-second ceiling including termination, at most two fork workers, unchanged
test deadlines and an empty failure baseline. No shared dependency pool or
real user database/provider credentials were used.

Attempt 09 passed all 281 admission assertions, including the 46 additions,
without fixture corrections. Attempt 11 then used exact 82873802 production
with that identical tracked test file: 17 expected missing selected-`policy`
counts failed and 264 passed. All 235 prior assertions and 29 new negative or
preceding-outcome controls passed; this was not a setup failure. Raw stderr
shows expected policy 1 versus actual 0. Both return annotations were restored
before attempt 13, which passed 4,000 assertions across all 66 explicit mapped
files, with no skipped/failed assertions. Fresh JSON/JUnit agree and the exact
selector inventory is retained in `mapped-tests.json`/`caller-inventory.json`.
The owned metrics, native/provider/session, resource/auth, window limits,
identity/usage, keepalive, correlation and security callers are included.
No socket/WebSocket protocol test inventory was expanded.

Mapped stderr retains 39 Kimchi dynamic-import errors, 31 stale-billing-epoch
save rejections and nine native validation/missing-totals error-control save
diagnostics. These are not suppressed. This is ordinary-author regression
evidence, without clean-runtime or full-gate approval. Evidence-helper attempts
are also retained: an initial compact-JSON classifier assertion, an incorrect
save-log literal tally and a later overly narrow all-stale classifier. The
corrected receipt separates all five actual save-diagnostic messages; no test
or raw report was changed. The Python metadata helper's xcrun cache `EPERM`
diagnostics are retained too. App builds, PG, real providers, trusted gate,
review/approval and merge remain unrun. Mandatory lint/hooks/commitlint and
exact publication binding are recorded in the retained author receipts and PR.

### Middleware proposal only: ownership and proof still required

The minimal future production ownership request is:

| Path at published `82873802` | Proposed exact responsibility |
| --- | --- |
| `src/dashboardGuard.js:668–678` | Mark only the two final public-LLM auth 401 Responses after the existing access decision fails; use existing candidate presence (`:219–229`) to distinguish `auth_missing`/`auth_invalid`, never annotate candidate evaluation or alter authorization |
| `src/proxy.js:117–121` and `:169–170` | Copy the weak cell through MiMo's existing Response reconstruction; await the existing final normal/MiMo result and observe only a marked public-auth denial once, after that selection |
| `open-sse/services/operationalMetrics.js` | Add a narrow marked-only terminal observer using existing state and fixed reasons, with a NextResponse-preserving reconstruction contract; return unmarked Responses unchanged |
| Proposed `tests/unit/operational-metrics-proxy.test.js` | Exercise the real guard/proxy and NextResponse, with provider work excluded; existing auth/MiMo callers must also remain in the eventual selection |

The existing access decision at `dashboardGuard.js:284–303` accepts local,
CLI, valid candidate keys and narrowly permitted safe dashboard model reads.
All those checks remain in their current order. Only a final denied result is
eligible for marking; management, gateway, CSRF, malformed-path 400, redirects,
preflight, `NextResponse.next()` and rewrites are outside this proposal.
Do not wrap all proxy results. Accepted traffic must reach the existing route
observation exactly once. Preserve NextResponse/cookies, body identity where
required, HEAD, backpressure and cancellation without eager body consumption.
The selected-return call belongs after normal/MiMo resolution at the two final
proxy returns, not inside `guardedApiDispatch` or `mimoLoginProxy`; those shared
branches must not start a second observation. The current boolean access API
need not change to report credential selection. The existing HTTP observer
reconstructs a plain Response for a streamed body, so blindly calling it is
insufficient for NextResponse fidelity. The future adapter must preserve that
type and cookie behavior while sharing the existing terminal accounting;
its exact reconstruction needs real NextResponse tests and emitted-mode proof.
No new helper is implemented speculatively in this eligibility patch.

The coordinator's runtime-owner feasibility report says pinned Next 16.4.3
selects the Server/Node proxy build (`get-page-static-info:598–607`,
`entries:280–282`) and invokes its Node adapter in process
(`next-server:1205–1231`). This supplied source evidence does not prove that
the emitted proxy and authenticated metrics scrape share state across bundles.
Before implementation, require an explicit one-writer handoff for those
three production files and exact integration fixtures, plus an authorized heavy
slot and artifact/build ownership. Before coverage claims, exercise the actual
emitted public denial followed by an authenticated scrape in the same worker,
then accepted traffic without duplicate observation, separately in dev,
production, standalone and packed CLI modes. Include both denial envelopes,
recovered credential candidates, cookies/MiMo reconstruction, HEAD/bodyless,
EOF/cancel/abort/error, preflight/rewrite and management negative controls.
Source/global unit tests alone cannot establish same-worker visibility.
Custom-server socket observation is broader and remains outside the proposal.
There are no middleware, proxy, custom-server or bootstrap edits in this draft.

## Historical Files/Batches and daily-limit increment

The previous published and independently reviewed PR #1656 snapshot is
`ef75f562894faf826b27f8b482a290b281626328`, based on
`f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46`. It extends the narrative-only
`e832eeb34290e557dbc5fba8685cc3f51b7b1d4d` publication. The coordinator reports
the independent source/evidence review found no actionable source defect and
verified all 393 current and 587 prior retained artifacts. This is neither
runtime approval nor the independently authorized full checkpoint.

The next Files/Batches, daily-limit and Ollama transfer changes extend that
published head. A separately authorized ordinary-author slot validated the new
source and regressions below. The published review does not cover this new
patch. Historical `d9fbe83b`, `dfb3f2f`, `e832eeb3` and `ef75f562` evidence
remains separate and unchanged. The earlier `dfb3f2f` source recheck resolved
the three original P2 findings; fresh exact-head review and the independently
authorized full checkpoint remain pending.

## Published 20-path increment: Files/Batches, daily limits and caller coverage

This increment reuses the existing weak Response annotations and the four
fixed labels. `operationalMetrics.js` is unchanged. Producers only mark a
Response; selected outer clean completion remains the sole counter owner.

`resourceOwnership.js` forwards `denialReason` only in its already-denied
internal result, mapping accepted `auth.reason` to `auth_missing` or
`auth_invalid`. Success objects, owner identity and credential selection stay
unchanged. The 15 existing final auth returns below annotate their actual
Responses with this bounded metadata; the existing wire text stays unchanged.
No reason is inferred from the generic 401 message or status.

| Exact route under `src/app/api/v1/` | Existing auth-denial exports |
| --- | --- |
| `files/route.js` | GET, POST |
| `files/[id]/route.js` | HEAD, GET, DELETE |
| `files/[id]/content/route.js` | GET |
| `batches/route.js` | GET, POST |
| `batches/[id]/route.js` | GET |
| `batches/[id]/cancel/route.js` | POST |
| `messages/batches/route.js` | GET, POST |
| `messages/batches/[id]/route.js` | GET |
| `messages/batches/[id]/cancel/route.js` | POST |
| `messages/batches/[id]/results/route.js` | GET |

The three collection HEAD handlers remain unauthenticated 200 responses.
OPTIONS, foreign/missing 404s, list filtering, validation 400/415, pending 409,
provider/service catches and output-row errors are unchanged and unannotated.
Foreign-owner refusals need an explicit service-result signal before they can
be distinguished from missing resources without exposing their existence.
`localFilesBatches.js` and ownership/DB authority remain outside this grant.

The sole chat edit wraps the existing selected daily-token 429 at published
`chat.js:470` with `client_limit`. `nativeUsage.js` adds the same annotation at
its existing daily-denial Response construction. Native provider and SystemOne
handlers pass that Response unchanged. `recordNativeUsage` also creates and
discards a daily-denial Response after committing usage; that candidate is not
a selected client outcome and contributes zero. No settlement, write, epoch,
limit authority, dispatch order or protected chat/fusion logic changes.

Coverage discovery also found `api/chat/route.js` transforms the chosen chat
Response into a new Ollama NDJSON Response. The separately granted import and
final-return wrap copy its existing weak selection to that transformed Response.
The converter, await/synchronous behavior, headers, status and framing stay
unchanged. This is a newly discovered metadata-transfer gap, separate from the
nonblocking source verdict on the earlier published scope.

Exact new patch inventory: the 10 route paths above; `src/sse/services/resourceOwnership.js`;
`src/sse/handlers/chat.js`; `src/sse/services/nativeUsage.js`;
`src/app/api/v1/api/chat/route.js`; the four existing tests
`tests/unit/{operational-metrics-admission,operational-metrics-http-boundary,operational-metrics-runtime,resource-ownership}.test.js`;
this document; and `docs/operations/operational-metrics.mdx`. These are 20 owned
paths. No new module or test file is introduced. Runtime-test additions are
limited to pending weak-cell reload and marked bodyless non-HEAD completion.

New-producer regressions cover all 15 final resource auth returns for
missing/invalid credentials; exact success/denied ownership-result shapes;
recovered alternate credentials, local/operator success and unchanged HEAD/
OPTIONS; actual implicit HEAD denial with its returned body unread; selected
chat/native/SystemOne daily denial EOF versus cancel/abort; a post-commit
discarded daily check; and real default-executor daily 429 rows without phantom
client counts. A missing daily-query table is renamed/restored only inside the
fixture's private database to exercise the actual unannotated 503;
foreign/missing 404, filtering, validation and in-progress results 409 remain
negative controls. The database operation ran only in the isolated fixture
during the later authorized ordinary-author slot.

Separate ef75 P3 coverage additions use literal lazy real-route imports for
the annotated shared auth returns, polling/actions, native GET/POST/DELETE,
public realtime HTTP aliases, legacy/Gemini and Ollama. Missing/invalid EOF and
cancel cases assert status, wire format and no provider dispatch. Actual public
Messages/Responses delayed tests hold only the input Request's original JSON
read, then release it into the real handler/auth/policy path. They retain the
actual threshold, frames and headers and distinguish clean EOF from request
signal abort after the denial frame was enqueued. Existing assertions and
provider-only mock boundaries remain; no shared handler is mocked. The two
runtime additions check a pending selection surviving reload before EOF exactly
once and marked bodyless non-HEAD completion at return. Their new ordinary-author
results are recorded below; no pass is inherited from ef75.

Public realtime credential/session HTTP auth/policy is already integrated
through `handleOpenAINativeSession` and the native public wrappers. At the
published 82873802 head, eligibility 403s were still pending; the new LIGHT
section above records their narrowly granted draft. Native owner/billing/epoch
refusals still need separate exact return ownership. Internal realtime auth/native controls and model rechecks
drive WebSocket errors/closures; weak metadata cannot cross loopback fetch/JSON
and those control calls cannot stand in for public HTTP client outcomes. The
WebSocket fallback issues actual loopback chat HTTP calls per turn; existing
handler totals see those HTTP calls, not WebSocket sessions. Client-origin
attribution and WebSocket metrics need their own approved boundary contract.

Middleware remains unresolved: `dashboardGuard.js:668-678` selects the remote
public-LLM credential denial before an observed handler. Its existing candidate
list can distinguish missing/all-invalid only after the existing access checks.
`proxy.js` can rebuild that Response while clearing a login cookie. A future
one-writer integration must preserve NextResponse/cookie/wire behavior and prove
runtime/bundle state visibility and actual terminal observation. Wrapping all
proxy results would miscount pass-through/rewrite responses; importing the Node
helper without that evidence is not authorized. Management/CSRF/gateway/control
denials are different domains, not reasons inferred from 401/403. No middleware,
custom-server, bootstrap, updater, auth-authority, DB, provider-capacity or fusion
edits are included. These remaining acceptance items are not waived.

The coordinator supplied the ef75 review path
`/var/folders/tw/_vvy7bzd4zd07mg54rph6kh00000gn/T/dd1656-independent-review-cv398f1v/review.md`
and verified SHA-256
`87ae62d6b0efd416b3e2e9252d185589aefa014fa4acd37aa9375fd29f7728ea`.
No reviewer was contacted or polled for this draft. Fresh exact-patch validation,
review and the independent full checkpoint remain required before readiness.

### New increment ordinary-author evidence

The exclusive author slot uses a new private root,
`/private/tmp/dd1656-resources-li5bm5a2`, separate from every sealed historical
attempt. Initial LIGHT patch SHA-256 was
`bc314a16b23a00a27ad80faa691432a3ca760782bd620f9d34854e0e26c76e6b`;
its source-manifest SHA-256 was
`adb2e6b49cd9aff41e9da41567a5b1089c079888994285784ee4e53fce1a781e`.
One owned fixture correction below and this evidence narrative supersede those
initial source hashes. Per-command inputs and final commit binding record the
actual validated sources; the initial snapshot remains retained.

Fresh scripts-disabled acquisitions installed root/test/commitlint dependencies
into that root. The private Node 26.13.0 process and its spawned child both
proved ABI 147, unprivileged uid 501 and actual external TCP plus synthetic
real-home read/write `EPERM` before candidate imports on the same explicit
`sandbox-exec`/`env -i` launch path. Every offline candidate command repeats that
proof, uses private HOME/DATA/cache/reports and has a 295-second hard ceiling.
The native addon was rebuilt offline and passed its ABI smoke; no old dependency
installation was reused. Vitest retained its deadlines and used two fork workers.

- Attempt 08: 296 pass, four fail, zero skipped. The new Gemini native-TTS
  matrix incorrectly expected `x-request-id`. Its actual auth Response retains
  no such header. The fixture now asserts that absence explicitly for native/
  native-TTS, preserving the production identity/wire contract. The unread-body
  cleanup assertions also failed on those early assertion failures and remain
  in the raw diagnostics. No production correction was needed.
- Attempt 09: all 300 tests across the four owned files pass, zero skipped,
  with the corrected fixture. Its old failed source and report remain retained.
- Attempt 10: exact ef75 production bytes with the same new tracked regression
  fixtures produce 48 expected failures and 252 passes, zero skipped. The
  failures are 30 selected resource counts, three selected daily counts, two
  Ollama transfer counts, one implicit-HEAD denial count and 12 denied-result
  metadata expectations. Separately, all 139 ef75 P3 coverage guards already
  pass. This control is not reported as a successful validation run.
- Attempt 11: all 3,858 tests across the exact 53-file mapped selection pass,
  zero skipped. All four owned files and the mapped Files/Batches, resource,
  native usage/session, epoch, auth/security, keepalive, Messages/Responses,
  Ollama, legacy, Gemini, correlation and metrics callers are included. JSON
  and JUnit agree; literal selectors are complete and unique; the baseline is
  empty; all tracked source inputs remain unchanged during the command. JSON
  SHA-256 is `2ceb982f0e138379a70d7974cb8d6c88f1b01bdde8b46dcd7a39593259c0319d`.

Attempt 11 retains 29 `[KimchiUA Error]` dynamic-import diagnostics and 30 expected
stale-billing-epoch save rejections from the expanded epoch callers. The new
missing-table and deliberately malformed/failing cases retain their actual logs.
These passing assertions do not establish clean runtime readiness. No baseline,
timeout, worker limit, production authority or provider boundary was weakened.
No private test file is counted as a tracked test. The socket-based WebSocket
protocol suite remains separate from these HTTP annotations; its loopback-server
needs do not authorize relaxing this offline sandbox. Middleware and built-mode
scrape projection, bootstrap, remaining producers, overhead, fresh exact-head
review and the owner-run full checkpoint remain open. No review, approval,
status, trusted gate or merge was performed in this author slot.

Root lint in attempt 13 passes with zero errors and 327 existing warnings;
anti-slop reports zero diagnostics across 2,581 files. Its generated plugin
bundle is retained as an output and restored to the canonical input before
staging. Required changed-JavaScript/docs checks, the actual inner lint-staged
run, unchanged mandatory hook and title/exact-range commitlint are recorded in
the same evidence root and bound to the final source tree before publication.

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
| Counters, histograms, gauges and bounded labels | Metrics route, queue gauge | Client HTTP observations with fixed terminal outcomes and latency buckets; gate timeout/abort counts; selected client-denial increment with four fixed reasons; cached provider connection states; remaining admission producers still require integration |
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
additive recorder call after that owner's lifecycle fix lands. The subsequent
admission grant permits only weak denial annotations at the listed final auth
Response returns, policy/limit Response construction and explicit delayed
keepalive selection. `auth.js` credential evaluation remains read-only.
Other chat, combo, native/media/stream behavior, DB, registry, updater, gate
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

This integration now starts from the Node bootstrap. Keep the existing
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

The bootstrap integration and its proposed test require independent review and
execution on the updated head. Required proof includes real Node register-to-start, Edge/module
evaluation without drift timer, real unref/process exit, no reset on reads,
failure/retry, route-first/start-first/HMR reuse, existing Kimchi/Headroom
lifecycle checks and independent updated-head app/website/CLI/standalone/packed
artifact coverage. #1652's old evidence cannot establish this draft's readiness.

## Published ef75 admission discovery and integration

The following producer inventory, pending list and ordinary-author evidence
describe the published ef75 increment. The next LIGHT patch and its remaining
acceptance are recorded separately above; none of these passes validates it.

The original discovery below used published `e832eeb3` source positions. It
identified actual denial Responses separately from credential candidates and
provider attempts. This increment adds the assigned local producers only.
Existing gate telemetry still counts concurrency timeout and abort rejections
separately. HTTP status 401/403/429 alone cannot identify a local admission
denial. Providers also return those statuses, and a rejected candidate may be
followed by successful fallback.

| Existing bounded source | Exact integration point to consider after assignment | Counting boundary |
| --- | --- | --- |
| Credential evaluation has `ok` plus `missing`/`invalid`, with local optional-auth behavior | `src/sse/services/auth.js:1649-1662,1680-1690`; actual client return in `src/sse/handlers/chat.js:436-443`, native provider `:60`, image `:55`, TTS `:48`, STT `:45`, embeddings `:53-58` | Mark the selected client rejection, not each credential candidate; realtime operator bypass means `resolveClientApiKey` failure alone is not proof of a denial |
| Invalid policy, model allowlist/access, lifetime token/cost limits | `src/sse/services/apiKeyPolicy.js:126-204` at existing denial Response construction | Associate a fixed reason with that Response, without incrementing there; vision-bridge rejection in chat `:927-929` deliberately keeps the original model |
| Per-Request window/RPM/TPM check, existing checked-Request WeakSet | `src/lib/apiKeyLimits.js:160-175` at its returned limit Response; chat `:475-476` is the outer use | Preserve rate accounting and fail-open query behavior; do not count quota queries, checked calls or successful requests as failures |
| Daily key token limit | Chat `:454-469`; `src/sse/services/nativeUsage.js:78-82`, called by native provider `:137-138` | Mark actual denial Response with a fixed `client_limit` reason; no token totals or key identifiers in telemetry |
| Provider selection returns `providerDisabled`, `allRateLimited`; quota capacity has typed code `QUOTA_DISPATCH_UNAVAILABLE` | `src/sse/services/auth.js:530-539,677-683,763-769`; chat final selection `:1091-1145`; native provider `:176-177`; `open-sse/handlers/chatCore.js:369-373,1372-1376,1498-1502,1511-1515` | Selection/dispatch failures are candidate/attempt evidence until the outer handler chooses the final result; map typed local capacity to one constant, never export arbitrary `error.reason` |

Assigned integration:

1. `open-sse/services/operationalMetrics.js` reuses the existing global state
   with additive HMR initialization for four counters and a weak Response map.
   Each entry holds an opaque selection cell with one fixed reason. Only
   `auth_missing`, `auth_invalid`, `policy` and `client_limit` are accepted.
   No headers, payload fields, IDs or routing decisions carry this metadata.
2. Actual auth-denial returns are annotated after credential selection.
   `resolveClientApiKey` returns an auth result, not a Response, so `auth.js`
   stays unchanged. Rejected credentials followed by a valid candidate and
   operator bypass are not annotated. Model-policy denials are `policy`;
   lifetime token/cost and window/RPM/TPM denials are `client_limit`.
3. `correlateResponse` copies the same cell through both JSON-error and ordinary
   Response reconstruction. Only clean terminal observation of the selected
   outer client Response increments the separate client-admission series.
   HEAD/bodyless Responses finish at handler return without reading their
   bodies. Abort, cancellation, body error and escaping handler error add zero.
   An unread non-HEAD denial stays pending until terminal observation.
4. Delayed keepalive binds a fresh cell to its output HTTP 200. The producer
   copies only the chosen annotated denial's reason after successful in-band
   enqueue. A failed denial-body read retains the existing fallback bytes but
   transfers no reason. This cell is attached to that output, never to the
   entire async context. Cancellation even after enqueue contributes zero;
   only clean outer EOF counts. Fast-path Responses remain unchanged.

The Gemini JSON/SSE converters return non-success Responses unchanged, as does
legacy completions, so denial metadata survives those transformations without
editing either bridge. Their real derived Requests still share only their
explicit outer observation. Independent nested Requests remain independent.
Internal default batch rows use correlation alone and cannot create a client
denial, even when their policy/auth Responses are consumed by the executor.

Exact 26-path admission inventory:

- Core and transfer: `open-sse/services/operationalMetrics.js`,
  `src/sse/utils/requestCorrelation.js`,
  `open-sse/utils/earlyStreamKeepalive.js`.
- Denial producers: `src/sse/services/apiKeyPolicy.js`,
  `src/lib/apiKeyLimits.js`; imports and existing final auth returns only in
  `src/sse/handlers/{chat,nativeProvider,embeddings,imageGeneration,imageEdit,tts,stt,music,video,rerank,search,fetch,moderations,systemone,countTokens}.js`;
  native TTS auth returns in `src/app/api/v1beta/models/[...path]/route.js`.
- Regressions: `tests/unit/operational-metrics-admission.test.js`,
  `tests/unit/operational-metrics-runtime.test.js`,
  `tests/unit/operational-metrics-http-boundary.test.js`. The existing runtime
  privacy assertion adds only the four literal reason labels and retains strict
  equality. The existing boundary fixture uses narrow real repositories and
  literal lazy route imports, preserving all assertions, provider-only mock
  boundaries and the configured timeouts and worker cap.
- Docs: this file and `docs/operations/operational-metrics.mdx`.

The added imports are on existing server handlers and Node routes. Source
search found no Edge runtime declaration among their API consumers. The keys
usage management route also imports `apiKeyLimits.js`; its read-only status
path does not annotate or count denials. No additional sampler or runtime
bootstrap is started by the new producer imports. Artifact/runtime support
still requires authorized validation.

Regression coverage includes optional auth and valid CLI/operator bypass;
multiple credential candidates; denied vision bridge with successful original
model; same-Request limit reuse; intentional client abort; final native/media/
chat denial; and denial after early keepalive. Selected provider/capacity and
daily-limit producer coverage remains pending below. No policy enforcement,
credential selection, allowance mutation, quota settlement or retry changes are
part of this increment. The new test exercises actual public decorators,
credential selection, policy/limits, recovered vision denial, default batch
execution, legacy derivation, Gemini parse/native TTS denial, delayed EOF/cancel/
body error, HEAD unread-body accounting and fixed labels. No mocks replace
auth/policy/correlation; only provider work is replaced. Private ordinary-author
execution is recorded separately below and does not establish hosted behavior.

Pending producers remain mandatory issue acceptance, not waived exclusions:
direct Files/Batches ownership denial Responses; realtime credential/auth
denials; pre-handler middleware denials; legacy daily-token denial in chat and
`nativeUsage.js`; selected provider-unavailable and quota-capacity results in
protected chat/combo/native paths. Upstream 429/503 and candidate capacity
signals are not client denials. Those hooks need separate exact ownership.
Startup integration, complete HTTP lifecycle gaps, overhead, fresh independent
head review and the owner-run full checkpoint remain open. Old `dfb3f2f` test
results cannot establish this draft's behavior. WebSocket sessions remain a
separate protocol and are
explicitly excluded from the HTTP contract, not fabricated as HTTP coverage.

## Admission increment ordinary-author evidence

Parent: `e832eeb34290e557dbc5fba8685cc3f51b7b1d4d`. PR base:
`f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46`. This series is retained at
`/private/tmp/dd1656-admission-y9yajk1i`; its numbered attempt names belong to
this admission series only. Neither original nor correction evidence is reused
as new-head runtime proof.

Every candidate command used a fresh private Node 26.13.0 copy, ABI 147,
with an `env -i` allowlist and an explicit OS sandbox on the same launch path.
Before candidate imports, both parent and spawned child attempted external TCP
and synthetic outside-home reads/writes; all three operations returned EPERM.
Private dependencies were acquired with scripts disabled: 783 root packages,
61 test packages and 176 pinned commitlint-tool packages. An explicit offline
native SQLite rebuild and in-memory smoke verified the new binary on ABI 147.
No previous dependency tree was reused. HOME, DATA_DIR, cache, temporary files
and reports stayed private. Commands retained a ceiling below 300 seconds
including termination, and focused Vitest commands kept `--maxWorkers=2` with
forks. The failure baseline, timeouts, loader and concurrency policy are unchanged.

| Attempt | Result and interpretation |
| --- | --- |
| 08, 10, 14, 17 | Exact old `e832eeb3` application source reproduced 14 missing selected-denial counts, with 3 passes; 20 other cases were outside the old-head selector. Attempt 17 uses the final fixture. |
| 09 | 35/37 passed. The provider fixture did not honor upstream streaming and the double-correlation assertion omitted the existing `upstream_request_id` behavior. Both fixture assumptions were corrected. |
| 11, 13, 15 | Setup exceeded the unchanged 10-second hook limit; no assertions executed. Narrow repository setup and lazy real-route imports remove the eager fixture dependency. |
| 12 | Variable dynamic imports failed resolution. Literal lazy imports replaced them. This is failed fixture evidence, not denial-count proof. |
| 16 | 36/37 passed. Phase timings identified setup costs; the remaining fixture assertion confused internal upstream streaming with the final requested JSON response. The unconsumed failed assertion also triggered the active-count cleanup guard. |
| 18 | All 37 new admission assertions passed, with no skips, before the two existing-test corrections were added to the inventory. |
| 21 | Failed mapped run: 404 passed, 1 strict label assertion failed, 12 did not execute because the old boundary fixture timed out. This is retained failed evidence. |
| 22 | All 3,071 assertions in the separate 15-file admission/security caller selection passed before the two test corrections. |
| 23 | Both corrected existing files passed all 42 assertions against the frozen 26-path source. |
| 24 | Final combined selection: all 3,525 repository assertions across 39 files passed, zero skipped, against the frozen 26-path application/test/config inputs. |

Attempt 24 raw output retains **19 Kimchi errors** and **four expected stale
billing epoch errors**. No error output was suppressed. Assertion success is
not a clean-runtime or full-checkpoint claim. The prior `dfb3f2f` series still
has its separate 417-assertion result with 10 Kimchi and four expected stale
epoch errors; those historical figures are not replaced by this series.

Root lint passed with zero errors and 327 existing warnings; anti-slop reported
zero diagnostics. Per-command before/after source/test/config hashes, raw
stdout/stderr, JSON/JUnit, timestamps and exits are retained. Final publication
requires docs checks, changed-file ESLint, actual staged inner lint-staged,
the unchanged mandatory hook, and exact base-to-head/title commitlint. Their
receipts and the final commit/tree binding belong to this same artifact series.
Only documentation may change after the successful application/test inputs;
those final docs need their own current check. No gate/boundary runner, real
provider/DB, bootstrap, server, deployment, status, approval or merge action is
part of this ordinary-author evidence.

## Original author validation plan and evidence

The original validation plan required regressions to exercise the actual correlation wrapper and metrics
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

- Original attempt 07: 31 passed, one failed. The formatter omitted a final newline;
  the HTTP route already supplied one. The one-line formatter correction makes
  the helper's standalone text complete. Original attempt 09: all 32 focused tests passed.
- Original attempt 08: comparison started before its private source/dependency copy
  finished and failed before collection with MODULE_NOT_FOUND. It is retained,
  not counted as a regression result. After copy completion, original attempt 10's single
  actual-wrapper/scrape comparison failed on the exact base because the client
  request counter was absent, as expected.
- Original attempt 11: 201 assertions passed across 11 caller/fixture files, including
  the same wrapper/scrape comparison on the candidate. Seven Kimchi dynamic-import
  errors appeared in stderr, despite exit 0, alongside four expected stale-epoch
  save rejections. These separate diagnostics are retained and
  prevent calling the caller run clean runtime evidence. Protected Kimchi source
  was not changed or suppressed.
- Original attempt 12: 51 assertions passed on the unchanged base's two diagnostic
  fixtures and reproduced the same Kimchi error origin. This attributes the
  protected-source diagnostic; it does not make it clean validation evidence.
- Original attempt 13: root lint failed the new observer's `typeof` guard under the
  existing anti-slop rule. The observer now uses the repository's existing
  `isObject` and `isFunction` helpers. Original attempt 14 passed root lint with zero
  errors and 327 existing warnings, plus zero anti-slop diagnostics. Original attempt 15
  passed changed-code ESLint with `--max-warnings=0`.
- Original attempt 16: 233 assertions passed across 15 files, zero skipped. This includes
  232 checked-in tests and the private retained before/after fixture. The final
  run logged seven Kimchi dynamic-import errors and expected stale-billing-epoch
  rejection diagnostics from the native identity fixture's rejection assertions.
  All diagnostics remain retained. Passing assertions are not a clean runtime
  run, full coverage, an independent review or an authorized gate result.

## Independent review corrections in LIGHT

The source/evidence review at
`/var/folders/tw/_vvy7bzd4zd07mg54rph6kh00000gn/T/dd1656-light-review-wcpdjd5s`
identified three P2 source defects and one P3 narrative error at `d9fbe83b`. All 29 review-manifest entries match their recorded sizes and hashes.
The original review and author artifacts remain untouched. Reading retained raw
original attempt 11 stderr confirms seven Kimchi entries and four stale-epoch save
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

At the time this inventory was frozen, the three P2 findings awaited validation,
publication and independent recheck; the published head was `d9fbe83b`.
The correction was subsequently published at `dfb3f2f` and the independent
source recheck found those defects resolved. P3's narrative was corrected without
changing historical artifacts. No correction execution preceded this inventory.
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
correction acquisition attempt 03's first input-root manifest was incorrect for nested
`tests/`; that harness defect is recorded and fixed before application runs.
Acquisition is not presented as application validation. All attempts remain.

- Correction attempt 06 reproduced both phantom batch counters on exact old `d9fbe83b`
  with the new boundary fixture copied into that comparison tree. It used only
  machine reporters and cannot support a raw diagnostic absence claim.
- Correction attempt 07 added the default reporter, preserved raw diagnostics, and exposed
  an absolute-zero test teardown assertion that cascaded HEAD's leaked active
  state into later cases. Teardown now requires zero per-case active delta;
  the HEAD behavior assertion itself still fails on the old head. Neither early
  correction attempt is substituted for final comparison evidence.
- Correction attempt 09 runs the identical corrected fixture on exact old source: eight
  expected failures, three passes. One newly introduced decorator-only case is
  deliberately outside the old-head selector because that API does not exist
  there. Actual legacy derivation and both SSE terminal cases already pass on
  the old head. The failures demonstrate two phantom batch-client cases, leaked
  unread HEAD, premature final Gemini JSON completion/cancellation, absent outer
  abort accounting and unobserved invalid-JSON/native-TTS branches.
- Correction attempt 08 on the correction passes all 42 boundary/runtime assertions, with
  zero skipped. It retains one inherited Kimchi import error.
- Correction attempt 10 passes 417 repository assertions across 23 files, zero skipped and
  no private fixture counted. It covers the reviewer-mapped native, batches,
  legacy, Gemini and correlation callers plus existing metrics/auth/queue,
  health, gate, native usage/identity, early keepalive and active-session tests.
  JSON SHA-256: `9f86c9c640f5fb00440834f830bc3b4c1af47f3f756d66adcef0f8a9e37cde28`.
  Raw stderr contains ten inherited Kimchi import errors and four expected
  stale-billing-epoch save rejections. The deliberate invalid-JSON test preserves
  Gemini's existing parse-error log. Passing assertions do not erase these
  diagnostics or establish clean runtime readiness.
- Correction attempt 11 passes root lint: zero errors, 327 existing warnings, anti-slop zero
  diagnostics. Its generated anti-slop bundle is retained as an output and
  excluded from the patch. Correction attempt 12 passes changed JavaScript ESLint with
  zero warnings. Docs, mandatory hook, title/range commitlint and final commit
  binding are recorded in this evidence root before normal publication.
- Correction attempt 14 staged correctly but macOS `/usr/bin/git` emitted denied xcrun
  cache writes outside the private home. Correction attempt 16 is not a hook pass:
  lint-staged reported no initial commit / failed staged-file lookup even though
  the hook's final anti-slop command returned zero. Both outputs remain. Private
  PATH now resolves directly to the installed CLT git binary, with its hash
  recorded; hook source/config and sandbox restrictions are unchanged. Correction attempt
  18 independently passes lint-staged for all 47 staged paths. Correction attempt 20 passed the complete
  mandatory hook on the final matching staged tree before publication.

The independent source-only recheck at `dfb3f2f` found the three original P2
findings resolved. This author evidence does not itself approve the correction.
P3's original-attempt-11 narrative is now seven Kimchi errors. Remaining issue acceptance
still includes unstarted bootstrap (#1652 handoff), protected denial/early
keepalive hooks, excluded metadata/artifact/middleware routes and WebSockets,
real process-exit/artifact/overhead proof, inherited runtime diagnostics and the
independently authorized full checkpoint. Refs #1129; this PR does not close it.
