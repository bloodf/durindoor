# Kimi sign-in and request parity (#2034)

Comparison of DurinDoor's Kimi sign-in and request paths against three pinned
upstream sources, with the shared web-handler delta staged but not wired.

## Revisions

| Side | Revision | Note |
| --- | --- | --- |
| CLIProxyAPI `main` | [`dbe641f286a489ecb39e3c041c554371e6add864`](https://github.com/router-for-me/CLIProxyAPI/commit/dbe641f286a489ecb39e3c041c554371e6add864) | Resolved from the public git refs on 2026-11-27. The pinned tree carries the device flow in `internal/auth/kimi/kimi.go` and the identity headers in `internal/runtime/executor/kimi_executor.go`. |
| EasyCLIProxyAPI `main` | [`29567ead8164a00724dfdc2087f02a23895636ee`](https://github.com/router-for-me/EasyCLIProxyAPI/commit/29567ead8164a00724dfdc2087f02a23895636ee) | Resolved from the public git refs on 2026-11-27. A desktop console around a separately versioned CLIProxyAPI core. |
| OmniRoute | [`b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`](https://github.com/cheaper-inference/OmniRoute/commit/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523) | Resolved from the public git refs on 2026-11-27. |
| DurinDoor | `5b4d9076ea` | Comparison base for this unit, branch `orq/tp47m5/integration`. |

All three upstreams are MIT licensed. The Kimi paths ported here are attributed
to the exact upstream file and commit; no upstream file was copied verbatim.

EasyCLIProxyAPI contributes **no independent Kimi sign-in contract** at this
pin. It owns the Kimi Code CLI launch configuration — `build_kimi_code_agent_config`
in `src-tauri/src/agents/configuration.rs` writes `~/.kimi-code/config.toml` with
a `base_url` and an `api_key` pointing at the gateway — and delegates every
provider sign-in to the managed core through `src/services/oauth.ts`
(`start_oauth_login`, `get_oauth_status`, `submit_oauth_callback`). That makes
the Kimi Code CLI an *API-key client of DurinDoor*, not a Kimi identity.

## Behavior comparison

| Behavior | Upstream source | DurinDoor state |
| --- | --- | --- |
| Device authorization endpoint and body | CLIProxyAPI `internal/auth/kimi/kimi.go` `RequestDeviceCode`; OmniRoute `src/lib/oauth/providers/kimi-coding.ts` `requestDeviceCode` | Already matched. `POST {authHost}/api/oauth/device_authorization`, form-encoded `client_id` only, no PKCE challenge and no scope. |
| Token endpoint and device grant | CLIProxyAPI `internal/auth/kimi/kimi.go` `exchangeDeviceCode`; OmniRoute `kimi-coding.ts` `pollToken` | Already matched. `POST {authHost}/api/oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`, `client_id` and `device_code`. |
| Public client id | CLIProxyAPI `kimiClientID`; OmniRoute registry `clientIdDefault` | Already matched. `17e5f671-d194-4dfb-9706-5516cb48c098`, with the DurinDoor-only `KIMI_CODING_OAUTH_CLIENT_ID` override for the `.com` grant. |
| Regional hosts | CLIProxyAPI `ResolveKimiOAuthHost`, `ResolveKimiAPIBaseURL` | Already matched. `auth.kimi.com` / `api.kimi.com` for `kimi-coding`, `auth.kimi.ai` / `api.kimi.ai` for `kimi-ai`. |
| Device-code response fields | CLIProxyAPI `DeviceCodeResponse`; OmniRoute `kimi-coding.ts` | Already matched. A blank `device_code` or a missing `user_code` is refused; the verification URI falls back to the regional `www.<domain>/code/authorize_device` page. |
| `authorization_pending` and `slow_down` | CLIProxyAPI `exchangeDeviceCode` maps both to "continue polling" | Already matched. The route keeps the flow open for both and never writes a credential. |
| `expired_token` and `access_denied` | CLIProxyAPI `exchangeDeviceCode` stops the poll loop | Already matched. The flow is consumed, the reply is relayed with `pending: false`, and a later poll of the same flow is `410`. |
| Malformed token response | CLIProxyAPI `exchangeDeviceCode` refuses an empty access token | Already matched and stricter. A non-string or blank `access_token`, and a supplied but blank or non-string `refresh_token`, are refused as `invalid_response` before the credential write. |
| Refresh grant and body | CLIProxyAPI `refreshTokenSingleFlight`; OmniRoute `open-sse/services/tokenRefresh/providers/kimiCoding.ts` | Already matched. `grant_type=refresh_token` with `client_id` and `refresh_token` against the regional token URL. |
| Refresh device identity | CLIProxyAPI `kimi_executor.go` `Refresh` passes the stored device id; OmniRoute `kimiCoding.ts` prefers `providerSpecificData.deviceId` and otherwise derives one from the refresh token | **Different.** DurinDoor sends the stored device id when the connection has one. When it does not, it falls back to `buildKimiHeaders()`, which sends `X-Msh-Device-Id: kimi-<timestamp>` — a new identity on every refresh. Staged, see below. |
| Refresh response handling | CLIProxyAPI `refreshTokenSingleFlight`; OmniRoute `kimiCoding.ts` | Already matched. A blank access token or a supplied malformed refresh token is refused; an omitted refresh token keeps the previous one; `invalid_grant` and `invalid_request` are permanent (`unrecoverable_refresh_error`), every other failure is transient. |
| Refresh error body | CLIProxyAPI returns the status only | Already matched and stricter. The upstream body is never relayed; a rejected refresh returns the error code alone. |
| Identity headers on sign-in, poll and refresh | CLIProxyAPI `kimi.go` `commonHeaders` sends platform, version, device name, device model and device id; OmniRoute `buildKimiCodeIdentityHeaders` sends those five plus `X-Msh-Os-Version` | **Different.** DurinDoor sends `X-Msh-Platform`, `X-Msh-Version`, `X-Msh-Device-Model` and `X-Msh-Device-Id`. `X-Msh-Device-Name` and `X-Msh-Os-Version` are missing. Staged, see below. |
| Device id origin | CLIProxyAPI `getKimiDeviceID` reads the Kimi Code CLI's own `device_id` file (`~/.local/share/kimi/device_id`, `~/Library/Application Support/kimi/device_id`, `%APPDATA%\kimi\device_id`) and falls back to the literal `cli-proxy-api-device`; OmniRoute `kimi-coding.ts` persists a generated UUID in `<dataDir>/oauth/kimi-coding-device-id` | **Intentionally different.** DurinDoor generates a random UUID per sign-in and stores it on the connection, so one account keeps one identity across refreshes, but it never reads another application's state. The CLI import is left to the auth batch: it reads a file outside the data directory. |
| PKCE and scope | Neither upstream sends a challenge or a scope in the device request | Already matched. `kimi-coding` and `kimi-ai` are registered as no-PKCE device providers. |
| Poll schedule | CLIProxyAPI floors the interval at 5 s and stops after 15 minutes | Intentionally different. The shared OAuth flow owns the polling schedule; the provider returns the provider's interval with a 5 s default. The shared flow is not owned by this unit. |
| Account profile lookup | Neither upstream device adapter retrieves a profile | Already matched. DurinDoor stores the tokens, the expiry and the device identity. |
| `.com` inference transport | CLIProxyAPI `kimi_executor.go` sends bearer authorization to `api.kimi.com/coding`; OmniRoute `registry/kimi/coding/index.ts` uses `KIMI_CODING_ANTHROPIC_URL` | Already matched. `kimi-coding` keeps the native Anthropic transport (`x-api-key`) and the `kmc/<model>` route. |
| `.ai` OAuth inference transport | CLIProxyAPI `ResolveKimiBaseURL` resolves `api.kimi.ai/coding` from the credential domain | Already matched. The `.ai` OAuth connection is translated from Anthropic Messages to the regional bearer-authenticated `/coding/v1/chat/completions` endpoint and the reply is converted back. |
| Kimi Coding request rules | OmniRoute `open-sse/executors/kimi.ts`, `kimiToolNames.ts`; CLIProxyAPI `kimi_executor.go` | Already matched. Model normalization, tool-name completion, `max_completion_tokens`, usage in streams, K3.1 effort defaults, tool-schema inlining and history repair run at the Coding wire boundary. |
| Kimi Coding effort-variant split | OmniRoute `open-sse/utils/kimiCodingEffortVariant.ts` and `open-sse/handlers/chatCore/kimiCodingEffortVariant.ts` strip a known effort suffix (`-medium|-high|-none|-low|-max`) from an id that is not itself a registry id and move it into `reasoning_effort` | **Not adopted.** It needs a registry-model lookup and a chatCore dispatch slot. Both are shared wiring that belongs to the ordered auth batches. DurinDoor's `open-sse/executors/kimiParity.js` already normalizes the `kimi-` prefix and the K2/K3 aliases. |
| Responses compaction | CLIProxyAPI `internal/runtime/executor/helps/kimi_responses.go` `NormalizeKimiResponsesInput` | **Not adopted.** It is a Responses wire rule, not a sign-in contract, and DurinDoor's Responses support for Kimi is limited to the existing API-key route. |
| Thinking signature validation | CLIProxyAPI `internal/signature/kimi_validation.go` | **Not adopted.** Kimi thinking signatures have a fixed length per protocol mode and no self-describing envelope; validating them is an upstream-specific replay rule with no place in the sign-in unit. |
| Scoped thinking replay | CLIProxyAPI `internal/runtime/executor/kimi_thinking_replay.go`, `internal/cache/kimi_thinking_replay_cache.go` | **Not adopted.** Same reason: a stateful replay cache belongs to the thinking contract, not to sign-in. |
| Kimi consumer web session | OmniRoute `open-sse/executors/kimi-web.ts`, `src/lib/kimi/tokenRefresh.ts`, `registry/kimi/web/index.ts` | **Different, and kept apart.** The web session is a browser identity (`www.kimi.com` / `www.kimi.ai`), not a Coding device credential. DurinDoor refreshes it through the `AuthService/RefreshToken` RPC; OmniRoute at this pin uses `GET {base}/api/auth/token/refresh`. The two contracts are not interchangeable and neither is adopted here. |
| Model list | CLIProxyAPI `internal/registry/model_definitions.go` serves one Kimi catalog for the `kimi`, `kimi-ai`, `kimi.ai` and `kimi.com` channels; OmniRoute `registry/kimi/coding/index.ts` has a static Coding catalog | Already matched in effect. DurinDoor keeps a separate catalog per provider id, lists the Coding catalog under the `kmc` alias, and keeps the Moonshot platform catalog (`kimi-k3.1-pro`, …) separate from it. |
| Credential storage and deduplication | CLIProxyAPI writes `<authDir>/kimi-<ts>.json`; OmniRoute writes the shared connection row | Intentionally different. DurinDoor uses the existing OAuth connection model, the active-claim guard and the flow store. |

## Kimi identity separation

DurinDoor exposes four Kimi-shaped identities. They share a name and nothing
else, and the parity test keeps them apart:

| Identity | Endpoint | Credential | Sign-in |
| --- | --- | --- | --- |
| `kimi-coding` (alias `kmc`, `kimi.com`) | `api.kimi.com/coding` | Device grant | Dashboard device code |
| `kimi-ai` (alias `kimi.ai`) | `api.kimi.ai/coding` | Device grant | Dashboard device code |
| `kimi` | `api.moonshot.ai` | API key | API key form |
| `kimi-coding-apikey` (alias `kmca`) | `api.kimi.com/coding` | API key | API key form |
| `kimi-web` | `www.kimi.com` / `www.kimi.ai` | Browser session | Console snippet |

`kimchi` (`src/lib/oauth/services/kimchi.js`) is a **different provider** with a
browser-login callback and no device grant; it is not a Kimi equivalent and
must never be treated as one. The parity test asserts that a `kimchi` device
code request is refused as "Provider does not support device code flow" while
`kimi`, `kimi-web` and `kimi-coding-apikey` are refused as "Unsupported OAuth
provider" — all of them before any network call.

## Staged delta: the Kimi device identity contract

The one shared delta this unit could not apply lives in
`src/lib/oauth/providerParity/kimi/`:

| File | Exports |
| --- | --- |
| `config.js` | `KIMI_CODING_CLIENT_ID`, `KIMI_CODING_CLIENT_ID_ENV`, `KIMI_CODING_PROVIDER_IDS`, `KIMI_DEVICE_PENDING_ERRORS`, `KIMI_DEVICE_POLL_INTERVAL_FLOOR_SECONDS`, `KIMI_DEVICE_POLL_MAX_SECONDS`, `KIMI_DEVICE_TERMINAL_ERRORS`, `KIMI_OAUTH_GRANT_DEVICE`, `KIMI_OAUTH_GRANT_REFRESH`, `KIMI_OAUTH_REGIONS`, `isKimiCodingProvider`, `resolveKimiOAuthRegion` |
| `identity.js` | `buildKimiDeviceIdentityHeaders`, `deriveKimiDeviceIdFromRefreshToken`, `getKimiDeviceFacts`, `normalizeKimiDeviceId`, `resolveKimiDeviceId`, `sanitizeKimiHeaderValue` |
| `index.js` | the public staging exports of both modules |

`registration.json` carries `"registered": false`, the three source pins with
their upstream files, the staged delta, the alias conflicts and the restrictions.

### Central integration slots

The shared OAuth wiring belongs to the ordered auth batches, not to this unit.
These are the exact slots that will consume the staged helper:

1. `src/lib/oauth/providers.js:385` — `kimiDeviceProvider.requestDeviceCode`
   and `.pollToken`: build the identity headers with
   `buildKimiDeviceIdentityHeaders({ platform, version, deviceId })` and keep
   the flow-owned device id in `extraData._deviceId`.
2. `open-sse/config/appConstants.js:254` — `buildKimiHeaders`, and
   `open-sse/config/appConstants.js:270` — `buildKimiDeviceHeaders`: add
   `X-Msh-Device-Name` and `X-Msh-Os-Version`. Keep the legacy
   `X-Msh-Platform: 9router` value for the shared 9router-shaped callers.
3. `open-sse/services/tokenRefresh/providers.js:116` — `refreshKimiToken`:
   replace the `buildKimiHeaders()` fallback with
   `resolveKimiDeviceId({ deviceId: providerSpecificData?.deviceId, refreshToken })`
   so a legacy connection keeps one device across rotations.
4. `open-sse/executors/default.js:331` — `HEADER_HOOKS.kimiHeaders`, and
   `open-sse/executors/default.js:335` — `HEADER_HOOKS.kimiDeviceHeaders`:
   build the identity headers from the stored device id, falling back to the
   stored refresh token.

The registry rows (`open-sse/providers/registry/kimi-coding.js`,
`open-sse/providers/registry/kimi-ai.js`) and the config rows
(`src/lib/oauth/constants/oauth.js:97`, `src/lib/oauth/constants/oauth.js:102`)
already match the pinned upstream and need no change.

## What works in production today

Proven by `tests/unit/provider-signin-kimi-parity.test.js` against the real
route, the real shared OAuth provider objects, the real flow store, the real
refresh manager, the real provider registry and the real chat core. Only the
outbound transport, the credential write and the connection lookups are
substituted; every token is synthetic.

- **Device sign-in**, both regions: the regional device-authorization host is
  called with a form-encoded `client_id` and the `X-Msh-*` identity headers;
  the private device code never leaves the server and the public payload
  carries only the verification fields, the flow id and the expiry.
- **Flow ownership**: a poll for the wrong provider is `400`; a consumed flow
  is `410`; an expired flow is `410`; none of them reaches the provider or
  writes a credential.
- **Pending handling**: `authorization_pending` and `slow_down` keep the flow
  open and write nothing.
- **Terminal errors**: `expired_token` and `access_denied` are relayed with
  `pending: false`, consume the flow and write nothing.
- **Credential write**: exactly one write per accepted sign-in, through the
  existing connection model with the active-claim guard, storing the access
  token, the refresh token, the expiry and the device identity.
- **No duplicate submission**: a second poll of an accepted flow is `410` and
  writes nothing.
- **Two concurrent accounts**: two live flows keep their own device code,
  device id, tokens and proxy selection (`direct` versus `legacy`); polling
  them out of order does not mix them.
- **No secret leakage**: an upstream error body carrying an access token is
  redacted before it reaches the caller, and neither the device code nor the
  upstream secret appears in the response.
- **Unsupported modes fail before network**: `kimi`, `kimi-web`,
  `kimi-coding-apikey` and `kimchi` are refused with no outbound request.
- **Refresh**: the regional token endpoint receives the form grant and the
  stored device identity; a rotated refresh token replaces the old one, an
  omitted one keeps the previous token, and `invalid_grant` is reported as
  `unrecoverable_refresh_error`.
- **Requests and streams**: the `.com` Coding connection serves native
  Anthropic Messages over SSE; the `.ai` OAuth connection translates Anthropic
  Messages to the regional Chat Completions wire and converts the reply back.
- **Model discovery**: `/v1/models` lists the Coding catalog under the `kmc`
  alias while the Moonshot platform catalog stays separate.

## What is staged web wiring, not production

The `X-Msh-Device-Name` / `X-Msh-Os-Version` headers and the stable device id
for a connection without a stored device id **do not run in production yet**.
They exist only in `src/lib/oauth/providerParity/kimi/identity.js`, and the
parity test keeps their assertions in one isolated block
("Staged Kimi device identity helper (#2034 staging)") so that the protocol,
security and usage cases never depend on staged code. The helper is web-safe:
it lives in the Next.js OAuth tier, imports no `open-sse` module, and has no
import-time side effect.

The staged derivation matches the pinned upstream byte for byte:
`pbkdf2Sync(refreshToken, "kimi-device-id", 1000, 16, "sha256")` grouped as a
UUID, which is `b626e452-94bb-a899-2d02-6bf79b903219` for the synthetic token
`sk-kimi-refresh-1`.

## Per-provider user steps

**Kimi Coding (`.com`, alias `kmc`)** — dashboard → Providers → **Kimi Coding**
→ *Connect* → the verification URL and the user code appear → open the URL,
confirm the code → the dashboard polls until the provider answers → the
connection is saved with the tokens, the expiry and the device identity. Model
routes are `kmc/<model>` (`k3`, `k3.1-pro`, `kimi-for-coding`, …).

**Kimi Coding International (`.ai`, alias `kimi.ai`)** — the same flow against
`auth.kimi.ai`; the verification page is `https://www.kimi.ai/code/authorize_device`.
Model routes are `kimi.ai/<model>`.

**Kimi (platform API key)**, **Kimi Coding API key** and **Kimi Web** have no
device flow. The first two use the API-key form; Kimi Web asks for the console
snippet from `www.kimi.com` or `www.kimi.ai`. None of them can be created
through the Kimi Coding device flow, and the parity test asserts the refusal.

## Verification

```
cd tests && test -f unit/provider-signin-kimi-parity.test.js && \
  node node_modules/vitest/vitest.mjs run unit/provider-signin-kimi-parity.test.js --maxWorkers=2
```

23 tests, all passing, with a private `HOME`, `DATA_DIR` and cache directory
and a credential-free child environment. No live account, browser, Docker,
provider traffic or secret store was used. The existing regression files were
not modified.

## Unverified and out of scope

- Live account eligibility and whether Kimi accepts DurinDoor's client id, its
  `X-Msh-Platform: DurinDoor` value and its device identity.
- Whether Kimi requires `X-Msh-Device-Name` or `X-Msh-Os-Version`. Both
  upstreams send them, but no server source was available, so the staged
  headers are a source-aligned improvement and not a proven requirement.
- Whether Kimi's anti-bot pipeline actually penalizes a changing device id, and
  whether the deterministic derivation is accepted.
- Regional quota, model discovery and booster billing against a live account.
- The managed EasyCLIProxyAPI core build and its Kimi Code CLI launch
  configuration against a real installation.
- The Kimi consumer web session refresh contract. DurinDoor's
  `AuthService/RefreshToken` RPC and OmniRoute's
  `GET {base}/api/auth/token/refresh` are different contracts; neither is
  verified here, and they stay separate from the Coding device credential.
