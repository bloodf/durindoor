# OmniRoute provider connection, retry and transport parity census

Reviewed 2026-11-26 against DurinDoor `main` at `a24152ee1` — the recorded baseline named in the order, and the
tree the recorded dispositions under `internal/docs/port-reports/` describe — and against the upstream OmniRoute
default branch and its open pull requests. OmniRoute's default branch is `release/v3.8.55`, head
`c003c973a8d981439f151c158d057e44be18bf82`. 200 open pull requests were enumerated; 66 had a head SHA that no
recorded report names. Pull-request metadata, changed-file lists and patches were read with `gh api`. No provider
endpoint was contacted. Every recorded disposition below was read before a candidate was named, and two of them
turned out to be stale against the current local tree.

| Source | Head or count at retrieval |
|---|---|
| OmniRoute `release/v3.8.55` | `c003c973a8d981439f151c158d057e44be18bf82` (2026-11-26T18:30:03Z) |
| OmniRoute open pull requests | 200 |
| OmniRoute open pull requests with an unrecorded head SHA | 66 |
| DurinDoor baseline for this census | `main` at `a24152ee1` |

## Scope

Topic: provider-specific connection, retry and transport behavior. A change is in scope when it changes how
DurinDoor reaches a provider (endpoint, proxy, TLS identity, credentials, readiness), how it schedules or anchors a
retry or cooldown, or how a provider response is transported back. Catalog, pricing, usage-accounting, dashboard and
CI changes are out of scope and are dispositioned in one line without a local-code walk.

Baseline for dispositions: every report under `internal/docs/port-reports/`, plus
[1073-nov26-pm4-prs.md](1073-nov26-pm4-prs.md), which recorded the upstream default-branch head
`4de5c9b65f4cd1f966dbdf09c9d6ff510baa97a1`. Default-branch commits after that head were read; only
`d4b16adb1d086972d943d619ec002eab3568a2cf` touches this topic, and it is dispositioned below.

## Verified candidate gaps

### #20879 — preserve the TLS identity of an HTTPS proxy addressed by an IP literal

Upstream: OmniRoute [#20879](https://github.com/cheaper-inference/OmniRoute/pull/20879), open, head
[`4d65437b1d98169dae5a5a843ee9e8ff928c13ce`](https://github.com/cheaper-inference/OmniRoute/commit/4d65437b1d98169dae5a5a843ee9e8ff928c13ce).
The runtime change is one call in `open-sse/executors/cursor/h2ProxyConnect.ts`:
`tls.connect({ host: proxy.hostname, port, servername: proxy.hostname })` becomes
`tls.connect({ host: tlsHost, port, servername: net.isIP(tlsHost) ? undefined : tlsHost })` with
`tlsHost = stripIpv6Brackets(proxy.hostname)`. The upstream test
`tests/unit/cursor-h2-proxy-tunnel.test.ts` asserts that an IP-literal HTTPS proxy receives no SNI at all, and that a
DNS proxy name which does not match the certificate still fails with `ERR_TLS_CERT_ALTNAME_INVALID`.

Local: [open-sse/utils/http2Connect.js](../../../open-sse/utils/http2Connect.js) lines 81-84 build the proxy socket as
`const options = { host: proxy.hostname, port: proxyPort }` and
`tls.connect({ ...options, servername: proxy.hostname, ALPNProtocols: ["http/1.1"] })`. Two differences remain:

- The SNI is always the proxy hostname, so an HTTPS proxy addressed by an IP literal is offered an IP address as the
  server name. Upstream drops the SNI for IP literals and keeps certificate verification against `host`.
- The IPv6 brackets are not stripped. `new URL("https://[::1]:8443").hostname` is `"[::1]"`, so `host` keeps the
  brackets that `tls.connect` cannot resolve.

This tunnel is a distinct transport from the generic fetch path. The Cursor executor reaches it through
[open-sse/executors/cursor.js](../../../open-sse/executors/cursor.js) line 1033
(`connectHttp2(url, { proxyUrl: cursorProxyUrl(url, proxyOptions), ... })`), while the generic path goes through
[open-sse/utils/proxyFetch.js](../../../open-sse/utils/proxyFetch.js), which already carries the #20880 fix:
`stripIpv6Brackets` at line 688 and `createIpProxyClient` at lines 697-708 drop `servername` for IP literals, wired in
at line 793. The HTTP/2 CONNECT tunnel never uses that client.

The recorded disposition for this pull request is stale, and the change is worth re-reading before any port:
[1073-nov21-open-ledger-c.md](1073-nov21-open-ledger-c.md) line 24 recorded it as a port candidate, and
[1073-nov22-verify-oc00.md](1073-nov22-verify-oc00.md) line 14 dispositioned it **not applicable** because
"DurinDoor's `open-sse/executors/cursor.js` has no such tunnel … no `tls.connect` with a proxy host exists". That
evidence described the tree of 2026-11-22. `open-sse/utils/http2Connect.js` was added later, in `c228a36a84`
(2026-11-23, "port(upstream): resolve deferred upstream PRs and port verified gaps (#2386)"), which introduced the
proxy tunnel and with it the two differences above. The gap is real today, but it is scoped to the Cursor HTTP/2
tunnel only.

Local target: `open-sse/utils/http2Connect.js`, reusing `stripIpv6Brackets` from `open-sse/utils/proxyFetch.js`
instead of adding a second helper, plus a focused test that asserts no SNI for an IP-literal proxy and a preserved
`ERR_TLS_CERT_ALTNAME_INVALID` for a mismatched DNS name.

### #21343 — Liquid AI serves its OpenAI-compatible API under `/openai/v1`

Upstream: OmniRoute [#21343](https://github.com/cheaper-inference/OmniRoute/pull/21343), open, head
[`043fd946c80671bbed3bf1dce46fd4e5399a7cfc`](https://github.com/cheaper-inference/OmniRoute/commit/043fd946c80671bbed3bf1dce46fd4e5399a7cfc).
The runtime change is in `open-sse/config/providers/registry/liquid/index.ts`: `baseUrl` moves from
`https://inference.liquid.ai/v1/chat/completions` to `https://api.liquid.ai/openai/v1/chat/completions`, and
`modelsUrl` from `https://inference.liquid.ai/v1/models` to `https://api.liquid.ai/openai/v1/models`. The upstream
changelog records the observed failure: the old host "refuses current keys with 401", and the live OpenAI-compatible
endpoint is `api.liquid.ai/openai/v1` per the vendor quickstart.

Local: [open-sse/providers/registry/liquid.js](../../../open-sse/providers/registry/liquid.js) lines 15-16 use
`https://api.liquid.ai/v1/chat/completions` and `https://api.liquid.ai/v1/models`. The host is already the current one,
but the `/openai` path segment is missing, so the local endpoint is still not the vendor path that upstream verified
against a live key on 2026-11-26. The model list is also the retired `liquid-lfm-40b` (line 19); upstream replaces it
with the three chat models the live `GET /openai/v1/models` returns. The endpoint half belongs to this census; the
model-list half is catalog scope.

Two local fixtures pin the current values and must move with the change:
`tests/__baseline__/providers-baseline.json` lines 1227-1228 (later deleted as unreferenced by #2659) and
[tests/unit/omniroute-simple-c-providers.test.js](../../../tests/unit/omniroute-simple-c-providers.test.js) lines
125-127. The free-tier catalog row in
[open-sse/config/freeModelCatalog.data.js](../../../open-sse/config/freeModelCatalog.data.js) line 266 names the same
retired model.

### #21365 — skip credentialed Devin CLI candidates when the local executable is missing

Upstream: OmniRoute [#21365](https://github.com/cheaper-inference/OmniRoute/pull/21365), open, head
[`e658152889991ac13ee4e72a35e693aab4dca26d`](https://github.com/cheaper-inference/OmniRoute/commit/e658152889991ac13ee4e72a35e693aab4dca26d).
The change extracts `resolveDevinBin` into `open-sse/executors/devinCliBinary.ts`, adds an advisory
`isDevinBinAvailable()` probe, and filters the candidate pool in
`open-sse/services/autoCombo/virtualFactory.ts`: `if (providerId === "devin-cli" && !isDevinBinAvailable()) return false;`
with the upstream note "Host runtime availability is not account health; never cool down credentials."

Local: the binary lookup exists at [open-sse/executors/devin-acp-stdio.js](../../../open-sse/executors/devin-acp-stdio.js)
line 7 (`resolveDevinBin`), and [open-sse/executors/devin-cli.js](../../../open-sse/executors/devin-cli.js) line 228
raises `Devin CLI not found: …` only when a request is already dispatched. There is no availability probe: `grep` for
`isDevinBinAvailable`, `binAvailable` and `cliAvailable` across `open-sse/` and `src/` returns nothing, and the
auto-combo candidate filter — the no-auth gate at
[open-sse/services/combo.js](../../../open-sse/services/combo.js) line 133 and
[open-sse/services/autoComboResolver.js](../../../open-sse/services/autoComboResolver.js) — has no executable-readiness
condition. An operator without the Devin CLI therefore keeps Devin CLI candidates in the auto pool and pays a failed
dispatch on every request, and the local failure is a provider error rather than a candidate that never enters the
pool.

Local target: an availability helper beside `resolveDevinBin` in `open-sse/executors/devin-acp-stdio.js`, consumed by
the auto-combo candidate filter. The upstream behaviour of not cooling down a credential for a host-runtime problem
should be preserved.

### #21303 — skip a model that a connection confirmed it does not serve

Upstream: OmniRoute [#21303](https://github.com/cheaper-inference/OmniRoute/pull/21303), open, head
[`7bfe2a605e250798decdb0c8fbff09ba2e1e3410`](https://github.com/cheaper-inference/OmniRoute/commit/7bfe2a605e250798decdb0c8fbff09ba2e1e3410)
(the head moved from `4b49e039ab7e1026db61e071aaa63a6766c9c79c`, so any earlier note on this pull request is stale).
The change adds `open-sse/services/modelAvailabilityEvidence.ts`, `open-sse/utils/modelAvailabilityTypes.ts`, the
migration `src/lib/db/migrations/20261126132654_model_availability_evidence.sql` and
`src/lib/db/modelAvailability.ts`, behind an opt-in feature flag. `classifyModelAbsence` accepts only an explicit 404
`model_not_found` envelope that names the wire model; two independent observations inside 24 hours confirm that the
model is not served by that connection revision and endpoint kind, and routing then skips that connection and model
for 30 days, until a successful response clears the evidence.

Local: no `modelAvailabilityEvidence`, `modelAvailability`, `confirmedAbsent` or equivalent identifier exists in
`open-sse/`, `src/` or `tests/`. Local model-not-found handling is request-scoped and provider-specific:
[open-sse/services/accountFallback.js](../../../open-sse/services/accountFallback.js) lines 208-231 treat an
OpenRouter or Codex `model_not_found` 404 as a per-model lockout, read through `getActiveModelLockUntil` at line 792,
and [open-sse/handlers/chatCore.js](../../../open-sse/handlers/chatCore.js) line 396 rejects a model the catalog marks
unroutable. There is no persistent, cross-request evidence that a specific connection does not serve a specific model,
no connection-revision or endpoint-kind identity, and no confirmation threshold.

This is a substantial opt-in feature with new persistence, a schema migration and new routing semantics, not a narrow
port. The boundary (flag name, retention window, which providers qualify, how a successful response clears the
evidence) needs an owner decision before implementation.

### #20962 / #20145 — one shared clock instant for a relative cooldown deadline

Upstream: OmniRoute [#20962](https://github.com/cheaper-inference/OmniRoute/pull/20962) (the re-land of
[#20145](https://github.com/cheaper-inference/OmniRoute/pull/20145)), open, head
[`fae94b9d38083e9dc2298f20c0f48e70039920ae`](https://github.com/cheaper-inference/OmniRoute/commit/fae94b9d38083e9dc2298f20c0f48e70039920ae).
In `open-sse/services/accountFallback.ts`, `parseResetFromHeaders(headers, nowMs = Date.now())` returns
`nowMs + seconds * 1000` for a relative `Retry-After`, and the caller subtracts the same `nowMs`
(`const waitMs = Math.max(resetTime - nowMs, 0)`), so the hint keeps its full duration. The upstream rationale is that
the two clock reads used to drop the milliseconds in between, so `retry-after: 7` produced a 6999 ms cooldown.

Local: the upstream path itself is absent. DurinDoor has no header-based `Retry-After` cooldown in its fallback
classifier — `open-sse/services/accountFallback.js` never reads `retry-after`. The header is parsed in
[open-sse/utils/error.js](../../../open-sse/utils/error.js) (`parseRateLimitEvidence` → `retryAfterReset` at line 181),
and that result is carried as an absolute `resetAtMs` deadline into the account state, so no second subtraction
happens there. The recorded disposition "already present"
([1073-nov22-verify-oc01.md](1073-nov22-verify-oc01.md) line 15, carried in
[1073-nov25-pm.md](1073-nov25-pm.md) line 209) therefore still holds for the upstream change.

The same double-read defect that upstream fixes is nevertheless present in the local body-hint branch:
[open-sse/services/accountFallback.js](../../../open-sse/services/accountFallback.js) lines 316-319 call
`parseRateLimitEvidence({ status, bodyText: message, now: Date.now() })` and then compute
`evidence.resetAtMs - Date.now()` with a second clock read, so a relative body deadline is short by the elapsed
milliseconds. The two sibling branches of the same function already use the correct single-instant pattern: lines
358-361 and lines 372-386 capture `now` once and subtract that same instant. This is a local instance of the upstream
defect class rather than a port of the upstream header path, and the fix is one captured timestamp plus a deterministic
test that advances the clock between reads.

## One-line dispositions for other inspected changes

| PR | Head SHA | Disposition | Evidence |
|---|---|---|---|
| [#20739](https://github.com/cheaper-inference/OmniRoute/pull/20739) | [`ce225f129566090341905e67b365e3d098406f77`](https://github.com/cheaper-inference/OmniRoute/commit/ce225f129566090341905e67b365e3d098406f77) | Already present | Left pending in [1073-nov25-pm.md](1073-nov25-pm.md) line 288 and re-read here. The upstream head adds account-scoped browser egress for Gemini Web. Local [open-sse/executors/gemini-web.js](../../../open-sse/executors/gemini-web.js) resolves the credential-scoped proxy through `resolveGeminiWebBrowserProxy` (line 49, failing closed at line 53), re-checks the abort before and after `browser.newContext` (lines 677 and 681) and closes the context in `finally`, so the orphaned-context case is covered. The proxy options carry the connection assignment ([open-sse/handlers/chatCore.js](../../../open-sse/handlers/chatCore.js) lines 1365-1402). |
| [#21349](https://github.com/cheaper-inference/OmniRoute/pull/21349) | [`780e88e9245dc95271f9b7daf06170474367d956`](https://github.com/cheaper-inference/OmniRoute/commit/780e88e9245dc95271f9b7daf06170474367d956) | Out of scope for this census | A client-facing model-resolution contract, not a provider connection, retry or transport behavior. Recorded for the routing census: local [src/sse/handlers/chat/singleModel/resolveModel.js](../../../src/sse/handlers/chat/singleModel/resolveModel.js) lines 46-64 have no unknown-model rejection at all, so an unknown id falls through to provider-prefix inference or nested-combo dispatch, while only `GET /v1/models/{id}` answers 404 `model_not_found` ([src/app/api/v1/models/[...model]/route.js](../../../src/app/api/v1/models/[...model]/route.js) lines 52-62). |
| [#21338](https://github.com/cheaper-inference/OmniRoute/pull/21338) | [`9bcaa77898e644255949ce94123a6899fc0e2dd0`](https://github.com/cheaper-inference/OmniRoute/commit/9bcaa77898e644255949ce94123a6899fc0e2dd0) | Out of scope | Routes `liquid/<model>` decisions to a separate Liquid AI native backend; upstream `open-sse/config/systemOneRegistry.ts` and `src/app/api/v1/_shared/systemOneRoute.ts` are absent locally, and the local System One surface is the distinct TypeSafe/Jev classifier in [open-sse/services/jevClassifier.js](../../../open-sse/services/jevClassifier.js). |
| [#21341](https://github.com/cheaper-inference/OmniRoute/pull/21341) | [`67eb9b5f7c2be0583c10b646106364cb63e970bd`](https://github.com/cheaper-inference/OmniRoute/commit/67eb9b5f7c2be0583c10b646106364cb63e970bd) | Out of scope | An auto-combo per-request cost budget is a routing-policy feature; upstream `open-sse/services/combo/resolveAutoStrategy.ts` has no local counterpart module. |
| [#21351](https://github.com/cheaper-inference/OmniRoute/pull/21351) | [`60271ae2db34793ab3fe35659786f38bd41dfac4`](https://github.com/cheaper-inference/OmniRoute/commit/60271ae2db34793ab3fe35659786f38bd41dfac4) | Out of scope | Routes the Codex prompt-cache anchor digest through `opaqueTokenFingerprint` in `open-sse/executors/codex/promptCacheKey.ts`; a provider request-header identity change outside connection, retry and transport. |
| [#21346](https://github.com/cheaper-inference/OmniRoute/pull/21346) | [`a21607ce66b2a136768b351bd708c5ab8353afdc`](https://github.com/cheaper-inference/OmniRoute/commit/a21607ce66b2a136768b351bd708c5ab8353afdc) | Out of scope | Client `X-Request-Id` deduplication adds an idempotency layer (`open-sse/handlers/chatCore/idempotency.ts`); a request-identity feature, not a provider transport behavior. |
| [#21355](https://github.com/cheaper-inference/OmniRoute/pull/21355) | [`9716e927cf95b966072ce70dd448150e1bf304b5`](https://github.com/cheaper-inference/OmniRoute/commit/9716e927cf95b966072ce70dd448150e1bf304b5) | Out of scope | Keeps `length` and `content_filter` finish reasons on truncated tool calls; SSE response framing (`open-sse/utils/stream.ts`, `open-sse/handlers/sseParser.js`), not provider connection or retry. |
| [#21317](https://github.com/cheaper-inference/OmniRoute/pull/21317) | [`04ed7c844f311019264f850b131d8ccdae1bba36`](https://github.com/cheaper-inference/OmniRoute/commit/04ed7c844f311019264f850b131d8ccdae1bba36) | Out of scope | Scopes prompt-cache affinity to authenticated sessions; a cache-affinity change. |
| [#21347](https://github.com/cheaper-inference/OmniRoute/pull/21347) | [`a50680baf8f25a5507ee538cc0652850422f0ae2`](https://github.com/cheaper-inference/OmniRoute/commit/a50680baf8f25a5507ee538cc0652850422f0ae2) | Out of scope | Routes advertised Claude effort variants through their live base model; catalog and routing policy. |
| [#21352](https://github.com/cheaper-inference/OmniRoute/pull/21352) | [`be647b61576e3b3d7758f184684ce4af44b25d48`](https://github.com/cheaper-inference/OmniRoute/commit/be647b61576e3b3d7758f184684ce4af44b25d48) | Out of scope | Refuses a selected Playground key that no longer exists; key-policy enforcement in `src/shared/utils/apiKeyPolicy.js`. |
| [#21304](https://github.com/cheaper-inference/OmniRoute/pull/21304) | [`9ea45faacdf93cd39fba848c31ff5304f2210a8c`](https://github.com/cheaper-inference/OmniRoute/commit/9ea45faacdf93cd39fba848c31ff5304f2210a8c) | Out of scope | SQLite file-mode and parent-directory fsync durability; storage-layer hardening, not provider transport. |
| [#21337](https://github.com/cheaper-inference/OmniRoute/pull/21337) | [`78b84d0722bb18007e779bcfe66fd1f83520d1db`](https://github.com/cheaper-inference/OmniRoute/commit/78b84d0722bb18007e779bcfe66fd1f83520d1db) | Inapplicable | Frozen-lockfile enforcement and container tooling pinning in upstream build files. |
| [#21305](https://github.com/cheaper-inference/OmniRoute/pull/21305) | [`d4b16adb1d086972d943d619ec002eab3568a2cf`](https://github.com/cheaper-inference/OmniRoute/commit/d4b16adb1d086972d943d619ec002eab3568a2cf) | Inapplicable | Makes the cloud-sync deadline cover reading the response body; DurinDoor has no cloud-sync client, so there is no such deadline to widen. The only default-branch commit after the recorded baseline `4de5c9b65f4c` that touches this topic. |
| [#21292](https://github.com/cheaper-inference/OmniRoute/pull/21292) | [`3262a2790f8889672a3549b376ad612168565869`](https://github.com/cheaper-inference/OmniRoute/commit/3262a2790f8889672a3549b376ad612168565869) | Inapplicable | Moves the Anthropic-format key-validation probe and the Claude warm-up default off the retired `claude-3-5-sonnet-20240620` / `-20241022` / `claude-3-5-haiku-20241022` to `claude-haiku-5-5`. The local Anthropic probe already uses a current model ([src/shared/constants/anthropicValidation.js](../../../src/shared/constants/anthropicValidation.js) line 2, `claude-haiku-4-5-20251001`), and DurinDoor has no Anthropic warm-up scheduler with an `OMNIROUTE_WARMUP_MODEL` default, so there is no retired id to replace. |
| [#21262](https://github.com/cheaper-inference/OmniRoute/pull/21262) | [`339a65dc2bd6346a91053c0d669486c4846f4316`](https://github.com/cheaper-inference/OmniRoute/commit/339a65dc2bd6346a91053c0d669486c4846f4316) | Already present | Recorded in [1073-nov26-midday.md](1073-nov26-midday.md) line 68. The native Cheaper Inference Claude route is local in [open-sse/providers/registry/cheaperinference.js](../../../open-sse/providers/registry/cheaperinference.js). |
| [#21238](https://github.com/cheaper-inference/OmniRoute/pull/21238) | [`0dca3f423c8617e68a89c6ef73481876e4cab438`](https://github.com/cheaper-inference/OmniRoute/commit/0dca3f423c8617e68a89c6ef73481876e4cab438) | Not applicable | Recorded in [1073-nov26-night.md](1073-nov26-night.md) line 154. The compatible-node `customHeaders` contract is absent locally (`src/lib/providers/compatibleNodeHeaders.js` does not exist; `grep` for `customHeaders` in `open-sse/` and `src/` finds only the Firecrawl header parser). |
| [#21226](https://github.com/cheaper-inference/OmniRoute/pull/21226) | [`baf9d3a67091559ec2a596fbb2abeace0e59aa5f`](https://github.com/cheaper-inference/OmniRoute/commit/baf9d3a67091559ec2a596fbb2abeace0e59aa5f) | Already present | Recorded in [1073-nov26-night.md](1073-nov26-night.md) line 161. A revoked refresh token is unrecoverable locally ([open-sse/services/tokenRefresh/providers.js](../../../open-sse/services/tokenRefresh/providers.js) line 500 returns `unrecoverable_refresh_error` for `invalid_token` and revoked tokens), and the connection is parked in the durable `reauth_required` state ([src/lib/db/repos/connectionsRepo.js](../../../src/lib/db/repos/connectionsRepo.js) lines 116 and 944). |
| [#21224](https://github.com/cheaper-inference/OmniRoute/pull/21224) | [`1b8a0ac5b1ca5ce179b823d0c148e561722409f5`](https://github.com/cheaper-inference/OmniRoute/commit/1b8a0ac5b1ca5ce179b823d0c148e561722409f5) | Already present | Recorded in [1073-nov26-night.md](1073-nov26-night.md) line 162. A 410 matches no rule, so it reaches the request-scoped 4xx branch of [open-sse/services/accountFallback.js](../../../open-sse/services/accountFallback.js) line 544 and returns `requestScoped: true`: no account cooldown and no walk across sibling accounts. |
| [#21221](https://github.com/cheaper-inference/OmniRoute/pull/21221) | [`547e684a20fff6d6e60256450124becc4e09c43a`](https://github.com/cheaper-inference/OmniRoute/commit/547e684a20fff6d6e60256450124becc4e09c43a) | Out of scope | Live Z.ai model discovery, held for an owner decision in [1073-nov26-am-ports.md](1073-nov26-am-ports.md) line 9. |
| [#20880](https://github.com/cheaper-inference/OmniRoute/pull/20880) | [`f269b4cf6c70270cee35e2e5137373e944b980df`](https://github.com/cheaper-inference/OmniRoute/commit/f269b4cf6c70270cee35e2e5137373e944b980df) | Already present | Recorded in [open-prs-nov25-20.md](open-prs-nov25-20.md) line 38. Local: [open-sse/utils/proxyFetch.js](../../../open-sse/utils/proxyFetch.js) lines 697-708 drop `servername` for IP-literal HTTPS proxies, covered by [tests/unit/portor-https-ip-proxy-sni-20880.test.js](../../../tests/unit/portor-https-ip-proxy-sni-20880.test.js). |
| [#20146](https://github.com/cheaper-inference/OmniRoute/pull/20146) | [`1db1a99d6ac53517cafe9aa4a90a11c064e9d0a4`](https://github.com/cheaper-inference/OmniRoute/commit/1db1a99d6ac53517cafe9aa4a90a11c064e9d0a4) | Already present | Recorded in [open-prs-nov25-24-port-2.md](open-prs-nov25-24-port-2.md) line 13; local rate-limit parsing reads a date only from a non-numeric value ([open-sse/utils/error.js](../../../open-sse/utils/error.js) line 186 rejects a numeric value that `Date.parse` would read as a year). |

## Limits

- Every upstream fact above comes from `gh api` metadata and patches read on 2026-11-26. No provider endpoint was
  contacted, so no claim here rests on a live upstream response.
- The upstream default-branch snapshot is `c003c973a8d981439f151c158d057e44be18bf82` and the open-pull-request
  snapshot is the 200 pull requests listed at that moment; both are point-in-time.
- 66 open pull requests had an unrecorded head SHA. The ones listed above were read file by file; the remainder are
  dependency bumps, documentation, CI, catalog, dashboard and usage work with no connection, retry or transport
  surface, and are not enumerated here.
- Local behavior was read from the current tree, not executed. The census changed no production code, no dependency, no
  issue and no service. The gate's ESLint runner and its unit test are a separate CI commit, not part of these findings.
- #20879, #21343, #21365, #21303 and the local instance of the #20962/#20145 defect class are candidates only. None
  is ported here, and each needs its own decision before implementation.
