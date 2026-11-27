# GapGPT sign-in ownership split (#2034)

This unit stages the GapGPT OAuth helper from 9router PR #3350. It is not wired
into production yet.

## Revisions

| Side | Revision | Note |
| --- | --- | --- |
| 9router PR [#3350](https://github.com/decolua/9router/pull/3350) | head [`1f45c0e7b29bede1693ca0df613da957d67826bf`](https://github.com/decolua/9router/commit/1f45c0e7b29bede1693ca0df613da957d67826bf), base `699edac3273e13d4744bc46f6082618f08560702` | MIT. The PR title ("Fix/kiro reasoning text content fields") is stale. The head carries the GapGPT provider. The head SHA was checked against the public PR on 2026-11-27. |
| DurinDoor | `75eb6e3280` | Comparison base, branch `orq/tp47m5/signin-flow-gapgpt-a1`. |

No upstream file was copied verbatim. Each staged file names the upstream file it adapts.

## Ownership

| Area | Owner | Source files |
| --- | --- | --- |
| Provider object, token mapping, loopback callback, refresh helper | **this unit** (`src/lib/oauth/providerParity/gapgpt/`) | `src/lib/oauth/providers/gapgpt.js`, `src/lib/oauth/utils/gapgptProxy.js`, GapGPT block of `src/lib/oauth/utils/server.js`, `refreshGapgptToken` |
| Shared dispatch and refresh wiring | register-auth-06 | `src/lib/oauth/providers.js`, `constants/oauth.js`, `[action]/route.js`, `OAuthModal.js`, `tokenRefresh.js` |
| Registry row, executor, catalog, usage, provider probe, icon | upstream provider lane | `open-sse/providers/registry/gapgpt.js`, `registry/index.js`, `executors/index.js`, `services/usage/gapgpt.js`, `services/usage.js`, `ProviderLimits/utils.js`, `testUtils.js`, `public/providers/gapgpt.png`, `shared/constants/providers.js` |
| Kiro MITM, MITM manager, tailscale, tokenless guard | already handled ([open-prs-nov25-14-port-2.md](open-prs-nov25-14-port-2.md)) | not touched |

`registration.json` lists every central wiring slot that will use these exports.

## Behavior comparison

| Behavior | Source at the pin | Staged helper |
| --- | --- | --- |
| Authorize URL | `https://gapgpt.app/oauth/cli`, Codex client id, S256, the source scopes and Codex `extraParams` | Matches the source. The redirect is always `http://localhost:1455/auth/callback`, whatever the caller sends. The provider reports that redirect and its client id back, so the shared route stores both in the flow payload. |
| Token exchange | form `authorization_code` POST to `https://gapgpt.app/api/v1/oauth/cli/token` | Same request. A different redirect or client id in the flow, or a missing verifier, is refused before any request. A token URL outside `https://gapgpt.app` is refused. The selected proxy (`proxyOptions`) is passed through. |
| Exchange errors | throws `Token exchange failed: <raw body>` and the first 200 characters of a non-JSON body | **Changed.** Reports the HTTP status and, at most, a short OAuth error code. The body is never included. |
| Credential | `data.api_key` → `apiKey` → `access_token`, stored as `accessToken` and `apiKey` | Matches the source. Blank values are skipped. A response with no credential is refused. `providerSpecificData.credentialField` records the field name only. |
| Refresh token and expiry | stored when present | Matches the source. A blank `refresh_token` or a non-positive `expires_in` is ignored. |
| Refresh | `refreshGapgptToken`: form `refresh_token` grant. On success it maps `access_token` only and logs the error text on failure | Runs only when sign-in stored a refresh token. Reads the same credential fields as sign-in, so a refreshed `api_key` is not lost. Keeps the previous refresh token when none is returned. Treats 401 and `invalid_grant`-class codes as permanent and every other failure as transient. Logs the status and error code only. |
| Callback state | module globals. The browser posts the verifier and redirect URI to `start-proxy` | **Changed.** Each `createGapgptLoopback` instance owns its state. Secrets stay in `flowStore`, and a session maps `state` to an opaque `flowId` only. |
| Callback order | replies "successful" before the exchange runs, then writes the connection directly | **Changed.** It claims the flow once, checks the provider, redirect, client id and verifier, then calls the injected completion (`exchangeAndSaveAuthorizationCode` in production). Success is shown only after a persisted connection id comes back. |
| Unknown state | 302 redirect, with the code, to an app port (Mode B) | **Not adopted.** Returns 400 without an exchange. |
| Replay, cancel, expiry | no checks | A replayed state returns 409. A cancelled session returns 409, and a cancel during the exchange revokes the claim, so `flowCompletion` cannot commit. An expired flow returns 410. None of these reach the exchange. |
| Concurrency on port 1455 | one global session map, with no owner checks | One listener serves many flows, told apart by `state`. A new attempt by the same owner replaces only that owner's pending session. Status and cancel require the matching `flowId` and owner. |
| Listener | `127.0.0.1:1455`, accepts `/callback` and `/auth/callback`, 5-minute lifetime, reports `port_busy` | Binds `127.0.0.1:1455` only. Accepts only `GET /auth/callback` with Host `localhost:1455` or `127.0.0.1:1455` and a loopback or absent Origin. The lifetime is capped at `OAUTH_TIMEOUT`, and on timeout pending flows are cancelled. The listener closes once no session is active. `EADDRINUSE` is reported as `port_busy`. |
| Port shared with Codex | source note: "mutually exclusive in time" | Same limit. The route wiring must serialize Codex and GapGPT on one port key and report `port_busy` as `OAUTH_FLOW_CONFLICT`. |
| `gapcode` id | appears only in the source's provider test table | Not adopted. The source registry, OAuth table and refresh table all use `gapgpt`. |

## Modes

| Mode | State |
| --- | --- |
| Authorization code + PKCE (S256) | Staged and tested. |
| Refresh | Staged and tested. It applies only when the exchange issued a refresh token. The source comment says the CLI endpoint normally returns a long-lived key with neither a refresh token nor an expiry. |
| Device code | Not applicable: the source has no device endpoint. |
| Token or CLI import | Not applicable: the source adds no import route or credential reader. |
| Manual callback paste | Not part of this unit. Once `providers.js` registers `gapgpt`, the shared exchange route handles it. |

## Status

`registered: false`. GapGPT is not an active public provider. It needs the
upstream provider lane (registry row, executor, catalog, usage) and the
register-auth-06 wiring listed in `registration.json`. No shared catalog,
registry index, model list or storybook surface is edited here.

## Evidence

- Contract: [`tests/unit/provider-signin-gapgpt-parity.test.js`](../../../tests/unit/provider-signin-gapgpt-parity.test.js).
  It covers the URL, scopes and PKCE, the token envelopes, client and proxy isolation, expiry, cancel and replay, callback errors, fixed-host redirects, port-busy handling and refresh classification.
  The token transport, listener and credential write are mocked. The real flow store and PKCE helpers are used. No socket, browser or home store is touched.
- Run: focused Vitest, `--maxWorkers=2`, together with the existing `oauth-exchange-tokenless-3350` and `oauth-fixed-port-flow` suites. 60 of 60 passed.
