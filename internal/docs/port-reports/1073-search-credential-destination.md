# 1073: bind search credentials to configured destinations

Source inspected 2026-11-20: [OmniRoute #12620](https://github.com/cheaper-inference/OmniRoute/pull/12620),
merged 2026-09-03 into `release/v3.8.51`, head `17a1fe0bd28d3366e01ac2a96af9e000e355c203`,
merge commit `4a37c7f46eb43ddece4494de5fe6e90af4aa241b`. The upstream PR closes three
advisories at once; the dispositions below are per advisory.

## Local contract

`/v1/search` reaches a dedicated provider through two `baseUrl` sources that are **not**
equally trusted, and they were read through one call:

| Source | Origin | Contract after this port |
| --- | --- | --- |
| `providerSpecificData.baseUrl` | stored provider connection (`credentials.providerSpecificData`) — operator config | Honored, and it **wins** over a caller-supplied value. Still `public-only` validated and still routed through the per-hop redirect guard. |
| `providerOptions.baseUrl` | `body.provider_options` — caller input | Honored only when the request carries **no** stored credential. Refused with an explicit 400 otherwise. |
| `providerConfig.baseUrl` | provider registry — administrator config | Unchanged: trusted, not validated, may target an internal service (a SearXNG container). |

The credential binding itself is enforced on the **built** request, not on the provider
config: the dedicated builders attach the operator's key in different places (`key=` /
`api_key=` in the query for google-pse/searchapi, `X-API-Key` / `X-Subscription-Token` /
`Authorization` for the others), so the binding checks the credential-bearing positions of
the request that is about to be sent. A credential that would leave for an origin the
administrator did not authorize is refused before any socket is opened.

## Ported behavior

- **GHSA-3f8g-pfh9-j687 — caller-selected `provider_options.baseUrl` collected the operator's key. Ported.**
  `open-sse/handlers/search/baseUrl.js` (new) owns the trust decision; `open-sse/handlers/search/callers.js`
  resolves the destination through it, and `open-sse/handlers/search/index.js` asserts the credential
  binding on the built request. A keyed provider (or a keyless provider whose builder accepts an
  optional Bearer, such as Context7) now answers `400 provider_options.baseUrl is not accepted for
  search provider "<id>"` instead of sending the operator's key to a caller-named public host.
  Keyless custom search (SearXNG) keeps working: no credential travels, so the caller-selected
  endpoint is honored as before.
- **GHSA-qv45-56jc-4wmj — the `sk-` shape was already redacted locally; the JWT shape was the verified gap.**
  Upstream's defect was two copies of one redaction rule drifting apart (`error.ts` versus
  `upstreamErrorPassthrough.ts`). DurinDoor has **no** `upstreamErrorPassthrough` twin and no second
  copy of the rule in the error path, so the drift mechanism does not exist here: `open-sse/utils/error.js`
  already redacts `sk-`/`sk_`, `AIza…` and the other labelled shapes. The one shape the local rule
  lacked was the **JWT**: a bare `eyJ….….…` in an upstream error body survived `sanitizeErrorMessage`.
  That is the only correction applied here — the JWT shape was added to the raw-credential
  alternation and to the truncated-tail prefix list in `open-sse/utils/error.js`, with the same
  upper-bounded quantifiers the surrounding rules use. `src/shared/utils/quotaSnapshot.js` already
  treated JWTs as secret shapes, so this closes an inconsistency inside the local tree rather than
  importing a new policy. The observability redactor (`src/lib/observability/redact.js`) keeps its
  own, separate surface and was not changed.
- **GHSA-9m72-44hg-w32g — the affected relay is absent. No port.**
  Upstream's bifrost relay route forwards `Authorization: Bearer ${BIFROST_API_KEY}` to a sidecar and
  copied the sidecar's response headers back to the relay-token holder. DurinDoor has no relay-proxy
  route: there is no `src/app/api/v1/relay` tree, no `relayProxies` store and no bifrost sidecar
  integration, so neither the header copy nor the verbatim non-2xx body exists to fix. The upstream
  `stripSensitiveResponseHeaders()` helper was therefore not ported — importing it would add an
  unused helper with no caller.

## Deviations from the upstream diff

- Upstream marks the opt-in per provider with a new registry field
  (`allowClientBaseUrlOverride`, set only for `searxng`). No new setting was added here: the local
  rule is derived from the request that is actually built, so a provider that carries a credential is
  refused and a provider that carries none keeps its custom-search behavior without a registry flag.
- Upstream resolves the operator source under `block-metadata`, which allows loopback/LAN for a
  self-hosted instance. DurinDoor keeps `public-only` for both configured sources, and the registry
  default stays the trusted path for an internal service. Relaxing the local mode would weaken the
  existing guard, so the local policy was left as it is.
- Upstream's operator source wins over a caller value; that is reproduced here, including the
  consequence that a caller value is then ignored rather than refused.

## Changed files

- `open-sse/handlers/search/baseUrl.js` — new: destination trust, authorized origins, credential detection, refusal.
- `open-sse/handlers/search/callers.js` — `resolveBaseUrl()` delegates to the new resolver.
- `open-sse/handlers/search/index.js` — resolves the destination once, then asserts the credential binding before the fetch.
- `open-sse/utils/error.js` — JWT shape added to the raw-credential redaction rules.
- `tests/unit/search-credential-destination-1073.test.js` — new policy suite.

No new route, integration, sign-in flow or operator setting was added, and the existing per-hop
egress and redirect protections are unchanged: a caller-selected destination is still validated
`public-only` and still travels through `fetchPublic`, which re-validates every redirect hop.

## Verification

`node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/search-credential-destination-1073.test.js unit/search-ssrf-guard.test.js unit/port-10394-search-openai-fallback-guard.test.js` from `tests/`: 3 files, 22 tests passed. The two guard suites keep their existing assertions unchanged.

Adjacent suites run unchanged after the port: the dedicated-search builders and providers
(`unit/search-base-url-ssrf.test.js`, `unit/glm-web-search.test.js`, `unit/parallel-web-provider.test.js`,
`unit/search-providers-omniroute-parity.test.js`, `unit/oauth-search-proxy-routing.test.js`,
`unit/v5-search-error-boundaries.test.js`, `unit/web-search-model-id.test.js`) — 7 files, 88 tests passed;
the error-sanitization consumers (`unit/error-sanitize.test.js`, `unit/request-logger-redaction.test.js`,
`unit/live-limits-runtime.test.js`, `unit/operational-metrics-runtime.test.js`,
`unit/force-stream-config.test.js`, `unit/xai-oauth-responses.test.js`,
`unit/context-preflight-chatcore.test.js`, `unit/fleet-pr1270-acceptance.test.js`,
`translator/v5-1331-responses-stream-termination.test.js`) — 9 files, 200 tests passed.

The new suite is policy-level only: synthetic endpoint configuration, synthetic non-secret credential
values, a stubbed fetch, no server, no outbound traffic, no real provider and no real credentials.

## Limits

- The binding is enforced per request on the dedicated-search path. The chat-based search path
  (`provider.searchViaChat`, `open-sse/handlers/search/chatSearch.js`) uses fixed provider endpoints
  and has no caller-selectable base URL, so it is unaffected.
- A JWT clipped exactly at the third segment separator is not matched by the redaction rule; the
  truncated-tail rule still removes the trailing fragment. Truncation happens at the local 4096-char
  message cap, so this only applies to a credential that starts near that boundary.
- The relay-header disposition above is a static inspection of this tree: no relay-proxy route
  exists here, so nothing was exercised for it.
