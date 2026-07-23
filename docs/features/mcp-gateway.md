# MCP Gateway

The MCP Gateway exposes multiple upstream MCP servers through a single DurinDoor endpoint. Each caller uses a dedicated gateway key that is granted access to specific MCP instances (and, on the backend, to specific tools on those instances). Use it when client tools expect one MCP endpoint but you want DurinDoor to manage upstream instances, OAuth, and per-tool access control.

## What the gateway does

- Merges tools from one or more upstream MCP instances into one JSON-RPC namespace.
- Namespaces every tool as \"<instanceSlug>__<toolName>\" so names from different instances never collide.
- Issues dedicated gateway keys that are only revealed once on creation.
- Can attach OAuth 2.0 access tokens to upstream requests on behalf of an instance.
- Records a usage row for every tool call (ok or error) so you can see traffic through the gateway.

The gateway speaks two transports:

- Streamable HTTP: \"POST /api/mcp-gateway\"
- SSE: \"GET /api/mcp-gateway/sse\" followed by \"POST /api/mcp-gateway/message?sessionId=<sid>\"

Both transports share the same JSON-RPC handler and authentication.

## Prerequisites

- At least one registered MCP instance. A server instance has an upstream URL, a transport type (HTTP/SSE or stdio), optional fixed headers, and an optional OAuth flag.
- An instance is either enabled or disabled; disabled instances are not included in tool lists or dispatch.
- A public HTTPS origin for the DurinDoor dashboard when OAuth is used (see \"MCP Gateway OAuth\" below).

## Managed routes and keys

| Route | Method | Purpose |
| --- | --- | --- |
| \"/api/mcp-gateway\" | POST | Streamable HTTP JSON-RPC gateway endpoint |
| \"/api/mcp-gateway/sse\" | GET | SSE endpoint; returns a message URL for this session |
| \"/api/mcp-gateway/message\" | POST | SSE companion; send JSON-RPC through the session |
| `/api/mcp-gateway/instances` | GET / POST | List and create upstream instances |
| `/api/mcp-gateway/instances/:id` | GET / PUT / DELETE | Read, update, and remove one upstream instance |
| \"/api/mcp-gateway/instances/:id/test\" | POST | Probe an instance by listing its tools |
| \"/api/mcp-gateway/keys\" | GET / POST | Create and list gateway keys |
| \"/api/mcp-gateway/oauth/:id/authorize\" | GET | Start the OAuth flow for an instance |
| \"/api/mcp-gateway/oauth/:id/callback\" | GET | OAuth callback |
| \"/api/mcp-gateway/oauth/:id/status\" | GET | Poll the OAuth completion status |

Key creation and key reveal are restricted to local requests via the same local-request check used by the dashboard. Keys are revealed once on creation; after that the dashboard stores only a hash for validation.

## Authentication

Gateway routes use the gateway key, not the DurinDoor dashboard session. Send the key as:

```http
Authorization: Bearer <gateway-key>
```

or:

```http
x-api-key: <gateway-key>
```

or, for a limited set of Google-style clients:

```http
x-goog-api-key: <gateway-key>
```

or as a query parameter \"key=\". The control endpoint \"/api/mcp/control\" uses dashboard auth, not a gateway key (see below).

## OAuth flow

When an instance is registered with \"oauth: true\", the gateway manages the upstream OAuth 2.0 access token on behalf of callers.

1. The dashboard (or a scripted operator) starts the flow at \"/api/mcp-gateway/oauth/:id/authorize\". The handler discovers the upstream authorization server, performs dynamic client registration if needed, and stores a PKCE pair in the server-side session store.
2. The user authorizes the upstream client.
3. The upstream redirects to \"/api/mcp-gateway/oauth/:id/callback\" with a code and state. The handler validates the state against the session store, exchanges the code for tokens, and persists the bundle on the instance row.
4. The dashboard polls \"oauth/:id/status\" to know when the flow is complete.

After OAuth, the gateway stores the full token bundle on the \"mcpInstances\" row, including \"token_endpoint\", \"client_id\", \"client_secret\", \"resource\", \"scope\", \"expires_at\", and \"fetched_at\" so that refresh can run without a separate configuration lookup. Tokens are scoped to the instance; they are never returned by management APIs.

## Token handling

For OAuth-enabled instances, every upstream request passes through the token lifecycle:

- \"ensureFreshToken()\" checks \"expires_at\" with a 60-second leeway and refreshes the access token via the provider's \"token_endpoint\" using the stored \"refresh_token\". Rotated tokens are persisted with \"updateInstance\".
- \"buildHeaders()\" reads the persisted \"access_token\" and injects \"Authorization: Bearer <token>\" into every upstream JSON-RPC request. The z.ai MCP endpoint is the only connection-backed case; the URL is explicitly checked to prevent leaking a provider API key to an arbitrary host.
- If an upstream request returns HTTP 401, the gateway force-refreshes the token once and retries the same request. Non-OAuth instances do not retry 401s.
- Concurrent forced refreshes share one in-flight promise so the same refresh token is not used twice.
- If refresh fails, the instance's \"oauthTokens.needsReauth\" is set to true, and subsequent requests surface an \"McpAuthError\" with status 401 until the user re-authorizes.

## Control endpoint

\"POST /api/mcp/control\" exposes a lightweight JSON-RPC 2.0 MCP server for managing the running DurinDoor instance. This endpoint is intended for operator and automation clients, not for end callers of the gateway.

The route uses the same dashboard guard as the rest of \"/api/*\". It is exempt from the \"LOCAL_ONLY_PATHS\" branch used by spawn-capable MCP plugin routes, so it can be called from a remote host with either:

- a valid dashboard JWT (\"auth_token\" cookie), or
- the local CLI token (\"x-9r-cli-token\" header).

Unauthenticated requests receive 401.

Protocol methods:

- \"initialize\" — server capability handshake
- \"notifications/initialized\" — no-content notification (returns 202)
- \"tools/list\" — list available control tools
- \"tools/call\" — invoke a tool by name

Control tools include:

| Tool | Description |
| --- | --- |
| list_providers | List built-in providers and registry metadata |
| list_connections | List provider connections (credential fields sanitized) |
| toggle_connection_active | Enable or disable a single connection by ID |
| toggle_provider_active | Enable or disable every connection for a provider ID |
| usage_stats | Aggregate usage statistics for a period |
| token_saver_stats | Token-saver statistics for a period |
| model_list | Available models in OpenAI-compatible format |

All JSON-RPC responses are returned with HTTP 200, including JSON-RPC errors. Transport or auth errors still use HTTP 401/403.

## Security model

- Gateway keys are only revealed once, on creation. After creation the dashboard only stores a hash.
- Key creation and raw-key reveal are restricted to local requests via the dashboard guard.
- Each key can be granted access to specific MCP instances; the backend also supports per-tool grants.
- Secrets (\"apiKey\", \"accessToken\", \"refreshToken\", \"idToken\", OAuth cookies, and provider-specific \"clientSecret\") are never returned by \"list_connections\" or \"toggle_connection_active\". The control endpoint reuses the shared client allowlist sanitizer and additionally drops \"connectionProxyUrl\", which may contain embedded credentials.
- Custom OpenAI/Anthropic-compatible provider IDs are validated against the provider-node registry before \"toggle_provider_active\" applies.
- Connection toggles mirror the same \"notifyQuotaAutoPingSettingChanged\" side-effects as the dashboard provider routes.
- OAuth token storage is scoped to the instance row. Management APIs return only the \"needsReauth\" flag, not the token content.
- SSRF protection validates token endpoints and refresh redirects through \"assertOutboundUrlAllowed()\" before any network call. Cross-origin redirects strip sensitive headers (Authorization, Cookie, Proxy-Authorization) before the next hop.

## Operations

Create an instance, enable it, test it, then create a gateway key and grant it to the instance. Use the key in an MCP client configured for the streamable HTTP or SSE endpoint.

If a tool call fails, check the response for the upstream error. OAuth instances that need re-authorization return a 401-class JSON-RPC error. Non-OAuth 401s do not retry automatically.

## Troubleshooting

- \"invalid gateway key\" or 401: the key is missing, revoked, or not granted to the instance owning the requested tool. Check the key grants in the dashboard.
- \"unknown tool\": the tool name does not match \"<instanceSlug>__<toolName>\" or the instance is disabled. Verify the slug and grant list.
- \"upstream requires re-login\": the OAuth refresh failed. Re-run the OAuth flow for the instance.
- 401 from an upstream after OAuth: check the OAuth status and that the instance has a valid \"access_token\" and non-expired \"expires_at\".
- SSRF / `URL not allowed` errors: the upstream or token endpoint resolves to a private, local, or cloud-metadata host. Review the outbound URL guard and proxy settings if a trusted internal host is intended.