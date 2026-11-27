# Antigravity sign-in and request parity (#2034)

Scope: connection creation, OAuth client/scopes/PKCE/state, project lookup and onboarding, refresh and client binding, quota/error handling, model discovery, and buffered and streamed completions through the OpenAI and Anthropic routes. Closed network only. No account, live provider call, browser, Docker or real secret store was used.

## Pinned sources

| Source | Commit | Files read |
| --- | --- | --- |
| [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (MIT) | [`dbe641f286a489ecb39e3c041c554371e6add864`](https://github.com/router-for-me/CLIProxyAPI/commit/dbe641f286a489ecb39e3c041c554371e6add864) | `internal/auth/antigravity/constants.go`, `internal/auth/antigravity/auth.go`, `sdk/auth/antigravity.go`, `internal/cmd/antigravity_login.go`, `internal/runtime/executor/antigravity_executor_auth.go`, `sdk/auth/antigravity_models.go` |
| [EasyCLIProxyAPI](https://github.com/router-for-me/EasyCLIProxyAPI) (MIT) | [`29567ead8164a00724dfdc2087f02a23895636ee`](https://github.com/router-for-me/EasyCLIProxyAPI/commit/29567ead8164a00724dfdc2087f02a23895636ee) | `src-tauri/src/management_api.rs` |
| [OmniRoute](https://github.com/cheaper-inference/OmniRoute) (MIT) | [`b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`](https://github.com/cheaper-inference/OmniRoute/commit/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523) | `src/lib/oauth/providers/antigravity.ts`, `src/lib/oauth/constants/oauth.ts` |

EasyCLIProxyAPI has no Antigravity provider code. Its management API asks a separately installed CLIProxyAPI core for `oauth/auth-url` and polls status, so it adds no wire contract of its own. It is not used as evidence below.

## Comparison

| Contract | CLIProxyAPI `dbe641f2` | OmniRoute `b15b2ee6` | DurinDoor production |
| --- | --- | --- | --- |
| Client and scopes | Embedded desktop client, six scopes including `aicode`, callback `http://localhost:51121/oauth-callback` | Desktop client, configured scope set, optional custom client | Same desktop client and six scopes when both override variables are unset; the loopback is pinned on authorize and exchange |
| PKCE and state | Random state; no PKCE | S256 when a challenge is supplied | State bound to the flow; S256 challenge and verifier required |
| Exchange failure | Error message includes up to 8 KiB of the upstream body | Error message includes the full upstream body | Status code only; the body is never echoed |
| Empty access token or email | Sign-in fails | Sign-in `postExchange` returns empty user info when the userinfo call fails; import fails without an email | Sign-in fails |
| Project lookup | `loadCodeAssist` on the daily host, keys `cloudaicompanionProject`, `projectId`, `project` | Only `cloudaicompanionProject` | Same three keys as CLIProxyAPI |
| Onboarding | Only when no project; `tier_id` from default tier, then current tier, then `free-tier`; 5 polls, 2 s apart; settled `error` fails; no project fails | Fire-and-forget re-onboard even with a project; saves the row with `projectDiscoveryOutcome` when no project | Only when no project; same tier order; `ANTIGRAVITY_ONBOARD_MAX_ATTEMPTS` (10) polls, `ANTIGRAVITY_ONBOARD_RETRY_DELAY_MS` (5 s) apart, abortable; settled `error` and no project fail without saving |
| Onboarding headers/body | `X-Goog-Api-Client`, Node user agent, `ide_type`/`ide_version`/`ide_name` metadata | IDE header profile | Numeric client metadata, `mode: 1` (9router #141), no `X-Goog-Api-Client` (see the comment in `antigravityResolveAccount`) |
| Refresh | Desktop client and secret, `refresh_token` grant; single-flight per refresh token; failures credential-scoped | Records the issuing client (`builtin` / `custom:<id>`) | Refresh per connection with the bound client; a client-binding mismatch is refused with `reauth_required` before any request |
| Refresh-token import | Not in the files above | `importToken` exchanges a pasted refresh token | Not supported: `import-token` returns 4xx before any request |
| Device code | None | None | Not supported: `device-code` returns 4xx before any request |
| Model discovery | `fetchAvailableModels` on the daily host with `{project}` | Endpoint fallbacks | Per-account project and bearer |

The DurinDoor dashboard flow already matches or is stricter than CLIProxyAPI everywhere it has a contract. The remaining differences in the onboarding header and body come from earlier documented choices (9router #141 and the fingerprinting note). They are not wire-level gaps that the pinned sources show Google rejecting. The OmniRoute choices that save a row without a project and echo upstream bodies are intentionally not ported. No shared web-handler, config or header change is required, so nothing is staged under `src/lib/oauth/providerParity/antigravity/` and no registration slot is needed.

## Change in this unit: CLI service

`src/lib/oauth/services/antigravity.js` diverged from CLIProxyAPI `sdk/auth/antigravity.go` and from the dashboard flow. Corrections:

- `connect()` threw "No Google Cloud Project found" **before** onboarding, so a new account could never be onboarded. It now onboards only when `loadCodeAssist` returns no project and uses an existing project as is.
- `exchangeCode` rejects a response with no access token, and `getUserInfo` rejects one with no email.
- `loadCodeAssist` uses the shared `extractAntigravityProject` and `extractAntigravityOnboardTier` (`open-sse/services/antigravityProvisioning.js`). They read the three project keys and use the tier order default, then current, then `free-tier`; the old fallback was `legacy-tier`. A project-less, age-restricted answer fails with the `RESTRICTED_AGE` guidance.
- `completeOnboarding` fails on a settled operation error (status 401/403/429 mapping), fails when no project is returned, and no longer sleeps after the last poll.
- A state mismatch is reported as such; a browser launch failure no longer aborts the sign-in.

Correction: the legacy CLI service sends `tier_id` on the wire, matching [CLIProxyAPI `internal/auth/antigravity/auth.go` at `dbe641f286a489ecb39e3c041c554371e6add864`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/auth/antigravity/auth.go) (MIT) and the active dashboard flow. Internal arguments remain `tierId`; metadata and mode remain unchanged. The CLI service retains its ten-attempt polling bound and has no abort signal; dashboard polling supports cancellation.

Dead path: `saveTokens` imports `../config/index.js`, which does not exist in this checkout. The service is re-exported by `src/lib/oauth/services/index.js`, but no production caller of that export was found in the checkout, and the `cli/` package does not use it. `connect()` can complete only when `saveTokens` is supplied by the caller (the test spies it). The supported user path is the dashboard.

## Evidence

`tests/unit/provider-signin-antigravity-parity.test.js`, 21 tests. It runs the real OAuth route, provider object, flow store, temporary local DB, credential refresh, provider models route and `/v1/chat/completions`, `/v1/messages`, `/v1/models`. Only the transport (`proxyAwareFetch`, global `fetch`), the `open` launcher and the CLI callback listener and spinner are replaced. HOME, DATA_DIR and the cache dir are private; proxy and Antigravity env variables are cleared.

- Sign-in: desktop client, six scopes, S256 verifier matching the challenge, state, loopback on both legs, stored binding and subject, no secret in responses.
- Wrong state and a replayed exchange: one token request in total, one row.
- Two concurrent sign-ins through two strict proxy pools: each account's token, project, binding and pool stay apart, and every request of an account carried its own pool.
- Unsupported device code, refresh-token import, missing verifier and foreign redirect fail with zero outbound requests.
- Rejected exchange, settled onboarding error and missing project: 4xx, no upstream body, nothing saved.
- Fake clock: onboarding polls on the configured delay, stops on abort with `OAuthCancelledError`, and gives up at the attempt bound.
- Model discovery with the account's project and bearer; buffered and streamed OpenAI and Anthropic completions; upstream 429 → 429 without credentials.
- Expired token: refresh with the bound desktop client, project kept. Rejected refresh: stored credential kept, no body leak. Mismatched binding: refused before any request.
- CLI service: the corrections above. Each of the four CLI cases fails against the previous service file.

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/provider-signin-antigravity-parity.test.js --maxWorkers=2
```

Mocks prove the local request contract only. Live Google acceptance of the client, scopes, redirect, onboarding and quota is not verified.

## User steps (production)

1. Dashboard → Providers → Antigravity → Add connection. Optionally choose a proxy pool.
2. Sign in with Google. The authorize URL returns to `http://localhost:51121/oauth-callback`. On a remote or hosted dashboard, copy the address bar URL from the browser after consent and paste it into the callback step.
3. DurinDoor reads the email, finds or provisions the Cloud Code project, and saves the connection. An account Google marks `RESTRICTED_AGE` must first verify its age at the linked Google page.
4. To use your own OAuth client, set both `ANTIGRAVITY_OAUTH_CLIENT_ID` and `ANTIGRAVITY_OAUTH_CLIENT_SECRET` and restart. Existing connections then need to be reconnected.

There is no device-code or refresh-token import mode for Antigravity.
