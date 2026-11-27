# Kiro sign-in and request parity — Refs #2034

## Source and attribution

DurinDoor and the compared source are MIT projects. Protocol comparison and the
small registration payload helper attribute OmniRoute commit
`b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`, specifically
`src/lib/oauth/providers/kiro.ts`, `src/lib/oauth/services/kiro.ts`,
`open-sse/services/kiroExternalIdp.ts`, `open-sse/executors/kiro.ts`,
`open-sse/translator/request/openai-to-kiro.ts` and
`open-sse/translator/response/kiro-to-openai.ts`.
All three shared source-cache HEADs were verified before inspection.

CLIProxyAPI `dbe641f286a489ecb39e3c041c554371e6add864` and EasyCLIProxyAPI
`29567ead8164a00724dfdc2087f02a23895636ee` have no tracked Kiro-named
provider files, and `git grep -iE 'kiro|codewhisperer|external_idp' HEAD --
internal/auth internal/runtime/executor` finds no matching provider source.
Those source paths do not establish a Kiro wire contract. The existing local
CLIProxyAPI-named import route is a compatibility label, not evidence that either
pinned Go repository implements Kiro. No unsupported Go implementation is inferred.

OmniRoute's external-IdP helper describes broader enterprise issuer support.
DurinDoor supports only the existing Microsoft login host allowlist; it does not
claim parity for Okta, arbitrary OIDC discovery, or a new external-IdP browser flow.

## Production behavior and user steps

- Builder ID: select Kiro and Builder ID, open the device verification URL and
  approve the displayed code. The existing provider registers an OIDC public
  client, includes the Builder issuer, retains the client secret server-side,
  and polls the issuing region with the device grant.
- IAM Identity Center: supply the organization's start URL and SSO region, then
  approve the device code. Production provider registration already omits the
  fixed Builder issuer. Keep the issuing client/region for refresh; a Q profile
  can live in a different supported runtime region. Profile discovery is best
  effort and must not rewrite the account's profile identity.
- Google/GitHub: select that social provider and approve the server-bound social
  device flow. The existing PKCE manual callback remains supported; paste the
  complete callback into the existing flow UI. State, verifier, ownership and
  single-claim enforcement remain in the existing shared flowStore/handlers.
- Refresh-token import: paste the supported `aorAAAAAG` social token through the
  existing import UI. This service validates it by refresh. An unrelated cached
  OIDC registration must not be adopted. Builder/IDC refresh requires the actual
  issuing client registration; arbitrary new registration cannot repair a token
  issued to another client.
- External IdP: import the existing compatible auth JSON with access/refresh
  tokens, client ID, Microsoft token endpoint, scopes, profile ARN and region.
  Refresh uses a form-encoded public-client grant at that endpoint. This import
  does not launch a new enterprise sign-in. Expired imported credentials need a
  successful refresh; timestamps alone do not validate tokens. Runtime uses
  `TokenType: EXTERNAL_IDP` and the supplied profile identity.
- API key: use the existing API-key import UI and auto or supported explicit
  region. Amazon Q model probing establishes validity; profile discovery is
  optional. API keys do not use refresh tokens.

This change corrects the production service's upstream-body/transport-error
exposure, rejects unknown social/refresh modes before transport, validates token
responses, rejects decorated Microsoft endpoints, and bounds individual calls to
30 seconds (existing API-key probes retain their 10-second deadline). Redirects
fail instead of forwarding credentials. Service methods do not retry accepted
code exchanges and do not schedule polling themselves. Existing web polling owns
pending/slow-down scheduling and deadline/abort handling.

Optional proxy arguments now reach model listing and API-key probes/profile
requests. Callers must supply the selected connection proxy; no ambient route is
invented. The existing legacy service model-list operation remains the
CodeWhisperer us-east-1 JSON target; this patch does not assert that it discovers
every regional enterprise model. Existing runtime catalog/executor code owns
regional inference. Stable request identity continues to use the existing client,
refresh token or profile seed; two concurrent service refreshes retain separate
client, token and proxy tuples.

Direct Claude translation already exists and remains unchanged. The unchanged
`tests/translator/claude-kiro-direct.test.js` exercises direct request tool/result,
thinking intent and Claude response/stream behavior; no OpenAI pivot is added.

## Staged shared web integration

`src/lib/oauth/providerParity/kiro/index.js` exports exactly
`buildKiroRegistration(config, authMethod)`. Its `registration.json` identifies
`kiro.requestDeviceCode` in `src/lib/oauth/providers.js` as the optional central
integration slot. It consolidates the already-correct Builder/IDC issuer
selection. It is **not registered in production**. The ordered auth batch can
adopt it while retaining the current provider object, region/start URL validation,
selected proxy, token mapping, flowStore state/PKCE/ownership guards and storage.
There is no separate auth framework or gateway. Staging-only test assertions are
in one isolated describe block; protocol tests call real production code directly.

## Evidence and limits

`tests/unit/provider-signin-kiro-parity.test.js` uses the actual provider and
service with mocked fetch transports and synthetic credentials. Coverage includes
regional registration/device exchange, social create/poll/code exchange, refresh,
rejected/expired/malformed tokens, external import, concurrent account identity,
unsupported modes, model discovery, sanitized failures and fake-clock aborts.
No browser module is invoked, no live accounts or secret stores are read, and
existing regression files are unchanged.

## Contract continuity restoration

Restoration base: `d62248bead6501d33855d07cf1c76c3ad801a1e5`.

Compared original candidate `f1fdf66b0f1b39548906f1922bb13a65c2dd1a59`
against integrated `1cce5b70241acd10e733a83d7012a190bb618e97` and this
worktree. `tests/unit/provider-signin-kiro-parity.test.js` remains byte-identical
(18 cases). All 22 original production test declarations (27 expanded cases)
are retained in the separate `provider-signin-kiro-continuity.test.js`, plus one
owner/single-claim case and two error-redaction cases (30 cases total). The original staging declaration is
superseded as explained below; production expectations are not dropped.

| Original scenario | Retained continuity coverage |
| --- | --- |
| Concurrent regional registration, egress, client and profile | Builder/IDC concurrent account case, including pending and slow_down |
| Server device code, persistence and expiry | Two social accounts, replay rejection and fake server-clock expiry; added owner supersession and simultaneous claim case |
| Server-held PKCE and failed code redaction | Real authorize/exchange routes, forged state and verifier rejection, invalid_grant code |
| Unsupported social methods | Service plus real route reject before transport |
| Separate refresh endpoints | IDC regional JSON, imported social JSON, Microsoft form grant and selected egress |
| Permanent versus transient failures | Three dead-grant formats with safe code/status metadata; HTML 503 remains recoverable |
| Unsupported refresh modes/configuration | API key, empty token, invalid region and non-Microsoft IdP fail before transport |
| Same-grant coalescing versus two grants | Real runtime refresh function, two calls for three concurrent requests |
| CLIProxyAPI-compatible external import | Real import route, no network, JWT email/expiry and retained profile ARN |
| Strict external IdP binding | Non-Microsoft, HTTP, missing profile and social-labeled external files rejected; supported Google/GitHub routes exercised separately |
| IDC import | Real regional refresh/import, rejection body suppressed |
| API-key route | Real probe/import, strict selected pool on every call and stored metadata, overlapping submit persisted once, unknown pool and malformed region rejected |
| Selected-account catalog | Each account's bearer, profile, region and egress through real catalog resolver |
| Direct Claude tools/thinking | Real direct translator and executor headers, profile identity and regional URL |
| EventStream reasoning/text/tools | CRC-framed reply through real executor to SSE deltas and tool_calls finish reason |

The actual API-key route had lost selected-proxy resolution, metadata persistence,
in-flight submission coalescing and message-only logging. These are restored from
the original runtime patch. Service failures again carry recognized OAuth/AWS identifier,
HTTP status and permanent-grant metadata through the production-local
`kiroRefreshFailure.js`; generic unclassified 4xx wording remains compatible with
the existing 18 cases. Unknown identifiers are dropped as well as free text: a
short upstream string may itself be a credential. Existing transport deadlines, redirect rejection, token
response validation and strict Microsoft endpoint decoration checks remain active.

Adaptations: the old `/google.*github/` service wording assertion now matches
`Unsupported`, and the API-key refresh assertion matches `Unsupported` rather
than `no refresh token`. Both still assert rejection before transport. The old
staging test expected broader IdP validator/catalog-header exports and integration
slots from the original candidate. Those exports are absent from integrated
`1cce5b7024`; its sole staged export is `buildKiroRegistration`. The unchanged
18-case file asserts that current staging contract. OmniRoute
`b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`
`open-sse/services/kiroExternalIdp.ts:50-103` describes broader enterprise hosts,
but the production Microsoft-only importer is a deliberate supported boundary,
not an obsolete requirement to broaden it. Catalog EXTERNAL_IDP headers and
runtime permanent-refresh dispatch are not newly registered here. Runtime
`open-sse/services/tokenRefresh/providers.js` still returns null on rejected
refreshes; the restored permanent-error metadata applies to KiroService. Shared
dispatcher integration stays with auth02. No credential-store framework is added.

The API callers can provide `proxyMode` and `proxyPoolId` for API-key import;
the existing dashboard form does not yet supply those fields. Sequential imports
can still create separate rows; only overlapping identical submissions coalesce.
Existing global Kiro/Amazon Q regression files are preserved. No unknown network
failure is diagnosed as a code defect by this restoration.

## Restoration verification

All installs and executable checks used a private `/var/tmp/kiro-2034-private`
HOME/DATA/TMP/XDG/npm/pnpm store environment, `env -i`, explicit PATH,
`umask 077`, 300-second command limits and at most two Vitest workers. Root,
CLI and tests dependencies were installed with `--frozen-lockfile --prefer-offline`;
packages absent from the private store were downloaded. No source-only install,
real user data, inherited publisher/provider credentials or live provider calls
were used. The optional tls-client-node install reported a skipped download;
this is not evidence of a Kiro code defect. CodeGraph was unavailable in this
private environment, so source reads were bounded to known repository paths.

The focused 12-file command passed **111 tests**, including 30 retained/new
continuity cases, the unchanged 18 cases and 63 existing regression cases.
Explicit files: `provider-signin-kiro-continuity`, `provider-signin-kiro-parity`,
`kiro-signin-parity`, `oauth-kiro-social-bound-flow`, `kiro-external-idp`,
`kiro-refresh-proxy-routing`, `kiro-outbound-validation`, `kiro-models-api-key`,
`amazon-q-signin-parity`, `amazon-q-provider`, `amazon-q-route` (all under
`tests/unit`, suffix `.test.js`) and `tests/translator/claude-kiro-direct.test.js`.
Command: `node tests/node_modules/vitest/vitest.mjs run --config tests/vitest.config.js
<explicit files> --maxWorkers=2`.
Scoped ESLint and configured oxlint passed for the changed production files;
ESLint also covered the new retained test. `git diff --check` and commitlint
on the restoration commit message passed; the existing 18-case file was checked
byte-for-byte against `1cce5b7024`. Raw evidence: private `regressions.log`,
`continuity.log`, `lint.log`, `anti-slop.log`. No full suite, browser, E2E, live
provider, listener, Docker, deployment, Actions or settings change was run.
The earlier candidate's 68-file/472-assertion receipt is historical, not this
revision's validation count. Full CI and independent merge review are not claimed.
