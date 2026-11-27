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

Dependencies are reused via local links to the existing installation. No fresh
install or full CI runs during machine I/O pressure. Checks use `umask 077`, a
unique `/var/tmp/kiro-parity-2034.*` evidence directory, private HOME/DATA_DIR/TMPDIR,
XDG/npm caches and pnpm store path, `env -i`, explicit PATH/LANG/CI, five-minute
command limits and at most two workers. Scoped ESLint and configured oxlint
anti-slop cover the changed source. Full CI and independent merge review remain
outside this scoped unit and are not claimed here.

Validation on this revision: exact requested focused command passed **18 tests**;
prior combined scoped run passed **53 tests across five files** (17 parity cases
before the final API-key proxy case, plus 36 unchanged regression cases).
Scoped ESLint and configured oxlint anti-slop passed; `git diff --check` passed.
Raw logs remain in the private run directory as `evidence.log`, `regressions.log`,
`lint.log` and `anti-slop.log`.
