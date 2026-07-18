# MCP Gateway — OAuth through the gateway

When an MCP instance is registered with `oauth: true`, the gateway manages the upstream OAuth 2.0 access token on behalf of callers.

## What the gateway does

- **Authorization header injection** — `buildHeaders()` in `src/lib/mcp/gateway/httpClient.js` reads the persisted `oauthTokens.access_token` and injects `Authorization: Bearer <token>` into every upstream JSON-RPC request.
- **Token refresh** — `ensureFreshToken()` in `src/lib/mcp/gateway/oauthRefresh.js` checks expiry with a 60-second leeway and refreshes the access token via the provider's `token_endpoint` using the stored `refresh_token`. Rotated tokens are persisted with `updateInstance()`.
- **Single 401 retry** — if an upstream request returns HTTP 401, `mcpRequest()` force-refreshes the token once with `refreshToken()` and retries the same request with the new token. Non-OAuth instances do not retry 401s.
- **Forced-refresh deduplication** — concurrent forced refreshes share one in-flight promise so the same refresh token is not used twice.
- **SSRF protection** — token endpoints and refresh redirects are validated through `assertOutboundUrlAllowed()` before any network call; cross-origin redirects are rejected.
- **Re-login flag** — if refresh fails, the instance's `oauthTokens.needsReauth` is set to `true`, and subsequent requests surface an `McpAuthError` with `status: 401` until the user re-authorizes.

## Token storage

OAuth tokens live in the `oauthTokens` JSON blob on the `mcpInstances` row (see `src/lib/mcp/gateway/oauthRefresh.js`). The gateway stores the full token bundle including metadata (`token_endpoint`, `client_id`, `client_secret`, `resource`, `scope`, `expires_at`, `fetched_at`) so refresh can run without a separate configuration lookup.

## See also

- `src/lib/mcp/gateway/httpClient.js` — upstream JSON-RPC client
- `src/lib/mcp/gateway/oauthRefresh.js` — token rotation helpers
- `docs/pr-mcp-gateway.md` — gateway overview and security model
