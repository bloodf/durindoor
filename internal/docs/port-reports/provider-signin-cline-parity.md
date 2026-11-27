# Cline sign-in and request parity (#2034)

## Sources

- OmniRoute (MIT), commit `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`: `src/lib/oauth/providers/cline.ts` implements extension authorization, an embedded base64 JSON callback and an opaque-code fallback. `src/lib/oauth/providers/index.ts` registers that same OAuth object for ClinePass. `open-sse/config/providers/registry/{cline,clinepass}/index.ts` keeps the variants and model namespaces distinct; both force upstream streaming. `open-sse/services/tokenRefresh/providers/cline.ts` posts a JSON refresh grant. `src/shared/utils/clineAuth.ts` describes Cline client and optional task identity headers; `open-sse/services/clinepassModels.ts` describes catalog discovery.
- CLIProxyAPI (MIT), commit `dbe641f286a489ecb39e3c041c554371e6add864`: its pinned tree has no Cline-named provider source. `internal/runtime/executor/openai_compat_executor_compact_test.go` uses ClinePass model IDs in generic OpenAI-compatible tests; this does not establish a Cline sign-in contract.
- EasyCLIProxyAPI (MIT), commit `29567ead8164a00724dfdc2087f02a23895636ee`: its pinned tree has no Cline-named provider source. No Cline OAuth, session, device, or CLI-import contract is established there.

## Production behavior and user steps

Choose **Cline** for the general catalog, or **ClinePass** for its subscription namespace. Start authorization in the dashboard and complete the browser callback. The existing route binds the flow ID, provider and state before exchange, consumes the claim after completion and stores the existing connection model. Neither object uses a PKCE challenge; the generic generator's verifier does not turn this into a PKCE flow. Device flow is rejected before network. No supported Cline session or CLI credential-import contract was found in these sources; do not infer one.

Both variants accept an embedded callback locally and fall back to the configured token endpoint for opaque codes. Both use the existing JSON refresh service. API keys and OAuth tokens are distinct credential forms; request headers use the selected connection and add `workos:` to JWT-shaped OAuth tokens. ClinePass short model IDs map to `cline-pass/` wire IDs. Its discovery uses the public recommended feed and falls back to the authenticated catalog. Cline's live catalog is disabled by default, leaving the static catalog as fallback. Both use the OpenAI-compatible chat endpoint with forced upstream streaming; chatCore converts the stream for non-stream clients. Existing tests `cline-signin-parity.test.js`, `clinepass-token-refresh.test.js`, `port9r-clinepass-feed-4674.test.js` and `port9r-cline-force-stream-4267.test.js` cover portions of these paths.

## Staged changes and limitations

Production exchange currently accepts a decoded tokenless object and includes the upstream response body in opaque-code exchange errors. The unregistered `providerParity/cline/exchange.js` exports `validateClineTokens` and `clineExchangeFailure` for both provider exchange implementations. The unregistered `headers.js` exports `applyClineTaskIdentity` for the shared executor's final header layer: it removes stale task IDs and propagates only a bounded, safe caller-supplied ID. `registration.json` lists the precise integration slots. No staged helper affects production until the ordered shared wiring is applied; existing route ownership and storage must be retained.

## Test coverage

`tests/unit/provider-signin-cline-parity.test.js` holds 28 closed-network cases. They run the real provider objects, OAuth route, refresh service, model service, `DefaultExecutor` and `handleChatCore` with synthetic credentials. Transports are replaced only at `fetch` or at the `proxyFetch` test seams (`__setOriginalFetchForTesting`, `__setProxyDispatcherForTesting`). Request logging and usage persistence are stubbed.

Production behavior (passes today, no staging dependency):

- Sign-in: state-bound authorization URL without PKCE, embedded and opaque callbacks, device flow rejected before network, route state mismatch, single consumption and replay `410`.
- Refresh: concurrent accounts stay distinct, and a rejected refresh returns no credential and does not log the body. Concurrent refreshes of the same token are coalesced by the existing `dedupRefresh`, so only one grant is sent. Opaque access tokens are stored as issued; only JWT-shaped tokens get the `workos:` prefix.
- Selected-proxy identity: concurrent Cline and ClinePass requests and refreshes each leave through their own connection proxy dispatcher, with their own bearer or refresh token. No send falls back to direct egress, and credentialed sends refuse redirects. A strict connection with no usable proxy fails without any send. The executor still runs its network-error retry delays for that configuration error; the test advances them on a fake clock. Concurrent opaque-code exchanges pass each flow's own `proxyOptions` to the patched global `fetch`. That boundary is asserted; proxy routing behind it is covered by the executor and refresh cases.
- Deadlines and cancellation: an aborted signal stops `exchangeTokens` and `execute` before transport. A caller abort during a send propagates as `AbortError` (`errorKind: "aborted"`) after one dispatch. A stalled upstream ends at the header deadline (`FETCH_CONNECT_TIMEOUT_MS`, fake clock) with `errorKind: "connect_timeout"` and one dispatch.
- Request and stream translation: an Anthropic Messages client is translated to the OpenAI chat wire with `stream: true` and the `cline-pass/` model namespace. The system prompt becomes a system message, and the Cline SSE comes back as a JSON `message` or as Anthropic stream events without `[DONE]`. A stream that fails after Cline accepted it is not resubmitted, and the upstream error text and API key do not reach the client body.
- Catalog: the ClinePass public tier is fetched without an `Authorization` header and keeps its wire IDs.

Staged only (one isolated `staged web integration` block): `applyClineTaskIdentity`, `validateClineTokens` and `clineExchangeFailure`. These tests pass against the helpers but do not prove production behavior until auth04 wires the slots in `registration.json`.

## Known gaps

- The production exchange checks its abort signal only before the request. It does not pass the signal to `fetch`, so an in-flight opaque-code exchange cannot be cancelled and has no deadline of its own.
- The production exchange accepts a tokenless decoded object and puts the upstream response body in its error message. The staged helpers close both gaps once they are wired in.
- No live upstream behavior was exercised. No real accounts, secret stores or browser launches were used. Existing regression files are unchanged.
