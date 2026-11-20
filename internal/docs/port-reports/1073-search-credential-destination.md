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

The same decision is applied to **every dispatch**, not only to the first one. A redirect
is a second destination: the provider answers 30x and the same headers — the stored key
included — ride along to the new host. See "Redirect hops" below.

## Redirect hops

The first port of this policy checked the destination of the **built request only**. The
redirect paths did not apply the same destination policy to each hop, so the defensive
invariant was incomplete: an authorized provider could answer `30x` and the stored
credential rode along to the host it named.

The binding is now enforced **before each actual dispatch**:

| Path | Before the fix | After the fix |
| --- | --- | --- |
| Registry destination (`providerConfig.baseUrl`) | The platform fetch followed the redirect and re-sent the credential headers to the new host. | The hops are followed by the dispatcher, and each hop is bound before it is sent. A hop outside the authorized origins is refused. |
| Operator destination (`providerSpecificData.baseUrl`) | `fetchPublic` re-validated the SSRF policy per hop, but not the credential binding, so a public hop collected the credential. | Same per-hop SSRF re-validation **plus** the credential binding. |
| Caller destination (`providerOptions.baseUrl`) | Refused before dispatch when the request carries a credential. | Unchanged. |

What the correction preserves:

- **Per-hop egress checks.** The operator path still travels through `fetchPublic`, which
  re-validates every redirect hop (DNS + literal SSRF checks). The registry path stays
  trusted — an administrator may still point a provider at an internal SearXNG — so no
  public-only check is added to it.
- **Keyless custom endpoints.** A request that carries no credential keeps the platform's
  own redirect handling on the trusted path; only a credential-bearing request is switched
  to the hop-by-hop dispatcher.
- **Allowed same-destination behavior.** A redirect that stays on an authorized origin is
  followed as before.
- **Existing no-redirect policies.** `providerConfig.preventRedirects` still surfaces the
  redirect response instead of following it.

The hop decision reuses the shipped check, so it is exact about what travels: a hop that
carries no credential (a keyless builder, or a query credential the redirect dropped) is
not bound, because there is nothing to protect there. A refused hop is reported as an
upstream failure (`502`), not as a caller error (`400`), and the message never echoes the
credential.

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

First port of this policy:

- `open-sse/handlers/search/baseUrl.js` — new: destination trust, authorized origins, credential detection, refusal.
- `open-sse/handlers/search/callers.js` — `resolveBaseUrl()` delegates to the new resolver.
- `open-sse/handlers/search/index.js` — resolves the destination once, then asserts the credential binding before the fetch.
- `open-sse/utils/error.js` — JWT shape added to the raw-credential redaction rules.
- `tests/unit/search-credential-destination-1073.test.js` — new policy suite.

Redirect-hop correction (this change):

- `open-sse/handlers/search/baseUrl.js` — `assertSearchCredentialRedirectBinding()`: the shipped
  destination decision, applied to one dispatch target, with its own refusal
  (`SearchCredentialRedirectError`).
- `open-sse/handlers/search/index.js` — the binding is asserted before each dispatch; the trusted
  (registry) path follows the hops of a credential-bearing request itself, so each hop can be
  bound before it is sent.
- `tests/unit/search-redirect-credential-policy.test.js` — new policy suite for the hop policy.

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

After the redirect-hop correction, from `tests/`:

`node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/search-redirect-credential-policy.test.js unit/search-credential-destination-1073.test.js unit/search-ssrf-guard.test.js unit/port-10394-search-openai-fallback-guard.test.js`
— 4 files, 32 tests passed. The existing redaction and guard suites keep their assertions
unchanged; the redirect suite fails against the pre-correction dispatcher and passes after it.

The adjacent search suites run unchanged after the correction
(`unit/search-base-url-ssrf.test.js`, `unit/glm-web-search.test.js`, `unit/parallel-web-provider.test.js`,
`unit/search-providers-omniroute-parity.test.js`, `unit/oauth-search-proxy-routing.test.js`,
`unit/v5-search-error-boundaries.test.js`, `unit/web-search-model-id.test.js`,
`unit/error-sanitize.test.js`) — 8 files, 155 tests passed.

The new suite is policy-level only: synthetic endpoint configuration, synthetic non-secret credential
values, a stubbed fetch, no server, no outbound traffic, no real provider and no real credentials.
It uses predeclared synthetic destinations only: RFC 5737 documentation addresses and a reserved
documentation hostname. No exposure is reproduced and no exploit is developed.

## Limits

- The binding is enforced per request on the dedicated-search path. The chat-based search path
  (`provider.searchViaChat`, `open-sse/handlers/search/chatSearch.js`) uses fixed provider endpoints
  and has no caller-selectable base URL, so it is unaffected.
- The hop policy binds what a hop actually carries. A hop that carries no credential — a keyless
  builder, or a query credential the redirect dropped — is not bound, because there is nothing to
  protect there; the request may still continue to that host without the credential.
- On the trusted (registry) path a credential-bearing request now follows its redirects itself
  instead of letting the platform fetch follow them. The hop bound is the same five hops the
  public path uses through `fetchPublic`. A keyless request keeps the platform's own behavior.
- A JWT clipped exactly at the third segment separator is not matched by the redaction rule; the
  truncated-tail rule still removes the trailing fragment. Truncation happens at the local 4096-char
  message cap, so this only applies to a credential that starts near that boundary.
- The relay-header disposition above is a static inspection of this tree: no relay-proxy route
  exists here, so nothing was exercised for it.
