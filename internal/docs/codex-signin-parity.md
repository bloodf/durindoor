# Codex sign-in and request parity

Internal reference for work order #2034. This file records the comparison between
DurinDoor's Codex sign-in and request surfaces and the upstream providers
inventoried in [`provider-parity-cliproxyapi.md`](./provider-parity-cliproxyapi.md),
[`provider-parity-easycliproxyapi.md`](./provider-parity-easycliproxyapi.md) and
[`provider-parity-omniroute.md`](./provider-parity-omniroute.md).

Scope: Codex OAuth sign-in (browser PKCE and device code), token refresh, account
scoping, and authenticated model discovery. API-key configuration formats are
explicitly out of scope.

## Revisions

| Side | Revision | Note |
| --- | --- | --- |
| `router-for-me/CLIProxyAPI` `main` | [`6faa8d20b2673404cff70a2f2d9537ae0d0e684d`](https://github.com/router-for-me/CLIProxyAPI/commit/6faa8d20b2673404cff70a2f2d9537ae0d0e684d) | Resolved from the public `refs/heads/main` at review time; still the branch head. |
| `router-for-me/EasyCLIProxyAPI` `main` | [`e4223d5eefa22a3301ca7e2a28d05897432b07f9`](https://github.com/router-for-me/EasyCLIProxyAPI/commit/e4223d5eefa22a3301ca7e2a28d05897432b07f9) | Resolved from the public `refs/heads/main` at review time; still the branch head. |
| `cheaper-inference/OmniRoute` `release/v3.8.55` | [`e3c1531afd07d5e06f7ffab658584a7ae2e3627e`](https://github.com/cheaper-inference/OmniRoute/commit/e3c1531afd07d5e06f7ffab658584a7ae2e3627e) | The branch moved past the `ab180e32fcdf1f78c96f98a617e17c86e34bf5aa` recorded in the OmniRoute inventory; this file pins the newer head. |
| DurinDoor | `d8e71637` | Base of this work order (`orq/toruzq/signin-codex-a1-l2`). |

Upstream sources are pinned to the SHA above. Each was read from a shallow clone
and was not modified. No provider API, paid API, browser or Docker was contacted,
and no real credential was read or written.

## Three-way sign-in comparison

| Surface | CLIProxyAPI | EasyCLIProxyAPI | OmniRoute | DurinDoor before this change |
| --- | --- | --- | --- | --- |
| Codex browser PKCE | Yes — `sdk/auth/codex.go` `Login` | Yes — browser OAuth, runtime delegated to the embedded core | Yes — `open-sse/config/providers/registry/codex/index.ts` | Yes |
| Codex device code | **Yes** — `sdk/auth/codex_device.go` `loginWithDeviceFlow` | No — no device grant anywhere in `src/` or `src-tauri/` | No — no `deviceauth` reference in `open-sse/` | **No** |
| Token endpoint | `https://auth.openai.com/oauth/token` (`internal/auth/codex/openai_auth.go`) | Delegated to the core | `https://auth.openai.com/oauth/token` (`open-sse/config/constants.ts`) | `https://auth.openai.com/api/accounts/oauth/token` (registry `oauth.tokenUrl`) |
| Account-scoped model catalog | Yes — `Chatgpt-Account-Id` on the catalog request (`cmd/fetch_codex_models/main.go` `fetchModels`) | Delegated to the core | Not a separate upstream surface | Partly — the account header was sent only from `providerSpecificData` |
| Refresh | `refresh_token` grant on the token endpoint, 5-day lead (`sdk/cliproxy/auth/codex_refresh_selection.go`) | Delegated to the core | Refresh on the accounts token endpoint | Yes — 5-day lead, `open-sse/services/tokenRefresh/` |

The device flow exists only in CLIProxyAPI. It is a **first-party upstream
adapter**, not a delegated path: `sdk/auth/codex_device.go` contains the wire
contract itself, so no third-party claim is needed.

### The Codex device flow wire contract

From `router-for-me/CLIProxyAPI` `sdk/auth/codex_device.go`:

1. `POST https://auth.openai.com/api/accounts/deviceauth/usercode` with the JSON
   body `{"client_id": "app_EMoamEEZ73f0CkXaXp7hrann"}` returns
   `device_auth_id`, `user_code` (or `usercode`) and an optional `interval`
   (number of seconds, or a numeric string).
2. The user approves at `https://auth.openai.com/codex/device`.
3. `POST https://auth.openai.com/api/accounts/deviceauth/token` with the JSON body
   `{"device_auth_id": ..., "user_code": ...}` is polled. A 2xx answers
   `authorization_code`, `code_verifier` and `code_challenge`; upstream treats
   **403 and 404 as "still waiting"**. Every other status is a hard error.
4. The authorization code is exchanged like any other authorization code, with
   the redirect URI `https://auth.openai.com/deviceauth/callback` and the
   server-issued `code_verifier`.

This is **not** the RFC 8628 device-code grant: there is no client-generated
PKCE pair and no `grant_type=urn:ietf:params:oauth:grant-type:device_code`
exchange. The PKCE pair arrives from the server with the authorization code.

## Deltas found and fixed

### D1 — Codex device-code sign-in was missing (implemented)

DurinDoor's Codex provider was `flowType: "authorization_code_pkce"` only, and
the route rejected a device start:

```
[OAuth] codex/device-code failed: Provider does not support device code flow
```

`POST /api/oauth/codex/device-code` answered **HTTP 400**.

The flow is now implemented on the existing device-code infrastructure:

- `open-sse/providers/registry/codex.js` — the `oauth` block carries the device
  endpoints (`deviceCodeUrl`, `deviceTokenUrl`, `deviceVerificationUrl`,
  `deviceRedirectUri`).
- `src/lib/oauth/providers.js` — the Codex provider keeps browser PKCE as its
  primary `flowType` and adds a `deviceFlow` handler set. `requestDeviceCode`
  and `pollForToken` resolve the device handlers for a device-only provider
  (`flowType: "device_code"`) or for a dual provider (`deviceFlow`).
- `src/app/api/oauth/[provider]/[action]/route.js` — `beginDeviceCode` accepts a
  provider that exposes a device path; Codex joins the no-PKCE device set (the
  client never sends a challenge of its own) and the extra-data poll set (the
  poll needs the user code next to the device handle).
- `src/shared/components/OAuthModal.js` — the Codex connect dialog offers
  **Browser** (the previous behavior) and **Device code** (the new path).

The device handle stays server-side: `beginDeviceCode` stores it in the
server-side flow payload and only `flowId`, `user_code`, the verification URL
and the expiry reach the browser.

### D2 — Authenticated model discovery was not account-scoped from the id token (implemented)

Upstream sends the account binding on the catalog request:

```go
// cmd/fetch_codex_models/main.go, fetchModels()
httpReq.Header.Set("Authorization", "Bearer "+accessToken)
httpReq.Header.Set("Originator", defaultCodexOriginator)
httpReq.Header.Set("User-Agent", defaultCodexUserAgent)
if accountID := metaStringValue(auth.Metadata, "account_id"); accountID != "" {
    httpReq.Header.Set("Chatgpt-Account-Id", accountID)
}
```

DurinDoor applied the account header from `providerSpecificData` only, while the
executor and the usage client both fall back to the id token:

| Path | Before | After |
| --- | --- | --- |
| `open-sse/executors/codex.js` (chat) | `providerSpecificData` → id token | unchanged |
| `open-sse/services/usage/codex.js` (quota) | `providerSpecificData` → id token | unchanged |
| `src/app/api/providers/[id]/models/fetchConnectionModels.js` (catalog) | `providerSpecificData` only | `providerSpecificData` → id token |

A credential that carries only an id token — a bulk-imported CLI credential, for
example — therefore reached the Codex backend with no account binding, and the
catalog could answer for a different account than the one the connection is
bound to. The catalog request now also carries the CLI identity headers
(`originator`, `User-Agent`) that upstream sends.

### D3 — Token endpoint family (deliberate difference, not changed)

Upstream exchanges the Codex browser code and the device code at
`https://auth.openai.com/oauth/token`. DurinDoor uses
`https://auth.openai.com/api/accounts/oauth/token` for the browser exchange, the
device exchange and the refresh, so the provider keeps exactly one token
endpoint.

The accounts-domain endpoint is valid for both grants: upstream uses it for its
own "Sign in with ChatGPT" flow (`internal/auth/codex/siwc_auth.go`,
`requestSIWCToken` posts `grant_type=authorization_code` with a PKCE verifier to
`https://auth.openai.com/api/accounts/oauth/token`), and the device
authorization code is minted by the same accounts domain. The refresh contract
is pinned by `tests/unit/codex-refresh-token.test.js`, which this work order may
not change.

## Parity that already held (retained, with regression evidence)

- **Browser PKCE**: the authorize URL, the `S256` challenge, the
  `id_token_add_organizations` and `codex_cli_simplified_flow` parameters, the
  fixed callback port 1455 and the form-encoded exchange match the upstream
  contract. The `codex-signin-parity` test pins them.
- **Token refresh**: the 5-day refresh lead, the rotation of the refresh token
  and the strict-pool route stay as they were; `tests/unit/codex-refresh-token.test.js`
  is unchanged and still passes.
- **Account scoping on chat requests**: the executor already resolves
  `workspaceId` → `chatgptAccountId` → `accountId` → id token and sends
  `ChatGPT-Account-ID`.
- **Responses and streaming**: the provider keeps `format: "openai-responses"`
  with `forceStream: true` against `https://chatgpt.com/backend-api/codex/responses`,
  and the executor keeps the `originator`, `Version` and `session_id` headers.
- **Imported CLI credentials**: `POST /api/oauth/codex/import-token` and
  `POST /api/oauth/codex/bulk-import` are unchanged. The device flow produces a
  row in the same model (`authType: "oauth"` with an access token, a refresh
  token, the id token and the account metadata), so it is interchangeable with an
  imported credential.

## Unverified capability and known limits

- **No live call was made.** The device endpoints, the account-scoped catalog and
  the exchange shapes come from the pinned upstream sources. "Upstream sends
  this" is a statement about upstream code, not a statement that the vendor
  accepted the request.
- **The device exchange redirect differs from upstream by design.** DurinDoor
  posts the device authorization code to the registry-configured token URL; the
  upstream implementation posts it to `https://auth.openai.com/oauth/token`. Both
  are the accounts token endpoint family, but only the DurinDoor variant is
  exercised by the test suite.
- **The CLI device path is broken for every provider, Codex included.**
  `cli/src/cli/api/client.js` reads `device_code` from the device-code response
  and polls with `deviceCode`, while the server returns a `flowId` and polls by
  `flowId`. This is pre-existing and outside the Codex scope of this work order;
  the CLI reaches Codex through the browser PKCE path, which is unaffected.
- **The device flow was not exercised against the real auth service**, so the
  exact interval semantics (`interval` as a number or a numeric string) and the
  403/404 pending contract are covered by the mock only.

## Evidence

`tests/unit/codex-signin-parity.test.js` is the regression test for this work
order. Against the pre-change tree it fails with 10 failures, including:

```
[OAuth] codex/device-code failed: Provider does not support device code flow
AssertionError: expected 400 to be 200
AssertionError: expected undefined to be 'acct-codex-1'
```

The browser-PKCE cases pass against the pre-change tree, which is the evidence
that the retained path was not disturbed.

The work-order gate is:

```bash
cd tests && timeout 300 node node_modules/vitest/vitest.mjs run \
  unit/codex-signin-parity.test.js unit/codex-refresh-token.test.js \
  unit/codex-models.test.js --maxWorkers=2
```

## Pinned follow-up: usage reset envelopes

| Behavior | Upstream source | DurinDoor state |
| --- | --- | --- |
| Usage-limit reset timing in standard, top-level, or nested error envelopes | CLIProxyAPI `6eb8554f0ede`, `internal/runtime/executor/codex_executor_terminal.go`, `parseCodexRetryAfter` | Ported here for HTTP 429; generic rate limits do not acquire a usage reset. |
| Refresh revoked or invalid client | CLIProxyAPI `6eb8554f0ede`, `internal/auth/codex/openai_auth.go`, `isNonRetryableRefreshErr` | Ported here: reject these grants without retry. |
| Responses Lite tool-call parallelism | OmniRoute `5ffa68e83544`, `open-sse/executors/codex.ts`, `enforceCodexResponsesLiteParallelToolCalls` | Ported here, preserving delegation model exceptions. |
