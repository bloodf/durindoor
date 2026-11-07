# Connection circuit discovery and regression draft for #1108

Status: review findings addressed in source; runtime checks and final review pending.

`src/lib/routing/connectionRecovery.js` observes persisted fallback deadlines in
credential selection and claims an expired scope immediately before chat core
execution. Account-wide recovery excludes model probes. Claims are process-local.
ACL, quota, RPM, RPD, model-kind and media boundaries retain their existing order.
Successful core completion settles recovery after the existing success callback.
Abort, stream cancellation/end, thrown errors and unsuccessful core results release
claims without creating cooldown evidence. Existing fallback classification remains
authoritative, including the separate local-admission rejection short circuit.
A pinned account does not rotate when its recovery claim is busy.
Recovery exclusions return HTTP 503 without invented quota/reset evidence, including
pinned selection. Selection and dispatch consult pending in-memory scopes even if
healthy sibling-model success lazily deletes the persisted expired lock. A missing
lock is not an explicit reset; explicit `ConnectionCircuitManager.reset` separately
invalidates its lease generation. Local queue rejection uses PR #1665's actual core
marker and caller guard, integrated normally before this delivery. The handler test
covers sibling cleanup with real selection and a real core concurrency timeout.


The supplied helper hash was verified. Its expired-deadline admission, late
settlement and account/model exclusion defects were corrected with regression tests.

Discovery date: 2026-11-05. Local source head:
`f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46`.

Only this new internal document is changed. Initial discovery performed no
implementation, installation, test, lint, build, live-provider request, or
stored-data mutation. During discovery, the heavy slot was reserved for #1619;
the original handoff named PR #1653's independent reviewer. This task did not use
either reserved slot. Later docs-only author validation is recorded in the PR
and private evidence artifacts. No boundary review was attempted.

## Verified source and prior disposition

The [live issue](https://github.com/bloodf/durindoor/issues/1108) requires discovery
before implementation. Its [evaluation comment](https://github.com/bloodf/durindoor/issues/1108#issuecomment-6566196039)
records `PORT-LATER` and partial overlap with local cooldown, health-probe, and
Headroom code. Reading that comment does not change its disposition.

The pinned OmniRoute snapshot is reachable at
`61e07fb7e0d4e1e76111495d3718c9e4d06d2a62`. Public GitHub API responses now
redirect the original `diegosouzapw/OmniRoute` repository to
`cheaper-inference/OmniRoute`. The GitHub connector could not read the upstream
file or return usable PR metadata, so public raw-content and API reads supplied
the evidence below.

| Source | Verified behavior |
| --- | --- |
| [#14530](https://github.com/cheaper-inference/OmniRoute/pull/14530), merged as `18bbb101980c639cfabdc5663213836d917c3269` | Account failures use a connection breaker. Network failures retain the provider breaker. Combo gates check both scopes. The final diff also extracts model-access classification. |
| [#14949](https://github.com/cheaper-inference/OmniRoute/pull/14949), merged as `dbd62ec5f43ef2574bd22ed93a415b3f4d9d2271` | All-open pools in the shared non-round-robin attempt loop and weighted path receive circuit-specific exclusions and retry guidance. Round-robin retains generic `ALL_TARGETS_SKIPPED`; mixed exclusions remain generic. This is diagnostic behavior, not the recovery algorithm. |
| [Pinned connectionCircuitBreaker.ts](https://github.com/cheaper-inference/OmniRoute/blob/61e07fb7e0d4e1e76111495d3718c9e4d06d2a62/open-sse/services/connectionCircuitBreaker.ts) | Nineteen lines normalize provider aliases and choose connection or provider names. This file contains no state machine or recovery probe. |
| [Pinned circuitBreaker.ts](https://github.com/cheaper-inference/OmniRoute/blob/61e07fb7e0d4e1e76111495d3718c9e4d06d2a62/src/shared/utils/circuitBreaker.ts) | The separate 793-line utility owns `CLOSED`, `DEGRADED`, `OPEN`, and `HALF_OPEN`, database restore/persistence, probe allowance, generations, reset, and bounded transition history. `execute()` consumes the probe allowance before awaiting work. `canExecute()` only checks eligibility. |

A direct copy of the naming helper would add no missing behavior. Copying the
generic utility would introduce another cooldown policy and database lifecycle.
Neither is the smallest coherent local change.

## Local equivalents and remaining gaps

All local paths below describe the pinned local head, not newer integration work.
Existing tests were inspected as source only.

The main local evidence is [model/account lock precedence](https://github.com/bloodf/durindoor/blob/f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46/open-sse/services/accountFallback.js#L384-L422),
[selection and its mutex](https://github.com/bloodf/durindoor/blob/f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46/src/sse/services/auth.js#L562-L583),
[selection release](https://github.com/bloodf/durindoor/blob/f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46/src/sse/services/auth.js#L961-L966),
[monitor deduplication](https://github.com/bloodf/durindoor/blob/f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46/src/lib/healthMonitor.js#L250-L289),
and [manual clear fields](https://github.com/bloodf/durindoor/blob/f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46/src/app/api/providers/%5Bid%5D/route.js#L328-L331).

| Requirement | Existing local behavior | Remaining work |
| --- | --- | --- |
| Connection and model scope | `open-sse/services/accountFallback.js` checks exact and account-wide locks independently. `open-sse/services/fallbackScope.js` resolves catalog models and bounds unknown model strings to the account scope. `auth.js` consults raw and bounded scopes. | Preserve these identities. Do not create keys from arbitrary request model strings or widen every failure to a provider. |
| Open and recovery | `isModelLockActive()` rejects future deadlines. `getActiveModelLockUntil()` returns the later applicable deadline. Selection admits the connection when the relevant locks expire. Successful requests clear state through `clearAccountError()`, including expired locks for other non-isolated models on the same connection. | There is no connection recovery lease between expiry and the first settled request. Add explicit half-open admission without replacing cooldown computation. |
| Concurrent probes | `src/lib/healthMonitor.js` deduplicates ordinary concurrent payload builds through `pendingBuild` and caches for 60 seconds. Explicit forced builds bypass that shared promise. `providerHealthProbe.js` performs guarded, proxy-aware transport checks without DB state writes. | Monitor deduplication does not reserve an actual model request. A `/models` success cannot prove that a failed chat model recovered. Reuse the request path as the recovery attempt before adding background probe traffic. |
| Headroom | `open-sse/rtk/headroomCircuit.js` reports open and half-open state for the compression proxy. | This state is global to Headroom. It is unrelated to provider connections. Despite its one-probe comments, its getter and `headroom.js` call path do not reserve a probe before `fetch()`. Do not copy that admission pattern or expand this task to fix Headroom. |
| Unknown quota | `providerQuotaPreflight.js` keeps missing, stale, unknown, and tracker-error observations eligible. `tests/unit/provider-quota-preflight.test.js` records this contract. Fresh definitive blockers still exclude accounts. | Keep quota eligibility separate. Unknown quota must not open a circuit, and it must not clear an independently open circuit. |
| Manual reset | `PUT /api/providers/[id]` accepts only `rateLimitedUntil: null` and resets backoff. The repository separately clears model locks on an explicit `testStatus: "active"` activation. | Define how the existing reset invalidates a recovery lease and clears local cooldown evidence. A bare `rateLimitedUntil` clear does not currently clear all eligibility inputs. Preserve durable reauthentication and authoritative provider-quota blockers. |
| Request failures | `checkFallbackError()` excludes deterministic request errors, HTTP 499, and the `provider_request_rejected` marker. Chat excludes local stream lifecycle errors before fallback. Native Claude refusals avoid the empty-stream cooldown. | Consume the existing normalized classification. A new circuit must not reinterpret every rejected promise or non-2xx result as provider failure. |
| Late completions | `connectionsRepo.js` uses transactional fallback writes and scope timestamps to reject stale errors and successes. `clearAccountError()` delegates to those helpers. | Fence recovery completion and manual reset by lease generation too. Preserve existing DB ordering. An in-memory token cannot replace a transactional cross-process claim. |

The local selection mutex is released when credential selection finishes. It
does not cover the subsequent provider request. Sequential selection turns can
therefore admit several callers after expiry while the first request is pending.
This is a source-derived reproduction hypothesis, not an executed reproduction.

Existing cross-model cleanup also matters: [connectionsRepo.js](https://github.com/bloodf/durindoor/blob/f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46/src/lib/db/repos/connectionsRepo.js#L633-L637)
and the [auth compatibility path](https://github.com/bloodf/durindoor/blob/f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46/src/sse/services/auth.js#L1563-L1571)
can remove an expired failed-model lock when another model succeeds. A future
per-model recovery claim needs evidence that survives that cleanup, if the
integration owner adopts the proposed model-specific policy below. This is a
source-derived gap, not an executed reproduction or an approved storage change.

Coherent refusals are distinct from request errors. The existing [nonstreaming
native refusal path](https://github.com/bloodf/durindoor/blob/f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46/open-sse/handlers/chatCore/nonStreamingHandler.js#L648-L687)
accepts a finished turn and reaches the trusted success callback and
[`clearAccountError()`](https://github.com/bloodf/durindoor/blob/f0c21bf6ef2e8c7baaaadeaa96be5491815a9c46/src/sse/handlers/chat.js#L1330-L1338).
This draft proposes preserving that success
lifecycle when it is reached; it does not require every refusal to remain neutral.
Streaming refusal completion still needs verification against its actual trusted
terminal path. A different neutral-refusal policy would require an explicit
owner decision and reconciliation with existing cleanup.

## Smallest coherent implementation proposal

The proposed change adds recovery admission around the current fallback state.
It does not add a second failure threshold, backoff algorithm, provider-wide
network breaker, periodic probe service, registry option, or schema migration.
The existing classifier and computed cooldown remain authoritative.

1. Derive `healthy`, `open`, and `half-open` from the applicable local failure
   lifecycle. A never-failed connection starts healthy. Active cooldown means
   open. After a failure's cooldown expires, recovery requires one claimed
   attempt. Read-only eligibility and diagnostics must not consume that claim.
   Proposed policy: success on another model does not prove recovery of this
   failed model. Existing cross-model cleanup can erase its expired lock;
   preserving pending-recovery evidence therefore requires an explicit
   caller/DB-owner decision, rather than inferring it from remaining locks.
2. Claim recovery only for the selected connection and bounded scope. Preserve
   account-wide precedence across models. An account-wide recovery lease must
   exclude competing model attempts on that account. Do not hold a claim for
   an unselected candidate. Release it if credential refresh, admission, or
   cancellation prevents dispatch. Continue to apply auth restrictions, strict
   pins, RPM, quota, and concurrency reservations.
3. Settle exactly once at the existing trustworthy response lifecycle point.
   HTTP 200 headers alone do not establish stream success. A successful current
   attempt closes recovery. A classified provider failure uses the existing
   cooldown and reopens recovery. A local abort or request rejection releases
   the lease without incrementing failure state or declaring recovery.
4. Give each claim an opaque generation. Manual reset, a newer failure, or
   bounded lease expiry invalidates older completions. Cancellation must reach
   dispatch before a replacement probe starts. If upstream work cannot be
   cancelled, document that only one current lease is guaranteed, rather than
   claiming only one physical request can remain in flight.
5. Expose only allowlisted diagnostic fields: `state`, `scope`, `probeInFlight`,
   and finite `retryAfterMs` when known. Use existing bounded public identifiers
   where needed. Do not include credentials, URLs, error bodies, arbitrary model
   text, lease tokens, or unbounded transition history. Circuit exclusions must
   not masquerade as quota exhaustion or fabricated provider reset evidence.

A small transition helper is justified only after a caller contract is assigned.
If needed, the proposed new file is
`open-sse/services/connectionCircuitState.js`. It would contain transitions and
claim validation, with injected time and no DB, provider, or network imports.
No unused runtime module has been added during discovery.

The process-scope choice is also unresolved. A process-local lease cannot
deduplicate recovery across gateway processes. For a global guarantee, the DB
owner must provide a transactional claim using the existing adapter and fallback
ordering contracts. This requires a separately assigned repository API and
cross-engine evidence. A process-local first version needs an explicit scope
decision from the integration owner. Neither design is approved by this draft.

## Minimum real-caller experiment (2026-11-07)

Compared with local `origin/main` at `044632eb8bc4cd51a65340fb6c87100879969e70`,
the connection-circuit implementation and proposed test file are absent. The
main tree does contain the unrelated Headroom circuit. In main's chat handler,
`getProviderCredentialsWithQuotaPreflight()` selects credentials before
`handleChatCore()` dispatches; `getProviderCredentials()` releases its
provider-scoped selection mutex when selection returns. This supports a race
hypothesis, not proof that concurrent requests actually reach the provider.

Start with one offline test through the exported `handleChat` caller, using
synthetic connection A with an expired model lock, controlled local DB and
quota dependencies, and a held fake provider response. Start a second request
after the first reaches dispatch. Observe dispatches for A before releasing
the response. Compare with a control using an active lock and a healthy sibling.
Use existing handler test fixtures where possible and intercept transport only
at the provider boundary; do not mock selection or the handler under test.
Assert the connection identities and number of dispatches, not private mutex
state. Avoid sleeps, real credentials, network access, and real provider calls.

Before an owner approves the recovery policy, record the observed current
behavior rather than adding a test that asserts the proposed single claim.
After approval and implementation, the same held-response case can assert one
current recovery claim, with a separate test for its settlement. A process-local
test cannot establish cross-process exclusion. Fixture feasibility and the
actual dispatch result remain unverified; no test was run for this proposal.
The remaining scenarios below are follow-up candidates, not prerequisites for
the initial reproduction.

## Bounded regression draft

The candidate test path is `tests/unit/connection-circuit-1108.test.js`. The 14
scenarios below are concrete test cases to implement after ownership and policy selection.
They are not executable tests or passing evidence. Use a fake clock and held
promises, synthetic connections, and injected provider responses. No account
credentials, network, real database, or wall-clock sleeps are needed for the
initial reproduction.

| Group | Stimulus | Required observable assertion |
| --- | --- | --- |
| Scope and state | Give connection A a canonical-model cooldown until `T`; keep B healthy. Select immediately before `T`. | A receives no upstream call for that model. B remains selectable. Another model on A remains eligible unless an account-wide lock applies. |
| Scope and state | Apply both a model lock and a later account lock. Try before and after each deadline. Repeat with an unknown model string. | The later applicable deadline wins. Unknown models share the bounded account scope and cannot allocate arbitrary keys. |
| Recovery and deduplication | At exactly `T`, start eight independent requests for A's failed scope. Hold the first upstream response unresolved. | Exactly one current recovery attempt is dispatched. Competing requests use eligible siblings or return a circuit-specific temporary-unavailable result. They do not consume quota reservations for skipped A attempts. |
| Recovery and deduplication | Settle the held recovery attempt successfully, then send another request. Repeat with a 503 response instead. | Success makes A healthy and eligible. Failure reopens A for the existing classifier's cooldown. B is unaffected. |
| Recovery and deduplication | Open an account-wide lock, let it expire, and race requests for two catalog models. | One claim covers the account. Different model keys cannot bypass the account recovery claim. |
| Recovery and deduplication | Model M fails on A until T. After T, healthy model N on A succeeds before any recovery request for M. | Under the proposed model-specific policy, M remains pending recovery despite existing cross-model expired-lock cleanup. N success alone cannot close M; the integration owner must assign how this evidence survives cleanup. |
| Quota and exclusions | Return a coherent native nonstreaming refusal with trusted provenance, then exercise the actual streaming refusal terminal path separately. | Preserve the existing nonstreaming successful-request cleanup and settle its recovery once. A streaming refusal adds no provider failure; its recovery result follows the verified terminal lifecycle, not an assumed neutral outcome. |
| Quota and exclusions | Use missing, unknown, stale, and tracker-error quota snapshots with an otherwise healthy connection. Repeat with an independently open circuit and with fresh definitive exhaustion. | Unknown quota remains eligible. It neither opens nor clears the circuit. Definitive exhaustion still blocks dispatch even when circuit state is healthy. |
| Quota and exclusions | Feed deterministic 400/422 validation, `provider_request_rejected`, external 499, and a local abort whose wrapper status is 502. | No failure count or cooldown is added. An acquired recovery lease is released without false recovery. |
| Reset and races | Reset while a recovery promise is pending, then return its late 503. Repeat with a late success after a newer provider failure. | Old generations cannot reopen a reset circuit or clear newer failure state. A fresh claim remains usable. |
| Reset and races | Clear local cooldown through the assigned reset path while model locks, local runtime quota evidence, and durable reauth markers are present. | Reset consistently clears only the intended local recovery blockers. It does not clear reauth quarantine or authoritative provider quota. Omitted reset fields still leave state unchanged. |
| Reset and races | Abort after selection but before dispatch. Abandon a stream. Expire a hung lease, replace it, and return the old result. | No leaked current lease. No provider failure for local cancellation. Old completion cannot settle the replacement. |
| Streaming and diagnostics | Return 200 headers, then a genuine empty stream or provider error. Repeat with a coherent refusal and a validated successful terminal event. | Headers alone do not close recovery. Existing empty-stream classification remains intact. A coherent refusal adds no provider failure. Validated success settles once. |
| Streaming and diagnostics | Skip every combo target for a circuit, then use a mixed quota/model/circuit pool. Serialize diagnostics after injecting secret-like error text. | All-circuit guidance identifies bounded exclusions and only a known retry delay. Coverage of every local strategy would be a proposed extension beyond upstream #14949, whose round-robin terminal response remains generic. Mixed failures retain their real causes. Diagnostic output contains no injected error text or credentials. |

For a global lease design, add two independent gateway-process claimants and
SQLite/Postgres coverage after the DB owner supplies the claim contract. The
eight-request in-process test cannot prove that guarantee.

Existing regression anchors include `model-lock-precedence.test.js`,
`provider-fallback-state-repository.test.js`, `provider-quota-preflight.test.js`,
`clear-connection-cooldown-12224.test.js`, `health-monitor-cache.test.js`,
`account-fallback-request-errors.test.js`, `minimax-content-filter-fallback.test.js`,
`claude-refusal-stream-empty-cooldown.test.js`, and `admission-abort-race.test.js`.
Their presence records prior intent, not a fresh passing result.

## Historical integration-owner ownership map

The table below records the original discovery assignment, superseded by the
exclusive full-cycle caller assignment and implementation described above.

| Path | Responsibility | Assignment state |
| --- | --- | --- |
| `internal/docs/connection-circuit-1108-draft.md` | Source comparison, proposed contract, and regression draft | Owned and written in this worktree. |
| `src/lib/routing/connectionCircuitState.js`; `tests/unit/connection-circuit-state.test.js` | In-memory per-connection state machine, single-flight probe admission, generation fencing, diagnostics, and vitest unit tests | Implemented and verified via static syntax check. |
| `src/sse/services/auth.js` | Claim only the selected connection, preserve eligibility and release on selection failure | Protected shared path. Integration owner must coordinate its current writer. |
| `src/sse/handlers/chat.js`; `open-sse/handlers/chatCore/streamingHandler.js`; `open-sse/handlers/chatCore/nonStreamingHandler.js` | Exactly-once completion, pin behavior, cancellation, empty streams, and refusals | Protected shared lifecycle. Requires exact assignment from its current owner. |
| `src/app/api/providers/[id]/route.js` | Existing manual-reset contract and lease invalidation | Proposed integration ownership request. No edit authorized yet. |
| `src/lib/db/repos/connectionsRepo.js` and adapter counterparts | Pending-recovery evidence policy, reset ordering, durable fallback state, and an optional transactional global claim | DB owner retains ownership. Coordinate evidence retention with the caller owner. Request an exact claim API before implementation if global scope is required. |
| `open-sse/services/combo.js` | Circuit-specific all-skipped diagnostics corresponding to upstream #14949 | Current combo owner retains ownership. Coordinate a bounded follow-up after admission works. |
| `open-sse/services/accountFallback.js`; `open-sse/services/fallbackScope.js`; quota services; registry; usage; gate; dependencies | Existing classification, bounded scopes, quota and verification authority | Read-only for this task. Reuse their contracts. Request a separate path assignment for any necessary change. |

The next integration decision is to assign the reproduction test and
choose process-local or global recovery claims. Shared integration cannot
proceed under the current assignment, which owns only this document.

For a later runtime implementation, run the assigned focused tests from `tests/`
with explicit file selectors and `--maxWorkers=2` after the heavy slot is released.
The integration owner selects the required full gate for routing/admission
changes under `AGENTS.md`, using independent exact-head evidence. Do not run a
candidate gate to approve itself.

This docs-only draft does not require runtime tests. Publication requires root
lint, applicable documentation checks, commit-range/title validation, and a new
independent review. Their outcomes are tracked in the PR and private artifacts;
author checks do not grant independent approval. This draft changes no gate
policy and records no passing runtime-test count.
