# #2034 Copilot sign-in comparison

## Sources

All three sources are MIT licensed. They were read from pinned local caches whose `HEAD` was checked before use.

- **CLIProxyAPI `dbe641f286a489ecb39e3c041c554371e6add864`**
  - [`internal/auth/copilot/client.go`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/auth/copilot/client.go) implements the public GitHub flow:
    - Device grant with client `Iv1.b507a08c87ecfe98` and scope `read:user`.
    - Rejects a device response whose `verification_uri` is not `https://github.com/login/device`, or whose expiry is outside 1–3600 seconds.
    - Bounds polling by the device expiry and adds 5 seconds on `slow_down`.
    - Refuses redirects (`CheckRedirect` returns `ErrUseLastResponse`).
    - Session exchange at `api.github.com/copilot_internal/v2/token` rejects a missing or already-expired token.
    - `TrustedAPI` restricts inference credentials to `api.githubcopilot.com` and its `individual`, `business` and `enterprise` hosts.
  - Request identity lives in [`internal/runtime/executor/helps/copilot.go`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/runtime/executor/helps/copilot.go):
    - Requests send `Editor-Version: copilot/1.0.114`, `Copilot-Integration-Id: copilot-developer-cli` and `X-GitHub-Api-Version: 2026-08-01`.
    - `/models` sends `copilot-sdk` and `2026-09-21`.
  - [`sdk/auth/copilot.go`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/sdk/auth/copilot.go) sets a 5-minute refresh lead.
  - CLIProxyAPI has no GitHub Enterprise or Microsoft 365 Copilot provider.
- **EasyCLIProxyAPI `29567ead8164a00724dfdc2087f02a23895636ee`**
  - [`src-tauri/src/agents/copilot/setup.rs`](https://github.com/router-for-me/EasyCLIProxyAPI/blob/29567ead8164a00724dfdc2087f02a23895636ee/src-tauri/src/agents/copilot/setup.rs) configures the VS Code Copilot extension to use the local proxy.
  - `detection.rs` locates VS Code.
  - Searching that revision finds no `login/device` or `copilot_internal` call. The project has no Copilot sign-in, session exchange or inference contract to port.
- **OmniRoute `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`**
  - [`src/lib/oauth/providers/ghe-copilot.ts`](https://github.com/cheaper-inference/OmniRoute/blob/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523/src/lib/oauth/providers/ghe-copilot.ts) handles the enterprise device grant:
    - Every request built from `gheUrl` goes through the provider outbound guard. A `none` policy is raised to `block-metadata`.
    - Redirects are refused.
    - Device and token responses are reduced to the fields the flow uses.
  - That file also has a GHE.com fallback to `/api/v3/copilot_internal/user`. The fallback stores the **GitHub OAuth token** as the session token and sends it to the returned `endpoints.api` host.
  - [`src/lib/oauth/providers/copilot-m365-web.ts`](https://github.com/cheaper-inference/OmniRoute/blob/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523/src/lib/oauth/providers/copilot-m365-web.ts) is the Microsoft 365 native-client PKCE source.

## What works in production

### GitHub Copilot (github.com)

**User steps:**

1. Choose GitHub Copilot.
2. Open the displayed device URL and enter the code.
3. Wait for the connection to complete.

**Web flow:**

- `src/lib/oauth/providers.js` `github` uses the device grant with client `Iv1.b507a08c87ecfe98` and `read:user`.
- It then exchanges the token for a Copilot session token.

**CLI (`src/lib/oauth/services/github.js`):**

- Validates the device response, using the same rules as CLIProxyAPI.
- Uses the returned interval and expiry.
- Stops after an accepted token.
- Supports `AbortSignal` cancellation.
- Refuses redirects.
- Error messages contain only HTTP status codes, never upstream bodies.

**Request identity:** requests keep DurinDoor's existing VS Code identity:

- `vscode/1.110.0`
- `copilot-chat/0.38.0`
- `Copilot-Integration-Id: vscode-chat`
- API version `2025-04-01`

These are not the CLIProxyAPI CLI headers. Changing them belongs to the shared executor and was not done here.

**Existing coverage:**

- `github-copilot-parity-pass.test.js`
- `copilot-refresh-proxy-1472.test.js`
- `copilot-endpoint-contract-1073.test.js`
- `parity-cli-copilot-696076.test.js`

### GitHub Enterprise Copilot (`ghe-copilot`)

**User steps:**

1. Choose GitHub Enterprise Copilot.
2. Enter the enterprise HTTPS origin, for example `https://tenant.ghe.com`.
3. Open the device URL that the enterprise host returns and enter the code.

Each connection is bound to its enterprise origin, client id and proxy through `src/lib/oauth/providerParity/copilot/gheConnection.js`. Two parts of production already use that binding.

**`src/lib/oauth/gheCopilotProvider.js`** (device code, poll and session exchange):

- **Origin:** requests go only to the bound origin.
- **Proxy:** requests use the flow's proxy selection, through the patched global fetch.
- **Redirects:** requests use `redirect: "manual"`. Any 3xx response is refused rather than followed. A refused poll reports `invalid_response`.
- **Outbound guard:** the provider outbound guard applies, with OmniRoute's `block-metadata` floor.
- **DNS:**
  - On direct egress, connection-time DNS answers are validated by the shared guarded dispatcher.
  - When a connection proxy is selected, the proxy resolves the target.
- **Response filtering:** device responses and user profiles are reduced to the fields the flow uses.
- **Session token:** a stated nonfinite or already-past expiry is dropped; an absent expiry (historical exchanges) is accepted and the token is replaced on the next refresh. Modern records bind the session digest, issuing client, issuer, API origin and credential kind to the connection.
- **Endpoints:** `endpoints.api` and `endpoints.proxy` are stored only when trusted.

**`open-sse/executors/ghe-copilot.js`** (requests and request-path refresh):

- **Endpoint resolution:** the legacy URL helper remains available for compatibility diagnostics. Actual inference preflights the stored issuer, selected proxy, valid session credential and API origin before any network work. A bound (modern) row with a stated untrusted API fails with `untrusted_api`; a row with no trusted API uses its own issuer, never a token-supplied host. Historical rows with an untrusted stored API also fall back to their issuer, which the protected suite pins.
- **Refresh:** `refreshCredentials` uses `refreshBoundGheCopilotCredentials`:
  - It is bound to the connection's origin, proxy and client.
  - Redirects are refused.
  - An expired session is rejected.
  - An OAuth refresh happens only when a session mint fails.
  - Upstream bodies are not logged.
- **Inference:** inference keeps the shared executor's `redirect: "error"`.
- **Token counting:** the enterprise registry entry has no `countTokensUrl`, so the Claude count-tokens preflight never sends an enterprise token to the public host.

**Trusted endpoints.** An endpoint is trusted when it uses `https` with no credentials, port, non-root path, query or fragment, and its host is one of:

- The enterprise host itself.
- A subdomain of the enterprise host, such as `copilot-api.tenant.ghe.com`.
- One of the four GitHub-operated hosts in CLIProxyAPI's `TrustedAPI` list.

**Unchanged policies:**

- The host policy has not changed. Private and LAN enterprise hosts remain allowed under the default `block-metadata` guard.
- `public-only` is the existing provider URL policy. When an operator selects it, it now also applies to enterprise sign-in and refresh, as in OmniRoute.

### Microsoft 365 Copilot

**User steps:**

1. Choose Microsoft 365 Copilot.
2. Sign in with a work or school account.
3. Paste the full native-client redirect URL.

**Behavior:**

- `src/lib/oauth/copilotM365Provider.js` binds state and PKCE to the shared flow.
- Its scopes are `openid profile offline_access https://substrate.office.com/sydney/M365Chat.Read https://substrate.office.com/sydney/sydney.readwrite`.
- It rejects consumer identities.
- This unit did not change it.

**Coverage:** `copilot-m365-signin.test.js` covers sign-in, refresh and mocked Chathub requests. No live tenant was contacted.

## Staged for the auth registration batch

`src/lib/oauth/providerParity/copilot/registration.json` lists:

- The exact exports of `index.js` and `gheConnection.js`.
- The two production integrations described above.
- Four central callsites that this unit may not edit.

| Callsite | Staged change |
| --- | --- |
| `src/lib/oauth/providers.js:1372` `github.pollToken` | Use `decodeCopilotPollResponse` so the raw upstream text is no longer returned as `error_description`. |
| `open-sse/services/tokenRefresh.js:290` `"ghe-copilot"` | Call `refreshBoundGheCopilotCredentials` instead of `refreshGheCopilotCredentials`. |
| `src/app/api/providers/[id]/models/modelsConfig.js:671` `"ghe-copilot"` | Discover models with `resolveBoundGheApiBase` and `gheBoundFetch` instead of `proxyAwareFetch`. |
| `src/app/api/providers/[id]/test/testUtils.js:114` `"ghe-copilot"` | Send the `/api/v3/user` probe through `gheBoundFetch`. |

Until that batch lands, these parts of production still use the old paths:

- Proactive enterprise refresh uses `open-sse/services/gheCopilotAuth.js`. It does not refuse redirects and accepts any `https` endpoint.
- Enterprise discovery uses the unfiltered stored API host.
- The public web poll can still echo upstream text.

Production parity is complete only after that batch wires these callsites.

## Not supported, and why

- **GHE.com cross-origin OAuth fallback.** OmniRoute's `resolveGheCopilotToken` reads `/api/v3/copilot_internal/user` and labels the OAuth token as a one-hour session. This implementation reads that source path but permits the OAuth credential only at the issuer itself. A peer fails with `unsupported_ghe_oauth_peer`, before inference: neither pin supplies a short-lived/session exchange for this mode. The one-hour reuse ceiling on an issuer-only fallback is local policy, not upstream OAuth expiry.
- **Unproven sibling domains.** Neither pinned source establishes `github.acme.com` → `copilot-api.acme.com`. These fail actual inference rather than being silently redirected to the web host. The existing provider has no explicit operator-approved API-origin field; this change adds no caller override or global allowlist. A real session may reach one of CPA's four exact GitHub-operated API peers on another domain. Enterprise-host/subdomain trust is the pre-existing provider-specific namespace policy, not evidence of an arbitrary sibling pairing or a new wildcard for GitHub user-content domains.
- **Legacy origin/client evidence.** `providerSpecificData.gheUrl` is the historical issuer field written by this provider and OmniRoute. An API/proxy URL alone is not an issuer. A distinct session token that is not stated as expired, with that historical issuer, may continue under the existing namespace/four-host policy. Refresh uses a stored `oauthClientId` or else the configured provider client (the one this provider and OmniRoute issue with) and sends OAuth only to the issuer; an empty client raises `reauthentication_needed`. Rows with neither `gheUrl` nor `gheBinding` (operator-stored API URL only) keep their prior dispatch, which the protected precedence suite pins; they cannot refresh and raise `reauthentication_needed` from the bound helpers. No credential is rewritten or migrated. Missing issuer, expired/missing session, or incompatible modern provenance requires reauthentication.
- **Enterprise AI Credits lookup.** The inherited usage helper calls the consumer GitHub API. A configured enterprise credit limit now fails with `unsupported_ghe_usage` before that lookup; no source-supported enterprise usage contract was found. Response token usage and streaming retain their existing handling.
- **No CLI enterprise sign-in.** The CLI service supports only github.com.
- **CLIProxyAPI's public `TrustedAPI` check for github.com connections.** This unit did not compare or change it. The check would belong in the shared GitHub executor and model discovery, which are outside this unit.

## Evidence

`tests/unit/provider-signin-copilot-parity.test.js` runs the real adapter, helper, executor and `proxyAwareFetch`. Only the bottom transport (`__setOriginalFetchForTesting`) and the per-proxy dispatchers are fixtures. All tokens are synthetic.

**Enterprise isolation:**

- Two concurrent enterprise sign-ins keep their own origin, client, proxy and trusted endpoints.
- One tenant's untrusted API host is dropped.

**Refusals:**

- Redirect and foreign-origin refusal happen before any second request.
- Look-alike, port-shifted, plain-HTTP and metadata origins are refused before any network access.

**Cancellation:** pre-submission and in-flight cancellation are tested.

**Refresh:**

- Expired-session rejection with one OAuth refresh per account, using fake clocks.
- Rejected refresh returns `null` and does not log the upstream body.

**Requests:**

- Streamed requests go only to the trusted host, with the session token and the connection's proxy.
- Bound discovery through the staged slot is covered.

**Staging-only:** one isolated block checks that the manifest's exports and callsites exist.

**Unchanged regression files:** these pass with the change:

- `ghe-copilot.test.js`
- `ghe-copilot-signin-parity.test.js`
- `ghe-copilot-route.test.js`
- `omni-copilot-account-contract-precedence.test.js`
- `copilot-endpoint-contract-1073.test.js`
- `parity-cli-copilot-696076.test.js`
- `port-2761-github-claude-native-route.test.js`
- `github-copilot-parity-pass.test.js`
- `copilot-refresh-proxy-1472.test.js`
- `copilot-m365-signin.test.js`
- `outbound-url-guard-dns-pinning.test.js`

## Origin guard completion evidence (#2034)

Exact retained read-only source cache: `.orq/orders/upstream-source-cache-2034` in the parent checkout. Verified HEADs: cli `dbe641f286a489ecb39e3c041c554371e6add864`, easy `29567ead8164a00724dfdc2087f02a23895636ee`, omni `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`. CLIProxyAPI's `internal/auth/copilot/client.go`, SDK forwarding wrapper and executor implement public GitHub only; its fixed github.com issuer and four-host inference policy do not establish GHE host/token support. Easy's wrapper provides no independent GHE exchange. GHE attribution belongs to OmniRoute's `src/lib/oauth/providers/ghe-copilot.ts`, including its OAuth fallback. No sibling-domain credential contract was inferred.

Device extraData keeps only `_gheUrl`; the poll attaches its issuer/client/proxy to the token object in process, and postExchange refuses a changed issuer or proxy. Modern stored `gheBinding` retains issuer/client/proxy and `gheSession` retains issuer/client/API/kind/token digest. Refresh uses that issuing client even if the process default changes. The four auth02 integration slots remain staged in `registration.json`; model/background/probe production wiring remains with that lane. It must pass the full trusted connection context, surface reauthentication errors and merge refreshed provenance with the existing connection metadata.

All original 19 cases and every other existing suite remain byte-identical to base; the implementation satisfies them unchanged. No failure baseline changes. Additional bottom-transport tests exercise two issuers/clients/proxies, the exact GitHub-operated different-domain peer, forged metadata and credential provenance, OAuth nonforwarding, GHE.com issuer-only fallback and cross-origin refusal, legacy continuation/reauthentication, rotation, private enterprise routing, alternate request routes, redirects, response usage and streams. Existing cancellation checks retain their coverage. Focused validation uses private env-i HOME/DATA/TMP/XDG/npm/pnpm paths and at most two workers; no live provider, installation or full suite.

Validation: the existing scoped files listed above plus `ghe-origin-completion-2034.test.js` passed 170 tests (19 preserved candidate cases, 129 existing regression tests, 22 additional cases). Focused ESLint passed without warnings. Root/full CI was not run, as requested. Final helper validation was repeated after the last issuer/client preflight adjustment.

A shared dependency-link change interrupted one rerun (missing ws/chalk/undici). Final validation used private dependency links to the retained package files, without installation, and a fresh private DATA_DIR. Final 13-file result: 170/170 passed. Commitlint CLI was absent from the retained dependencies; the Conventional Commit message was checked against the repository rules without installing it.
