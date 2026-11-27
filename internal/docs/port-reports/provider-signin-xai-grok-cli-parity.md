# xAI and Grok CLI sign-in comparison (#2034)

## Production and staged work

The production `xai` provider uses browser authorization code with PKCE, state and the 56121 loopback callback. Choose xAI in the dashboard and complete browser authorization. Its CLI service now caches successful discovery by proxy object, retries discovery after fallback, and reports token endpoint HTTP status without copying response bodies into errors. The existing web discovery cache and web exchange errors are unchanged.

The separate production `grok-cli` provider uses device authorization: choose Grok CLI, visit the displayed verification URI and enter its code. It uses the Grok CLI service identity and its own device scope. Production does not offer the staged browser and imported-token helpers. The latter accept a raw JWT or an explicitly selected auth.json entry and avoid retaining the full file. They do not validate JWT signatures, which must not be used to authorize users. Expired imported credentials remain eligible for refresh. `registration.json` lists the exports and integration slots; shared flow ownership, state, proxy selection and storage must be wired by the ordered auth batch before exposing these modes.

The existing Grok CLI executor sends its configured version and model-specific client headers, while xAI uses a separate API identity. The pinned sources do not establish an additional generic audience parameter for these local flows. No new request or streaming wire format is inferred here.

## Source evidence and remaining gaps

The MIT-licensed [CLIProxyAPI `internal/auth/xai/xai.go`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/auth/xai/xai.go) and [`types.go`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/auth/xai/types.go) at `dbe641f286a489ecb39e3c041c554371e6add864` describe OIDC-discovered device authorization, polling and refresh, not the local authorization-code flow. Its device discovery and polling lifecycle are not ported here.

The MIT-licensed OmniRoute [xAI provider](https://github.com/cheaper-inference/OmniRoute/blob/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523/src/lib/oauth/providers/xai-oauth.ts), [Grok CLI provider](https://github.com/cheaper-inference/OmniRoute/blob/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523/src/lib/oauth/providers/grok-cli.ts), [browser helper](https://github.com/cheaper-inference/OmniRoute/blob/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523/src/lib/oauth/providers/grok-cli-oauth.ts) and [OAuth constants](https://github.com/cheaper-inference/OmniRoute/blob/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523/src/lib/oauth/constants/oauth.ts) define separate xAI and Grok Build browser scopes and callback ports, plus Grok device and paste modes. The helper is an adapted staging implementation, not a complete port of the import mapping.

The pinned [EasyCLIProxyAPI tree](https://github.com/router-for-me/EasyCLIProxyAPI/tree/29567ead8164a00724dfdc2087f02a23895636ee) contains no xAI or Grok authentication source path matching those names; `src/services/xaiBilling.ts` is billing, not an authentication wire contract. No auth protocol is inferred from it.

This comparison is incomplete: web response-body leakage, discovery behavior, browser/import wiring, polling deadlines and aborts, full account ownership, model discovery and request/stream translation remain unverified. Tests cover the service authorization URL, per-proxy discovery and refresh, concurrent code exchanges, device request and polling responses, and the isolated staged helpers. They do not establish end-to-end parity.
