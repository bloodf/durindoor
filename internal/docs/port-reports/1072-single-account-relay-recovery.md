# #1072 single-account relay recovery (upstream #2068, residual 2068-B)

Compared 2026-11-20 against DurinDoor base `4f4455c9c` (branch `orq/tornf6/port9r-single-account-relay-recovery-a1`) and upstream default branch `master`. The source was open against upstream `master` with no merge when checked; the recorded head is the observed final diff head, not a claim about later upstream revisions.

Source: [decolua/9router#2068](https://github.com/decolua/9router/pull/2068) `25f5bec5f69e20e00998fe9dcc42524217adf390` ("fix: retry upstream streams before output and preserve terminal status (v0.5.119)").

This is the account-cooldown half of that PR (residual **2068-B**). The PR's other residuals — the combo pre-content status collapse (2068-A) and its stream/timeout rewrite — are separate and were not touched here. The fork's own disposition of the source is in [`1072-composite-open-residuals.md`](1072-composite-open-residuals.md) (qualified review commit `389e7d871`).

## Disposition

**Adapted (narrowed).** The upstream behavior is ported in intent, but its proof condition and its account count are both tightened, because the upstream form is not safe in this fork.

### What the upstream diff does

Upstream adds to `open-sse/services/accountFallback.js`:

```js
const TRANSIENT_GATEWAY_STATUSES = new Set([502, 503, 504, 524]);

export function shouldSkipAccountFallback(status, activeAccountCount) {
  return TRANSIENT_GATEWAY_STATUSES.has(Number(status)) && activeAccountCount <= 1;
}
```

and calls it in `src/sse/services/auth.js` `markAccountUnavailable`, right after the provider's connections are loaded:

```js
const activeAccountCount = connections.filter(c => c.isActive !== false).length;
if (shouldSkipAccountFallback(status, activeAccountCount)) {
  return { shouldFallback: false, cooldownMs: 0 };
}
```

Upstream's own test (`tests/unit/account-gateway-lock.test.js`, added by the PR) covers four statuses on a sole account plus the multi-account case.

### Why it is not ported verbatim

1. **Upstream treats every 502/503/504/524 as relay proof.** In this fork a 503 is a legitimate provider-application answer, not only an edge failure: `isAntigravityCapacityError` (`open-sse/services/accountFallback.js:300`) matches a 503 whose body reports model capacity, and `ERROR_RULES` carries the text rules `capacity` / `overloaded` → backoff (`open-sse/config/errorConfig.js:213-214`). Under upstream's rule such a 503 would silently drop a useful cooldown on a saturated provider. The fork therefore requires **proven** relay provenance instead of a status match.
2. **Upstream counts provider-scoped accounts.** `connections.filter(c => c.isActive !== false).length` ignores model locks, reauth quarantine and the request's own exclusions, so it can answer "one account" while several accounts are actually available — or "many accounts" while only one is. The fork counts the **request scope** instead.
3. Upstream returns `{ shouldFallback: false, cooldownMs: 0 }`. The fork adopts the same shape, so the client receives the real upstream error instead of a synthetic "All accounts unavailable".

### The fork's behavior contract

A credential cooldown is omitted only when **all** of the following hold.

**1. The failure is a proven relay/hop failure** — `isRelayGatewayFailure(status, { transportFailure })`, `open-sse/services/accountFallback.js:201`:

* the status is one of the gateway/relay statuses `RELAY_GATEWAY_STATUSES` = 502, 503, 504, 524 (`open-sse/config/errorConfig.js:89`), **and**
* either
  * `transportFailure` is one of `RELAY_TRANSPORT_FAILURES` = `connect_timeout`, `network` (`open-sse/config/errorConfig.js:97`) — the fork's **own** transport classification, set on the thrown error by `open-sse/executors/base.js:602,615,624`. Both mean no HTTP response was produced by any hop, so the origin never saw the request and the credential was never evaluated; **or**
  * the status is **524**. 524 is invented by an edge and is defined by no provider API contract this fork serves — the fork's own client-facing error contract (`ERROR_TYPES`, `DEFAULT_ERROR_MESSAGES`) stops at 504 — so a 524 response was produced by a relay hop, not by a provider application.

A bare 502/503/504 is **not** proof: a provider application may answer 503 (overload, model capacity) or 502 itself, and the status alone cannot tell the two apart. **Upstream error text is never consulted** — the predicate takes no body argument at all, so an untrusted body cannot manufacture relay proof.

**2. At most one eligible account in the request scope can serve** — `countEligibleAccounts(connections, { model, excludedConnectionIds })`, `open-sse/services/accountFallback.js:223`. An account is eligible when it is active (`isActive !== false`), not quarantined for reauth (`testStatus !== "reauth_required"`), not locked for the requested model (`!isModelLockActive(connection, model)`), and not already excluded by this request's own fallback chain.

**3. Nothing stronger applies first.** The rule runs in `markAccountUnavailable` (`src/sse/services/auth.js:1491`) *after* the fork's existing narrow guards — Antigravity capacity (`:1390`), recoverable Cloud Code 403 (`:1395`), Codex permanent OAuth invalidation (`:1400`), durable-credential replacement (`:1425`), Qoder quota 112 (`:1462`) — so a true account failure keeps its own handling and never reaches this rule.

When the rule fires, the account is **not** cooled and the upstream error is returned to the client (`shouldFallback: false`), so a transient hop blip cannot turn into a 30 s "all accounts locked" outage.

### Preserved behavior (unchanged)

| Case | Cooldown |
| --- | --- |
| True account failures — 401, 402, 403, 404, quota exhaustion, billing | kept, unchanged |
| Provider admission / provider-application 503 (model capacity, overload) | kept, unchanged |
| Plain upstream 502/503/504 with no proven relay provenance | kept, unchanged |
| Multi-account deployments, even for a proven relay failure | kept, unchanged — rotation depends on it |
| Quota backoff ladder (`BACKOFF_CONFIG`), rate-limit evidence | untouched |
| Executor retry budget (`DEFAULT_RETRY_CONFIG`, transport attempts) | untouched |
| Request-scoped 4xx, wrong-model, terminal client errors | untouched |

### Provenance plumbing

The provenance already existed in the fork but stopped at the executor boundary; it is carried to the account layer:

1. `open-sse/executors/base.js` sets `error.errorKind` to `connect_timeout` / `network` / `aborted` on a thrown transport error. **Unchanged.** A caller abort is `aborted` and is deliberately *not* a relay failure.
2. `open-sse/handlers/chatCore.js:1439` derives `transportFailure` from `error.errorKind` in the executor catch and puts it on the error result (`:1472`). `aborted` never reaches this: the catch already returns 499 for a client abort.
3. `src/sse/handlers/chat.js:1583,1586` passes `transportFailure` and the request's `excludeConnectionIds` set into `markAccountUnavailable`'s context.
4. `src/sse/services/auth.js:1491` applies the rule before any cooldown write.

### HTTP 524 client projection

`getClientStatusFromError` (`open-sse/utils/error.js:614`) now maps **524 → 502** for the client only, reusing the fork's existing client error projection rather than introducing a second mapping. The internal status stays **524**, so the account-fallback classification, the persisted lock evidence and the request log keep the original status.

The projection is already the single client-facing status source on these paths: `open-sse/handlers/chatCore.js:1703` passes it as the error result's client status, `src/sse/handlers/chat.js:1195` and `:1212` use it for the exhausted-account response, and `open-sse/services/combo.js:1898` uses it for the combo-exhaustion response. Every other upstream status is unchanged, including 502/503/504.

## Known limits

* A bare upstream **502/503/504 that arrived as an HTTP response** keeps its cooldown. The fork cannot prove from the status alone that an edge produced it — provider APIs are commonly served through the same CDNs — and the cooling site has no upstream **response** headers (`markAccountUnavailable` receives the executor's outgoing request headers). The upstream symptom is therefore removed for transport-level failures and for 524, and deliberately preserved for an unprovable bare 502/503/504.
* The eligibility count uses the persisted statuses (active, reauth quarantine, model locks) plus the request's own exclusion set. It does not consult the process-local circuit breaker (`canSelectConnection`, `src/lib/routing/connectionRecovery.js`) or the quota-preflight decision, because neither is visible at the cooling site. Both omissions can only make the count **larger**, which keeps the cooldown — the conservative direction.
* `shouldFallback: false` ends the account loop and returns the upstream error. With at most one eligible account there is nothing to rotate to, so no rotation is lost.

## Verification

Focused offline tests, no network, no provider credentials, no live API:

- `tests/unit/relay-account-cooldown-2068.test.js` — 24 tests. Synthetic cases only: the database layer, the webhook bus and the rate-limit evidence store are mocked, the executor and `proxyAwareFetch` are mocked, and no provider is contacted. Covers the relay-failure predicate, request-scope eligibility, the single-eligible-account positive case, the multi-account case, a plain upstream 503, untrusted error text, actual account/limit failures, the quota backoff ladder, cached statuses (inactive, reauth-quarantined, model-locked, request-excluded siblings), the 524 client projection, the fork's transport classification as the provenance source, and the executor → chatCore → account-layer propagation.
- `tests/unit/account-fallback-request-errors.test.js` and `tests/unit/account-fallback-request-scoped-4xx.test.js` — unchanged, still green. The fork's classifier contract for 4xx, 408/425, 499, 401/403 and the transient 503 cooldown is intact.
- A 21-file regression batch over the account-fallback, error-contract, executor, quota and streaming paths (276 tests) plus a 90-file batch over the `chat-*`, `chatcore-*`, `combo-*`, `error-*`, `stream-*`, `account-*`, `apikey-*` and provider-fallback families — all green.

Root lint passes. The full suite and the integration gate were not run; they belong to the integration owner. No baseline entry, workflow, `AGENTS.md`, secret, generated file or provider registry was touched.

## File map

| Concern | File | Line |
| --- | --- | --- |
| Relay statuses and transport vocabulary | `open-sse/config/errorConfig.js` | 89, 97 |
| Relay predicate | `open-sse/services/accountFallback.js` | 201 |
| Request-scope eligibility | `open-sse/services/accountFallback.js` | 223 |
| 524 client projection | `open-sse/utils/error.js` | 614 |
| Transport provenance carried to the error result | `open-sse/handlers/chatCore.js` | 1439, 1472 |
| Request scope carried to the cooling site | `src/sse/handlers/chat.js` | 1583, 1586 |
| Cooldown decision | `src/sse/services/auth.js` | 1491 |
| Transport classification source (unchanged) | `open-sse/executors/base.js` | 602, 615, 624 |
