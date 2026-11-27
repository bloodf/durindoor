# GitLab sign-in and request parity (#2034)

## Sources

All three snapshots are MIT licensed and were read from the pinned source cache after checking each HEAD.

- [CLIProxyAPI dbe641f286a489ecb39e3c041c554371e6add864](https://github.com/router-for-me/CLIProxyAPI/tree/dbe641f286a489ecb39e3c041c554371e6add864): no GitLab provider, OAuth or executor source. The only case-insensitive match is `internal/util/github_test.go`, which is unrelated.
- [EasyCLIProxyAPI 29567ead8164a00724dfdc2087f02a23895636ee](https://github.com/router-for-me/EasyCLIProxyAPI/tree/29567ead8164a00724dfdc2087f02a23895636ee): no GitLab match.
- [OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523](https://github.com/cheaper-inference/OmniRoute/tree/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523): `src/lib/oauth/gitlab.ts`, `src/lib/oauth/providers/gitlab-duo.ts`, `open-sse/executors/gitlab.ts`, `open-sse/executors/gitlabResponses.ts`, `open-sse/services/tokenRefresh/providers/gitlabDuo.ts` and `open-sse/config/providers/registry/gitlab-duo/index.ts`. Its executor index maps `gitlab` to a public-completions-only `GitlabExecutor()` and `gitlab-duo` to `GitlabExecutor("gitlab-duo")`, which adds direct access.

The brief's `src/lib/gitlab.ts` does not exist at that commit; the helper is `src/lib/oauth/gitlab.ts`. No GitLab GraphQL request path exists in OmniRoute or in this checkout, so there is no GraphQL behavior to preserve or port.

## What works in production

Provider variants stay distinct. `gitlab-duo` is served by `open-sse/executors/gitlab.js`. The hidden `gitlab` registry entry keeps its own `/api/v4/chat/completions` transport and is not routed through the Duo executor; `new GitlabExecutor("gitlab")` never uses direct access.

Sign-in is unchanged. For either provider, register a GitLab OAuth application with the callback that DurinDoor shows, enter the instance URL and client ID, and complete the browser authorization. The existing route owns state, PKCE verifier and ownership checks; the provider exchanges the code at the selected instance and reads `/api/v4/user`. Duo may instead use deployment client credentials, and the deployment client secret is attached to the code exchange only when the selected instance is the configured one. A personal access token and instance can be entered in the GitLab PAT form; the route verifies `/api/v4/user` without following redirects and stores `authKind: "personal_access_token"`. Neither provider offers device sign-in; `requestDeviceCode` fails before any network call. No CLI or browser-session import exists in any of the three sources.

Duo requests now follow OmniRoute's direct-access flow for OAuth connections (`providerSpecificData.authKind === "oauth"`, which sign-in and refresh both set):

1. A stored `providerSpecificData.gitlabDirectAccess` entry is reused when it was issued by the connection's current instance and expires more than 60 seconds from now (OmniRoute's margin).
2. Otherwise the executor POSTs the OAuth access token to `<instance>/api/v4/code_suggestions/direct_access` through the connection's proxy, with redirects refused and without quota charging.
3. A usable answer sends the completion to `<base_url>/ai/v2/completions` (OmniRoute's `buildGitLabDirectGatewayUrl`) with the gateway token and the returned `X-Gitlab-*` headers.
4. Any failed, rejected or unusable exchange uses the public `<instance>/api/v4/code_suggestions/completions` endpoint with the OAuth token, as before.
5. A gateway 401 or 403 means the gateway did no work. The request is sent once to the public endpoint and the stored entry is cleared. Any other gateway status, a transport error or an abort is final and is not replayed.

PAT and older connections without `authKind` keep the single public-completions request. Model discovery is static in OmniRoute too (two registry models); there is no live discovery to port. Responses are still buffered and returned as JSON or as one synthesized SSE stream.

Executor errors no longer include provider response text. The client receives a fixed message for 401/403, 429 and other statuses, with the upstream status kept.

## Where DurinDoor is stricter than OmniRoute

- The gateway `base_url` must be `https` with no credentials, query or fragment, and it must pass the existing outbound URL policy (`assertOutboundUrlAllowed`, so private hosts need the operator's existing private-provider setting). OmniRoute accepts any URL here.
- Only `X-Gitlab-*` string headers without line breaks are kept, and they cannot override `Authorization` or content headers. OmniRoute spreads every string header after `Authorization`.
- An entry is stored only with an `expires_at`. OmniRoute treats an entry without expiry as valid forever.
- Stored entries record their issuing instance and are ignored for any other instance.
- OmniRoute replays any non-OK gateway response to the public endpoint; DurinDoor replays only auth rejections, so accepted work is not submitted twice.
- OmniRoute writes its cache as `{ token, baseUrl, expiresAt }` but reads it back with the wire parser that expects `base_url` and `expires_at`. At b15b2ee6 its stored entries are therefore never reused. DurinDoor reads the stored shape it writes.
- OmniRoute's login `postExchange` performs the direct-access exchange against the deployment default instance, not the selected one. DurinDoor does not exchange at login; the first request does it against the connection's own instance.

There is no module-level credential cache. Every value comes from the request's own credentials.

## Staged, not active

`src/lib/oauth/providerParity/gitlab/registration.json` lists the exact exports and slots.

- Storing the gateway entry. The executor calls `persistGitLabDirectAccess(entry | null)` when the caller supplies it. Production dispatch does not supply it yet, so each OAuth Duo request performs one exchange and nothing is stored. Slots: `src/sse/handlers/chat/singleModel/dispatch.js` and the `executor.execute` call in `open-sse/handlers/chatCore.js`.
- Refresh binding. `refreshGitLabDuoToken` in `open-sse/services/tokenRefresh/providers.js` still sends the deployment client secret to whatever instance the connection names. That is an open production gap. `bindGitLabOAuthClient` attaches the secret only when both the instance and the client ID match the deployment, and it keeps per-connection token URL, client and dedup key. The proxy argument stays as it is.

OmniRoute's tool-call emulation and its bounded tool-exchange prompt are not part of this sign-in unit and were not ported.

## Tests

`tests/unit/provider-signin-gitlab-parity.test.js` uses the real providers, PAT route, refresh service and executor. Fetch and DNS are faked, the proxy transport is replaced so each send's route is visible, and the clock is faked for expiry. It covers device rejection; exchange-body non-disclosure; concurrent PKCE exchange identity; deployment-secret disclosure on the code exchange; PAT verification and storage; concurrent refresh identity; refresh rejection; legacy public completions for untyped, PAT and hidden `gitlab` connections; fixed error bodies; and buffered streaming. For direct access it covers two concurrent accounts with their own instance, gateway, token, headers and proxy; reuse until 60 seconds before expiry and re-exchange after; issuer mismatch; entries without expiry; exchange fallback for 401, 403, 404 and 500; rejected gateway URLs and tokens; a single replay after a gateway 401; no replay after 429, 5xx or a transport error; cancellation during the exchange; streaming; and absence of the deployment secret on the request path. The staged binding has its own isolated block. Existing regression files are unchanged and still pass.

The tests do not cover the web route's state ownership, which existing route tests own, or the unregistered store and refresh slots.
