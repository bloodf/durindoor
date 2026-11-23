# Claude Code sign-in and request comparison (#2034)

## Follow-up comparison at the requested revisions

This follow-up starts at DurinDoor `c0197475c1` and uses CLIProxyAPI
[`6eb8554f0ede`](https://github.com/router-for-me/CLIProxyAPI/tree/6eb8554f0ede597b2aa3e508ffb3f111d3c2b9e6)
and OmniRoute [`5ffa68e83544`](https://github.com/cheaper-inference/OmniRoute/tree/5ffa68e835442a12ed1204a2eebf4076c298aecb).
The historical comparison below uses its own revisions.

| Behavior | Upstream source | DurinDoor state |
| --- | --- | --- |
| Authorization URL, client ID, browser login prompt | CLIProxyAPI `internal/auth/claude/anthropic_auth.go` and OmniRoute `src/lib/oauth/providers/claude.ts` | Already matched. The shared public client ID and Claude authorization URL are in the registry. Both DurinDoor sign-in paths include OmniRoute's `prompt=login`. |
| Device or browser callback | CLIProxyAPI `oauth_server.go` and OmniRoute `src/lib/oauth/constants/oauth.ts` | Already matched for OmniRoute's dashboard manual-code redirect and authorization-code flow. Intentionally different from CLIProxyAPI's fixed loopback port. DurinDoor binds the chosen redirect to its stored flow. Neither pinned OAuth implementation uses a device grant. |
| PKCE and callback state | CLIProxyAPI `pkce.go`, `parseCodeAndState` and OmniRoute `providers/claude.ts` | Already matched. Both sign-in paths use S256 and split the pasted code fragment. The dashboard requires an independently bound flow and state. |
| Authorize and refresh scopes | CLIProxyAPI `ClaudeOAuthScope` and OmniRoute `CLAUDE_CONFIG` | Already matched for profile, inference, Claude Code sessions, MCP and the authorize-only Console scope. Intentionally different for CLIProxyAPI's file-upload grant. This OAuth transport has no native file-upload flow. |
| Exchange payload and errors | CLIProxyAPI `ExchangeCodeForTokens` and OmniRoute `providers/claude.ts` | Already matched for JSON, the verifier, state, and failure on non-2xx. The token endpoint follows OmniRoute's `api.anthropic.com` host. |
| Exchange and refresh client fingerprint | CLIProxyAPI `applyClaudeOAuthAxiosHeaders`, `utls_transport.go` | Intentionally different. DurinDoor uses its existing fetch and proxy transport with JSON negotiation, without adopting client impersonation or TLS fingerprinting. |
| Refresh grant and successful response | CLIProxyAPI `refreshTokensSingleFlight` and OmniRoute `open-sse/services/tokenRefresh/providers/claudeOAuth.ts` | Already matched for scope, OAuth beta, expiry and retaining the old refresh token when omitted. DurinDoor follows CLIProxyAPI's JSON and OmniRoute's host. |
| Permanent refresh errors, refresh 429, concurrent refresh | OmniRoute `claudeOAuth.ts` and `shared.ts` and CLIProxyAPI `anthropic_auth.go` | Already matched by the retry base. The Claude refresher classifies nested or plain permanent errors, deduplicates refresh by token and honors bounded 429 windows. |
| Transient refresh retries | CLIProxyAPI `RefreshTokensWithRetry` and OmniRoute `claudeOAuth.ts` | Intentionally different from CLIProxyAPI's internal retry loop. DurinDoor returns a transient failure to its existing credential lifecycle and applies its centralized retry policy. |
| Profile, plan and organization data | CLIProxyAPI `inspectOAuthAccount` and OmniRoute `fetchClaudeBootstrap` | Already matched for the best-effort account, organization and tier lookup. DurinDoor uses the scoped profile endpoint with its established field names. The roles endpoint and bootstrap-specific fields are outside the current connection schema. |
| Identity fallback when profile lookup fails | CLIProxyAPI `ExchangeCodeForTokens` | Intentionally deferred by work-order scope. In `src/lib/oauth/providers.js`, Claude `mapTokens` should prefer populated profile values and fall back field by field to `tokens.account.email_address`, `tokens.account.uuid`, `tokens.organization.uuid` and `tokens.organization.name`. |
| Credential storage, deduplication and reconnect | CLIProxyAPI `filename.go`, `token.go` and OmniRoute `mapTokens` | Intentionally different. DurinDoor persists credentials in the connection database and deduplicates using the stored organization and flow identity, independent of CLI credential filenames. |
| Imported inference-only setup tokens | OmniRoute `importSetupToken` and CLIProxyAPI `isClaudeSetupToken` | Intentionally different. DurinDoor's shared OAuth provider entry handles authorization-code sign-in. Adding a setup-token provisioning and validation flow would change that entry. |
| Messages path and auth | CLIProxyAPI `claude_executor_execute.go`, `claude_executor_stream.go` and OmniRoute `open-sse/executors/base.ts` | Already matched. OAuth uses bearer authorization on `/v1/messages?beta=true`. API-key auth is separate. |
| Transport headers and user agent | CLIProxyAPI `applyTransportNegotiation`, `doClaudeUpstreamRequest` and OmniRoute `claudeIdentity.ts` | Ported here for JSON vs SSE Accept negotiation and streaming identity encoding. Fetch owns nonstream decompression. User agent, identity headers and wire casing stay on the existing transport. |
| Functional betas and request envelope | CLIProxyAPI `extractAndRemoveBetasDoc`, `claudeCodeCLIBetas`, `disableThinkingIfToolChoiceForcedDoc` and OmniRoute `claudeIdentity.ts`, `claudeOauthBodyIsolation.ts` | Ported here for body beta promotion, speed, per-message output config, inline tools, binding, safeguards, diagnostics and threads. Forced tool choice drops incompatible thinking and effort while retaining output format. DurinDoor applies a functional allowlist for explicit flags and retains its existing client baseline. |
| Thinking, cache and translated payloads | CLIProxyAPI `claude_executor_request.go`, `claude_executor_compaction.go` and OmniRoute `claudeThinkingOptions.ts` | DurinDoor intentionally uses its existing model-capability, translator, cache and thinking policies. Native request compatibility features anchored to the upstreams' CLI wire profiles, stateful tool aliases or app-level compaction are separate contracts. |
| Count tokens | CLIProxyAPI `claude_executor_tokens.go` | Already matched at the route level. DurinDoor supports upstream counting for Claude-compatible connections and a local estimate when native counting is unavailable. DurinDoor keeps its existing count-token beta profile. |
| Fast request retries and 429 entitlement | CLIProxyAPI `claude_executor_fast_error.go`, `classifyClaudeUpstreamErrorWithCooling` | Ported here. Request-scoped refusals bypass executor replay, auth/signature retries, sibling rotation, combo fallback and synthetic deadlines. The client receives a fixed entitlement message for recognized Fast credit refusals. Other 429 text follows the existing redaction policy. |
| Unified quota vs overage-only rejection | CLIProxyAPI `helps/claude_ratelimit.go` | Ported here. Shared-usage rejection takes precedence over Fast entitlement text and carries account-wide cooldown evidence. Rejected window deadlines are bounded. A Fast overage-only refusal leaves the shared account available. Standard model rate limits retain DurinDoor's existing policy. |
| Usage low-priority lane and banked limits | OmniRoute `claudeUsageLimit.ts` | Intentionally different. DurinDoor uses existing quota preflight, failover and explicit reset controls. OmniRoute's opt-in slow lane and automated reset claims would change admission and consume account grants. |
| HTTP overload and response envelopes | CLIProxyAPI `classifyClaudeUpstreamErrorWithCooling` | Ported here for sanitized typed overload envelopes. Fast errors go straight to the caller. Standard traffic retains configured retries and account/model failover for upstream status failures. |
| Streaming errors, terminal events and truncation | CLIProxyAPI `claude_executor_stream.go` and OmniRoute `base.ts` | Already matched for native SSE translation and coherent `message_stop` checks. Ported here for Fast stream failures, which bypass early sibling replay and empty-stream cooldown. A caller receives the error event even when it arrives before any content. |
| Model list | CLIProxyAPI `internal/registry/models/models.json` and OmniRoute `open-sse/config/providers/registry/claude/index.ts` | Ported here for the four missing IDs present in both upstreams, marked legacy. DurinDoor retains Fable 5.2 and omits the five older IDs listed only by CLIProxyAPI. The latter are outside DurinDoor's supported legacy catalog. |
| Claude Web and identity cloaking | OmniRoute `claude-web.ts`, `claude-web/`, `claudeIdentity.ts` and CLIProxyAPI `identity.go`, `claude_executor_cloaking.go` | Intentionally out of scope. Claude Web uses a separate session transport. Existing identity, session-synthesis and cloaking rules were left alone. |

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
