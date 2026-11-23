# Claude Code sign-in and request comparison (#2034)

## Follow-up comparison at the requested revisions

| Behavior | Upstream source | DurinDoor state |
| --- | --- | --- |
| Permanent refresh errors in nested, encoded, or plain-text envelopes | OmniRoute `5ffa68e83544`, `open-sse/services/tokenRefresh/providers/claudeOAuth.ts` and `shared.ts` | Ported here for `invalid_grant` and `invalid_request`; transient server errors remain retryable. |
| Executor refresh error propagation | OmniRoute `claudeOAuth.ts` | Ported here: the default executor now uses the Claude refresher, so permanent errors reach credential management. |
| Refresh 429 backoff | CLIProxyAPI `6eb8554f0ede`, `internal/auth/claude/anthropic_auth.go` | Ported here: retry hints are clamped to 5 seconds–5 minutes and shared by token within the process. |
| Refresh token rotation fallback | OmniRoute `5ffa68e83544`, `claudeOAuth.ts` | Already matched: retain the old refresh token if none is returned. |
| Refresh payload | CLIProxyAPI `6eb8554f0ede`, `internal/auth/claude/anthropic_auth.go`; OmniRoute `5ffa68e83544`, `claudeOAuth.ts` | Intentionally different from OmniRoute's form encoding: JSON with scope follows CLIProxyAPI. |

This follow-up table covers the refresh behavior inspected in this change; it is
not a completed function-by-function comparison of the pinned revisions. In
particular, CLIProxyAPI falls back to identity in the token exchange response
when the profile lookup fails. The dashboard's `claude.mapTokens` in
`src/lib/oauth/providers.js` currently uses only the profile result. That file
is excluded by this work order; adding token response account and organization
fallbacks there remains necessary for parity.

Compared on 2026-11-20, without provider credentials or account traffic. Every
statement about an upstream comes from reading the pinned upstream trees at the
SHAs below; none of it is evidence that Anthropic currently accepts any
particular client, model, or account.

## Revisions

| Side | Revision | Note |
| --- | --- | --- |
| CLIProxyAPI `main` | [`6faa8d20b2673404cff70a2f2d9537ae0d0e684d`](https://github.com/router-for-me/CLIProxyAPI/commit/6faa8d20b2673404cff70a2f2d9537ae0d0e684d) | Resolved from the public commits API on 2026-11-20. Subject: `fix(codex): strip uniqueItems keyword from tool parameter schemas`. |
| EasyCLIProxyAPI `main` | [`e4223d5eefa22a3301ca7e2a28d05897432b07f9`](https://github.com/router-for-me/EasyCLIProxyAPI/commit/e4223d5eefa22a3301ca7e2a28d05897432b07f9) | Resolved from the public commits API on 2026-11-20. Subject: `Prepare v0.3.112 release`. |
| OmniRoute `release/v3.8.55` | [`e3c1531afd07d5e06f7ffab658584a7ae2e3627e`](https://github.com/cheaper-inference/OmniRoute/commit/e3c1531afd07d5e06f7ffab658584a7ae2e3627e) | Branch head resolved from the public git-refs API on 2026-11-20. The merged inventory pinned `ab180e32fcdf1f78c96f98a617e17c86e34bf5aa`; the branch moved since. |
| DurinDoor | `d8e71637` | Comparison base for the reproduction, branch `orq/toruzq/signin-claude-a1-l2`. |

The starting inventories are `provider-parity-cliproxyapi.md`,
`provider-parity-easycliproxyapi.md` and `provider-parity-omniroute.md`.

EasyCLIProxyAPI is a desktop console around a separately versioned CLIProxyAPI
core. It owns the guided onboarding and the OAuth start/callback collection, and
delegates every provider contract to that core, so it is not an independent
Claude implementation. Its OAuth identity normalization and callbacks live in
`src-tauri/src/management_api.rs`; the provider identities it exposes are listed
in `src/pages/EasyModePage.tsx`. Nothing in that console establishes a Claude
contract of its own, and the bundled core revision was not independently
resolved from the desktop repository, so EasyCLIProxyAPI is cited as a delegated
path and not as a third contract.

## Upstream sources read

- CLIProxyAPI `internal/auth/claude/anthropic_auth.go` — `AuthURL`, `TokenURL`,
  `RefreshTokenURL`, `ProfileURL`, `RolesURL`, `ClientID`, `RedirectURI`,
  `ClaudeOAuthScope`, `claudeOAuthAuthorizeScope`, `GenerateAuthURL`,
  `ExchangeCodeForTokens`, `RefreshTokens`, `refreshTokensSingleFlight`.
- CLIProxyAPI `internal/auth/claude/pkce.go`, `internal/auth/claude/token.go`,
  `internal/auth/claude/oauth_server.go`.
- CLIProxyAPI `internal/runtime/executor/claude_executor.go`,
  `internal/runtime/executor/claude_executor_auth.go`,
  `internal/runtime/executor/claude_executor_execute.go` — request URL,
  credential injection, header policy, SSE handling.
- OmniRoute `src/lib/oauth/constants/oauth.ts` — `CLAUDE_CONFIG`.
- OmniRoute `src/lib/oauth/providers/claude.ts` — authorize URL and identity
  bootstrap.
- OmniRoute `open-sse/services/tokenRefresh/providers/claudeOAuth.ts` — refresh
  request shape.
- OmniRoute `open-sse/config/providers/registry/claude/index.ts` — provider
  contract and model list.

## DurinDoor surface

| Concern | File |
| --- | --- |
| Provider contract | `open-sse/providers/registry/claude.js` |
| OAuth client configuration | `src/lib/oauth/constants/oauth.js` (`CLAUDE_CONFIG` is projected from the registry) |
| Authorize URL, code exchange, token mapping | `src/lib/oauth/providers.js` (the `claude` entry) |
| Flow binding and callback | `src/app/api/oauth/[provider]/[action]/route.js`, `src/lib/oauth/flowStore.js`, `src/lib/oauth/flowCompletion.js` |
| Redirect URI | `src/lib/oauth/redirectUri.js` |
| Identity bootstrap | `src/lib/oauth/providerHelpers.js` (`fetchClaudeProfile`, `claudeProfileFields`) |
| Refresh | `open-sse/services/tokenRefresh/providers.js` (`refreshClaudeOAuthToken`), `open-sse/services/tokenRefresh.js`, `open-sse/executors/default.js` (`REFRESH_GRANTS`, `refreshCredentials`) |
| Inference | `open-sse/executors/default.js` (`buildHeaders`, `buildUrl`), `open-sse/handlers/chatCore.js` |

Storage boundaries are unchanged by this work: the OAuth flow record, the
verifier and the state stay server-side in `flowStore`, the callback only
carries `code`, `state` and `flowId`, and the connection row is written by
`createProviderConnection` through `saveOAuthConnection`.

## Reproduced defects

The baseline was verified by stashing the fix and running
`tests/unit/claude-signin-parity.test.js`: eight assertions failed against the
pre-change sources, and the same file passes after the change.

1. **The authorize URL reused the browser IdP session.** DurinDoor sent
   `code`, `client_id`, `response_type`, `redirect_uri`, `scope`,
   `code_challenge`, `code_challenge_method` and `state` — and nothing else.
   Anthropic's IdP reuses the stored browser session for every authorization
   request made with this public client id, and the reused session counts as a
   session takeover that invalidates the refresh-token family of the account
   that signed in first. A second Claude connection therefore broke the first
   one. OmniRoute `src/lib/oauth/providers/claude.ts` adds `prompt: "login"` for
   exactly this reason; DurinDoor did not.
2. **The authorize request asked for fewer scopes than both upstreams.**
   DurinDoor requested `org:create_api_key user:profile user:inference`.
   CLIProxyAPI `internal/auth/claude/anthropic_auth.go` requests
   `org:create_api_key user:profile user:inference user:sessions:claude_code
   user:mcp_servers user:file_upload`, and OmniRoute `CLAUDE_CONFIG.scopes`
   requests `org:create_api_key user:profile user:inference
   user:sessions:claude_code user:mcp_servers`. `user:sessions:claude_code` is
   what authorizes the Claude Code session the runtime announces with
   `X-Claude-Code-Session-Id` (`open-sse/executors/default.js`,
   `buildHeaders`).
3. **The refresh request dropped the OAuth-only beta.** Anthropic's OAuth
   control plane answers a grant only when the OAuth beta is present.
   DurinDoor's profile lookup already sent `anthropic-beta: oauth-2025-04-20`
   (`src/lib/oauth/providerHelpers.js`), but the refresh request did not.
   OmniRoute `open-sse/services/tokenRefresh/providers/claudeOAuth.ts` sends it
   on the refresh.
4. **The refresh request dropped the granted scope.** DurinDoor refreshed with
   `grant_type`, `refresh_token` and `client_id` only. A refresh that omits the
   scope can come back down-scoped, which would drop the session and MCP grants
   the authorize step obtained. CLIProxyAPI
   `internal/auth/claude/anthropic_auth.go` sends the granted scope on every
   refresh (`refreshTokensSingleFlight`).
5. **A dead Claude refresh token was treated as a transient failure.** The
   Claude refresher returned `null` for every non-2xx response, so
   `isUnrecoverableRefreshError` (`open-sse/services/tokenRefresh.js`) never
   fired and the consumer kept the stale access token
   (`src/shared/services/providerCredentials.js`). OmniRoute returns
   `{ error: "unrecoverable_refresh_error", code }` for `invalid_grant` and
   `invalid_request`; DurinDoor already had the classifier
   (`classifyOAuthRefreshError`) and used it for Codex.
6. **The server-side default redirect_uri was not a registered Anthropic
   value.** `beginAuthorization` fell back to `http://localhost:8080/callback`
   for every provider. The browser always sends the registered manual-code
   callback (`src/lib/oauth/redirectUri.js`), but a caller that omitted the
   field — a CLI, an SDK, or the management API — sent an unregistered
   `redirect_uri` to Anthropic. OmniRoute fixes the value in
   `CLAUDE_CONFIG.redirectUri`.

## Fixed behavior

- `src/lib/oauth/providers.js`: the Claude authorize URL carries
  `prompt=login`, so each sign-in starts a fresh Anthropic authentication
  instead of reusing the previous account's browser session. The PKCE
  parameters, the `code=true` flag and the state are unchanged.
  `src/lib/oauth/services/claude.js` (the CLI-side `ClaudeService`) carries the
  same parameter, so the two authorize builders cannot drift apart.
- `open-sse/providers/registry/claude.js`: the authorize scope is now
  `org:create_api_key user:profile user:inference user:sessions:claude_code
  user:mcp_servers`, the set both upstreams agree on. `org:create_api_key`
  stays authorize-only, as it is the console scope.
- `open-sse/providers/registry/claude.js`: `oauth.refresh.scope` carries the
  granted token scope (`user:profile user:inference user:sessions:claude_code
  user:mcp_servers`) and `oauth.refresh.headers` carries
  `anthropic-beta: oauth-2025-04-20`. The registry is the single source, so the
  dedicated refresher and the executor's generic grant send the same wire
  contract. `oauth.refresh.headers` is a new optional field; the schema
  comment in `open-sse/providers/schema.js` records it.
- `open-sse/services/tokenRefresh/providers.js`: the Claude refresher sends the
  OAuth beta and the scope, and classifies a permanent rejection through the
  existing `classifyOAuthRefreshError` helper, returning
  `{ error: "unrecoverable_refresh_error", code }`.
- `open-sse/executors/default.js`: `REFRESH_GRANTS` carries the registry
  refresh headers into `refreshWithJSON` / `refreshWithForm`.
- `src/lib/oauth/redirectUri.js` and
  `src/app/api/oauth/[provider]/[action]/route.js`: the server-side default
  redirect_uri for Claude is Anthropic's registered manual-code callback. The
  value is stored in the flow payload, so the token exchange reuses the same
  `redirect_uri` that the authorize request sent.
- `open-sse/providers/shared.js`: `CLAUDE_OAUTH_BETA` is now the single source
  for the OAuth-only beta flag. `src/lib/oauth/providerHelpers.js` uses it in
  place of its literal; the value it sends is unchanged.

The API-key path is untouched: an API-key connection keeps `x-api-key` and the
plain first-party Anthropic-Beta pin, and the OAuth-only beta stays on the
OAuth path only. `tests/unit/claude-signin-parity.test.js` asserts both.

## Compared and deliberately not changed

- **Token and refresh host.** CLIProxyAPI posts the code exchange and the
  refresh to `https://platform.claude.com/v1/oauth/token`
  (`internal/auth/claude/anthropic_auth.go`). DurinDoor and OmniRoute both use
  `https://api.anthropic.com/v1/oauth/token`. Two of the three sources agree
  with DurinDoor, and no reproduced failure justifies moving the host.
- **Refresh body encoding.** OmniRoute sends the refresh grant
  form-urlencoded; DurinDoor and CLIProxyAPI send it as JSON. Both shapes are
  in use by a shipped upstream, so the encoding was left alone.
- **Identity cloaking.** CLIProxyAPI's Claude fingerprint, cloaking and
  session-synthesis machinery (`internal/runtime/executor/claude_executor_cloaking.go`,
  `internal/auth/claude/identity.go`) is deliberately not ported. This work
  order excludes identity cloaking and evasion mechanisms, and DurinDoor's
  existing `CLAUDE_CLI_SPOOF_HEADERS` path is unchanged.
- **Model selection.** DurinDoor's Claude model list is curated in
  `open-sse/providers/registry/claude.js` and differs from both upstream lists
  (OmniRoute `open-sse/config/providers/registry/claude/index.ts` also carries
  `claude-opus-4-6`, `claude-opus-4-5-20251101`, `claude-sonnet-4-6` and
  `claude-sonnet-4-5-20250929`). CLIProxyAPI's `GetClaudeModels` in
  `internal/registry/model_definitions.go` was not enumerated at this revision.
  No model id was added or removed: a catalog difference without a reproduced
  failure is not a defect to fix.
- **Message streaming.** The inference contract already matches: the request
  goes to `https://api.anthropic.com/v1/messages?beta=true`
  (`open-sse/providers/registry/claude.js`, matching CLIProxyAPI
  `internal/runtime/executor/claude_executor_execute.go`), the API-key path
  sends `x-api-key` and the OAuth path sends `Authorization: Bearer`, and the
  Anthropic SSE events are translated by the existing translator.

## Limits

- No live verification. Every upstream statement comes from reading the pinned
  upstream trees at the SHAs above. No provider API was called, no credential
  was used, and no browser, Docker or paid API was involved.
- The reproduction drives the authorize URL, the refresh request and the
  executor header path with mocked HTTP. It does not exercise Anthropic's real
  token issuance, the real IdP session, the real refresh-token rotation, or
  the real `api.anthropic.com` generation path.
- The scope set is the intersection of the two upstreams. CLIProxyAPI also asks
  for `user:file_upload`, which only its newer Claude Code capture needs;
  DurinDoor does not request it, and no reproduced failure requires it.
- The `prompt=login` behavior was not observed against Anthropic. It is
  upstream's documented mitigation for the session-takeover invalidation, and
  its effect on the Anthropic IdP is not verifiable offline.
- `scripts/gen-registry-index.mjs --check` reports the registry index as up to
  date, and the generated provider catalog is byte-identical with and without
  this change. `docs/providers/catalog.mdx` is stale in the base tree for
  unrelated providers (`agy`, `antigravity`, `codex`, `commandcode` and the
  module count); that drift pre-dates this work and was left untouched.
