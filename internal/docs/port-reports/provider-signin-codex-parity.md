# Codex and ChatGPT sign-in parity (#2034)

Historical source comparison from `c2bf2a11e87ab953bb1a35015f973b2fb9155304`,
preserved during restoration. See [the restoration record](provider-signin-codex-restoration.md)
for current verification and the additional staged exchange export. The original
seven helpers below remain staged; the module now also contains a fetch-based
exchange helper, so its historical no-I/O description applies to those seven only.

Compared on 2026-11-27. All three sources are MIT-licensed and were fetched at these exact commits:

| Source | Commit | Files read |
| --- | --- | --- |
| router-for-me/CLIProxyAPI | `dbe641f286a489ecb39e3c041c554371e6add864` | `internal/auth/codex/{openai_auth.go,siwc_auth.go,jwt_parser.go,token.go,openai.go}`, `sdk/auth/codex_device.go`, `internal/runtime/executor/codex_executor_auth.go` |
| router-for-me/EasyCLIProxyAPI | `29567ead8164a00724dfdc2087f02a23895636ee` | `src/pages/EasyModePage.tsx`, `src-tauri/src/management_api.rs`, `core-version.txt` (`8.1.3`) |
| cheaper-inference/OmniRoute | `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` | `src/lib/oauth/providers/codex.ts`, `src/lib/oauth/constants/oauth.ts`, `src/lib/oauth/utils/codexAuthImport.ts`, `open-sse/services/tokenRefresh/providers/codex.ts`, `open-sse/services/tokenRefresh/passiveCodex.ts` |

EasyCLIProxyAPI has no Codex wire contract of its own. Its guided setup asks the bundled CLIProxyAPI core's management API for `oauth/auth-url` and `oauth/import` and opens the URL that the core returns. Its behavior is therefore the CLIProxyAPI behavior below.

Evidence: `tests/unit/provider-signin-codex-parity.test.js`, 27 tests. It runs the real OAuth route, provider map, refresh function, model discovery, Codex executor, translator, bulk-import route and ChatGPT plan protocol. Only the transports, the database writer and the browser launcher are mocked. All tokens are synthetic.

## What works in production

| Area | Production behavior | Source agreement |
| --- | --- | --- |
| Browser PKCE | S256 challenge, a fresh state and verifier for each flow, client `app_EMoamEEZ73f0CkXaXp7hrann`, scope `openid profile email offline_access`, and the `id_token_add_organizations` and `codex_cli_simplified_flow` parameters. The route rejects a forged state before the token call. The state claim allows one exchange per flow, so a concurrent or replayed exchange makes no second request. | Matches CLIProxyAPI `GenerateAuthURL` and OmniRoute `codex.buildAuthUrl`, except for `prompt` (see gaps). |
| Workspace | `workspace_id` or `allowed_workspace_id` is validated and bound to the flow before any network call. A token whose `chatgpt_account_id` differs is rejected without saving. Refresh rejects a token for another workspace with `workspace_mismatch`. | DurinDoor-specific hardening. CLIProxyAPI reads `chatgpt_account_id` from the claim. OmniRoute guesses a team workspace from `organizations`; DurinDoor deliberately does not. |
| Device sign-in | The user-code request accepts `user_code` or `usercode` and an `interval` sent as a number or a string. Polls that return 403 or 404 stay pending. The device handle never reaches the client. The code is exchanged with `https://auth.openai.com/deviceauth/callback`. Two concurrent accounts keep their own handle, user code and proxy route, and a completed flow cannot be polled again. | Matches CLIProxyAPI `sdk/auth/codex_device.go`. OmniRoute's `codexDeviceFlow.ts` uses the same endpoints. |
| Refresh | Concurrent refreshes of one token share a single upstream call. Different accounts keep their own token and proxy options. A 401 or a reused, invalid or expired token is marked unrecoverable, and the logs contain neither the response body nor the token. A 5xx response or a timeout abort returns a retryable `null`. | The ownership and classification rules match both sources. The wire encoding differs (see gaps). |
| Account headers | Model discovery and executor requests send the account's own bearer token, `ChatGPT-Account-ID` (an explicit field first, then the ID token claim) and `session_id`. | Matches CLIProxyAPI's non-SIWC executor and `cmd/fetch_codex_models`. |
| Translation | Chat Completions requests become Responses `input`, and Responses `output_text.delta` events become chat chunks. | Same format pair as both sources. Detailed coverage stays in the existing `codex-*` translator tests. |
| CLI token import | Accepts Codex CLI `auth.json`, flat snake_case exports and CLIProxyAPI `CodexTokenStorage` (`type`, `plan_type`, `expired`, `last_refresh`). Envelope fields are removed. Without an explicit expiry, the access token's `exp` (then the ID token's) becomes `expiresAt`, so an import is not refreshed at once. Import never refreshes. **Corrected in this unit:** `auth_mode` values other than `chatgpt`, records with `use_siwc` or `siwc`, and records with an `oaiapp_` client ID are rejected before saving. | `auth_mode` check, JWT expiry and no refresh on import follow OmniRoute `codexAuthImport.ts`. The storage fields follow CLIProxyAPI `token.go`. |
| ChatGPT plan (SIWC) | The authorize parameter names match CLIProxyAPI `GenerateSIWCAuthURL`. Reauthorization uses the issued `oaiapp_` client and drops `agent_name_hint`. Exchange and refresh send `resource=https://api.openai.com/v1`. Provider error bodies are reduced to codes. The loopback rejects an invalid timeout before it listens and cancels at its deadline without exchanging. | One deliberate difference: CLIProxyAPI rejects a grant without `chatgpt.tokens.use.direct`, while DurinDoor keeps the verified sign-in with `planEnabled: false`. DurinDoor also verifies the ID token against JWKS; CLIProxyAPI does not. |

Not covered by this unit: request-time 401 and 403 recovery and quota handling. They belong to the executor and bootstrap, which the CPA quota unit owns. Existing coverage is in `codex-reauth-required` and `port9r-codex-401-refresh-permanent-1821`.

## Staged web wiring (not registered)

`src/lib/oauth/providerParity/codex/index.js` is web-safe: it makes no I/O and uses no Node built-ins. Nothing in production imports it yet. `registration.json` lists its exports and integration slots.

| Export | Gap in production | Integration slot |
| --- | --- | --- |
| `CODEX_AUTHORIZE_DELTA`, `withCodexAuthorizeDelta` | The authorize URL has no `prompt=login`, which both CLIProxyAPI and OmniRoute send so that a second account does not reuse the first browser session. | `PROVIDERS.codex.buildAuthUrl` in `src/lib/oauth/providers.js`, or registry `oauth.extraParams.prompt` |
| `codexDevicePollError` | A non-pending device poll failure returns the provider's response text in `errorDescription`. It is only sanitized for credentials. | Failure branch of `PROVIDERS.codex.deviceFlow.pollToken` |
| `CODEX_SOURCE_TOKEN_URL`, `buildCodexRefreshRequest` | Refresh sends a JSON body to the registry `tokenUrl` (`/api/accounts/oauth/token`). Both sources send a form body to `/oauth/token`. CLIProxyAPI adds `scope=openid profile email`; OmniRoute omits `scope` on purpose. The helper takes `scope` as an option and does not pick one. | `refreshCodexToken` in `open-sse/services/tokenRefresh/providers.js` |
| `CODEX_LOGIN_MODES`, `assertCodexLoginMode` | No explicit mode check. SIWC is a separate provider (`chatgpt-plan`). | `beginAuthorization` and `beginDeviceCode` for `codex` in `src/app/api/oauth/[provider]/[action]/route.js` |

The staging assertions sit in one block at the end of the test file. When a slot lands, invert the matching "production still lacks" assertion and set `status` to `registered`.

## Unsupported or dead source paths

- `src/lib/oauth/services/codex.js` (`CodexService`) cannot be loaded because `../config/index.js` does not exist. It would also post to `/api/cli/providers/codex`, which was never ported. Only `services/index.js` references it, and nothing imports that file. It is left unchanged; the test asserts that importing it fails.
- CLIProxyAPI `siwc_power_*` and `siwc_refresh_deferral.go` delay SIWC refresh on battery power. They have no DurinDoor equivalent and are not applicable to a server gateway.
- CLIProxyAPI's refresh journal (`refresh_journal*.go`) and OmniRoute's `passiveCodex.ts` coordinate refresh between processes. DurinDoor's equivalent is the per-connection database claim in `claimCodexRefreshAttempt`.
- CLIProxyAPI's `use_siwc` Codex credentials (SIWC tokens stored on a `codex` record and sent to `api.openai.com/v1` without `ChatGPT-Account-ID`) are not supported for `codex` in DurinDoor. Such records now fail at import. Use `chatgpt-plan` instead.

## User steps

- **Codex, browser:** Dashboard → Providers → Codex → Connect. Optionally enter a workspace ID, then sign in at auth.openai.com. The callback uses port 1455.
- **Codex, headless:** Choose the device option, open `https://auth.openai.com/codex/device` and enter the code shown. The dashboard polls until you approve.
- **Codex CLI import:** Codex → Bulk import. Paste `~/.codex/auth.json` (`auth_mode` must be `chatgpt` or absent) or a CLIProxyAPI `codex-*.json`. The imported tokens are now also refreshed by DurinDoor. Rotation invalidates the copy that the CLI keeps, so stop using the CLI copy or re-export it afterward.
- **ChatGPT plan:** Owner-operated and hidden. Enrollment runs on the machine that has the browser and needs the explicitly enabled local operator gate. See `chatgpt-plan-enrollment` tests.
