# Codex exchange and workspace sign-in parity (#2034)

## Source and ownership

Verified the read-only source-cache HEADs before inspection:

- CLIProxyAPI `dbe641f286a489ecb39e3c041c554371e6add864`:
  `internal/auth/codex/openai_auth.go` defines browser authorization, form code
  exchange, account extraction and refresh; `sdk/auth/codex_device.go` owns device
  authorization; `internal/auth/codex/siwc_auth.go` defines dynamic ChatGPT client
  enrollment, resource and direct-token scopes. `cmd/fetch_codex_models/main.go`
  is the account catalog implementation. These are MIT sources; this MIT project
  derives the staged exchange form from `openai_auth.go`, retaining attribution
  in the helper. No upstream implementation was copied wholesale.
- EasyCLIProxyAPI `29567ead8164a00724dfdc2087f02a23895636ee`:
  `src/services/oauth.ts` invokes Tauri `start_oauth_login`, `get_oauth_status`
  and `submit_oauth_callback`. It is a desktop management client, not a second
  implementation of the provider token wire protocol. `core-version.txt` says
  `8.1.3`; that is not evidence that its bundled core equals the CPA pin above.
  `src-tauri/src/agents/native_oauth.rs` handles native Codex configuration and
  private files. Do not infer a new OAuth endpoint from these desktop wrappers.
- OmniRoute `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`:
  `src/lib/oauth/providers/codex.ts` defines PKCE URL construction and token
  mapping; `src/lib/oauth/codexDeviceFlow.ts` supplies device authorization;
  `src/lib/oauth/utils/codexAuthFile.ts` and `codexAuthImport.ts` handle imports.
  Its TypeScript provider module is the source, not a hypothetical Go auth file.

Public source roots: [CPA](https://github.com/router-for-me/CLIProxyAPI/tree/dbe641f286a489ecb39e3c041c554371e6add864),
[Easy](https://github.com/router-for-me/EasyCLIProxyAPI/tree/29567ead8164a00724dfdc2087f02a23895636ee),
[OmniRoute](https://github.com/cheaper-inference/OmniRoute/tree/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523).
The cache, rather than a moving branch or these links, supplied this comparison.

## Production today

The central `src/lib/oauth/providers.js` Codex object already supports browser
PKCE and device exchange. Existing flow-store claims, state checks and connection
writes own callbacks. Workspace selection uses `codexWorkspaceFromMeta` and
`requireCodexWorkspace`; printable identifiers work and control bytes, conflicting
selectors and mismatched account claims fail. The new tests confirm this existing
behavior; no duplicate workspace implementation was needed.

Users choose Codex in Providers, authorize in the browser and return through the
loopback callback (port 1455, `/auth/callback`), or use the offered device flow on
headless hosts and approve its user code. Select the intended workspace before
starting. For CLI import, supply the Codex auth JSON through the existing import
UI: nested snake-case tokens and account ID normalize into the existing connection
shape; the independent `OPENAI_API_KEY` is removed. Import is not enrollment or a
new client registration. Refresh belongs to the existing credential manager and
serializer, never to a second sign-in helper.

ChatGPT plan users create/select the dedicated `chatgpt-plan` connection, start
its browser enrollment, approve direct-token/resource scopes and select the
verified account. `chatgptPlanProtocol.js` checks state, nonce, issuer/audience and
issued client identity; `chatgptPlanAccounts.js` owns private records, refresh and
account selection; enrollment binds to a connection snapshot and authenticated
actor. An expired callback fails before transport. A rejected refresh keeps a
bounded protocol error without upstream detail. Codex CLI tokens are not a
substitute for an issued plan client. See `internal/docs/chatgpt-plan-oauth.md`
for the existing enrollment lifecycle and recovery instructions.

Selected-account catalog headers and request/stream translation already have
production implementations. Existing `codex-signin-parity.test.js` exercises the
real provider, OAuth route and catalog with mocked outbound transport;
`codex-executor.test.js` exercises request/stream behavior. Executor/bootstrap and
quota changes remain owned by the CPA quota unit. This unit changes none of them.

`src/lib/oauth/services/codex.js` is a legacy CLI service with a static import of
missing `src/lib/oauth/config/index.js`. Its barrel export does not establish a
working entry point. It also lacks callback-state validation and inherits raw
exchange errors. It was not promoted or represented as production support here.
No new standalone CLI gateway or speculative desktop contract was introduced.

## Staged web integration

The additional export is `exchangeCodexCode` in
`src/lib/oauth/providerParity/codex/index.js`. `registration.json` records its
central integration slot: replace only `codex.exchangeToken` in `providers.js` in
the ordered shared-auth batch. Keep token mapping, provider config, flow claims,
state/PKCE, workspace validation, proxy selection and persistence there. Argument
eight forwards the caller's abort signal; absent a caller signal the helper uses
a 30-second deadline. No shared registration is changed by this unit.

The helper submits exactly once, keeps the selected client and proxy, refuses
missing code/verifier before dispatch, rejects redirects and malformed token
successes, and emits a fixed error for transport, JSON or HTTP rejection. It does
not read failed response bodies, switch to direct egress, refresh credentials or
retry accepted work. Production still uses the old exchange slot, including its
Cloudflare direct-egress fallback and raw error handling, until registration.
This is a staged safety delta, not a claim that production already has it.

## Verification and limits

`provider-signin-codex-exchange-parity.test.js`: 23 closed-network cases, including
concurrent client/proxy/token separation, cancellation, missing PKCE, rejected and
malformed tokens, import isolation, workspace guards, fake-clock expiry and plan
refresh client ownership. All protocol/security cases run independently of the
single isolated registration assertion block. Existing regression files are
unchanged.

The required single-file command passed. Six scoped files passed (97 assertions):
the new file plus `codex-signin-parity`, `chatgpt-plan-oauth`,
`chatgpt-plan-enrollment`, `codex-executor`, and
`port9r-codex-workspaces-1103`. Dependencies were reused from the main checkout
without installation. Tests used umask 077, a unique private `/var/tmp` run,
credential-free `env -i`, private HOME/data/temp/cache/store paths, two workers and
a five-minute command limit. No live account, browser, real secret store, Docker,
full CI or deployment was used. Evidence is retained outside the checkout in the
private run directory. No failure-baseline changes.

This report preserves the exchange candidate comparison. The original 27-case
report and suite are restored alongside it; see
[the restoration record](provider-signin-codex-restoration.md) for current results.
The manifest now retains the seven original helpers and their slots as well as
the exchange slot; none is registered publicly by this restoration.
