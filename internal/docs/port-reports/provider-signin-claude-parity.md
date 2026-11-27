# Claude sign-in and request parity (#2034)

Compared offline against the MIT-licensed projects CLIProxyAPI at
[`dbe641f286a489ecb39e3c041c554371e6add864`](https://github.com/router-for-me/CLIProxyAPI/tree/dbe641f286a489ecb39e3c041c554371e6add864),
EasyCLIProxyAPI at [`29567ead8164a00724dfdc2087f02a23895636ee`](https://github.com/router-for-me/EasyCLIProxyAPI/tree/29567ead8164a00724dfdc2087f02a23895636ee),
and OmniRoute at [`b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`](https://github.com/cheaper-inference/OmniRoute/tree/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523).
No Anthropic account or network request was used.

## Source and user paths

- CLIProxyAPI: `internal/auth/claude/anthropic_auth.go`, `pkce.go` and
  `oauth_server.go` implement browser authorization, a fixed loopback callback,
  JSON exchange and refresh. The user starts Claude OAuth, signs in in the
  browser and completes the loopback callback. Its refresh scope includes
  `user:file_upload`; its token host is `platform.claude.com`.
- EasyCLIProxyAPI: `src/pages/EasyModePage.tsx` offers Claude OAuth and
  `src-tauri/src/management_api.rs` normalizes `anthropic` to `claude` and
  delegates OAuth to its managed core. The user chooses Claude OAuth in the
  desktop app and completes its browser flow. This desktop source does not
  establish an independent Claude token, refresh or inference contract or
  pin the runtime core to the CLIProxyAPI revision above.
- OmniRoute: `src/lib/oauth/providers/claude.ts`,
  `src/lib/oauth/constants/oauth.ts`,
  `open-sse/services/tokenRefresh/providers/claudeOAuth.ts` and
  `open-sse/config/providers/registry/claude/index.ts` implement the manual
  code flow, refresh and catalog. The user chooses Claude, signs in, and pastes
  the returned code. Its setup-token import is a separate inference-only path;
  no equivalent import flow is asserted here.
- Request implementation is in CLIProxyAPI
  `internal/runtime/executor/claude_executor_execute.go` and OmniRoute's
  Claude registry and executor. Both source trees contain additional identity
  and request policies; this report does not claim byte-for-byte equivalence.

## DurinDoor production

The dashboard and CLI provider menu use the existing shared OAuth handler. The
user chooses Claude Code, authorizes a fresh account and enters the code from
the manual redirect. Authorization requests include `prompt=login`, S256 PKCE,
state, redirect and the profile, inference, Claude Code session, MCP and
console scopes. The route binds the supplied state, redirect and verifier to a
claimed flow. The Claude exchange sends JSON to `api.anthropic.com`; refresh
uses the existing token-specific deduplication and proxy route, OAuth beta and
refresh scope. A failed permanent refresh requests reauthentication. Profile
identity takes precedence over token-response account and organization fields.
The expected effect of `prompt=login` on real refresh families is not proven
offline.

Claude has no device flow in the provider entry. Its model inventory is the
local curated registry, not live account discovery. OAuth inference uses the
existing bearer, version and beta headers and `/v1/messages?beta=true`;
existing translation handles OpenAI requests and Claude stream events. Usage
is served by the existing OAuth usage service. These are existing paths, not
new registrations. See `internal/docs/claude-signin-parity-2034.md` for the
previous comparison and detailed request differences.

`src/lib/oauth/services/claude.js` is a separate dead legacy service: its
static `../config/index.js` import does not exist in this checkout, and its
save path names `/api/cli/providers/claude`, for which no route exists here.
The actual CLI menu uses the shared handler. No repair or wire contract is
inferred for the dead service.

## Staged web integration and limits

The production provider exchange currently accepts `code#fragment` and lets
the fragment replace the already bound state without comparing them. It also
throws raw upstream exchange response text internally. The shared flow wrapper
sanitizes failures, but direct provider callers can receive the raw body.
`src/lib/oauth/providerParity/claude/exchange.js` stages
`parseClaudeAuthorizationCode(value, state)` and `claudeExchangeFailure()`;
`registration.json` identifies the integration slot in
`src/lib/oauth/providers.js` `claude.exchangeToken`. Parse before fetch, retain
the route's ownership/state guard, and use the fixed error for non-OK responses.
This is not registered in production; matching fragments continue to work as
before, while mismatched-fragment rejection is only staged. No shared OAuth
wiring or connection storage was changed in this unit.

The focused tests use real provider functions and mocked transports. They cover
two authorization states, JSON exchange and profile/proxy isolation, concurrent
refresh and permanent rejection, device-flow rejection, static catalog,
headers, request and stream translation. They cannot demonstrate provider
acceptance, real session isolation, or network behavior. Existing regression
files remain unchanged.
