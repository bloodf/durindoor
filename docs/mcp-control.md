# DurinDoor Control MCP

`POST /api/mcp/control` exposes a lightweight JSON-RPC 2.0 MCP server for managing the running DurinDoor instance.

## Authentication

The route uses the same dashboard guard as the rest of `/api/*`. It is exempt from the `LOCAL_ONLY_PATHS` branch used by spawn-capable MCP plugin routes, so it can be called from a remote host with either:

- a valid dashboard JWT (`auth_token` cookie), or
- the local CLI token (`x-9r-cli-token` header).

Unauthenticated requests receive `401 Unauthorized`.

## Protocol

The endpoint implements the MCP 2024-11-05 protocol over HTTP:

```json
POST /api/mcp/control
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

- `initialize` — server capability handshake
- `notifications/initialized` — no-content notification (returns `202`)
- `tools/list` — list available tools
- `tools/call` — invoke a tool by name

All JSON-RPC responses are returned with HTTP 200, including JSON-RPC errors. Transport/auth errors may still use HTTP 401/403.

## Tools

| Tool | Description |
|------|-------------|
| `list_providers` | List all built-in AI providers and registry metadata |
| `list_connections` | List all provider connections (credential fields sanitized) |
| `toggle_connection_active` | Enable/disable a single connection by ID |
| `toggle_provider_active` | Enable/disable every connection for a provider ID |
| `usage_stats` | Aggregate usage statistics for a period (`today`, `24h`, `7d`, … `all`) |
| `token_saver_stats` | Token-saver statistics for a period |
| `model_list` | Available LLM models in OpenAI-compatible format |

### Example: disable all connections for a provider

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "toggle_provider_active",
    "arguments": {
      "providerId": "openai",
      "isActive": false
    }
  }
}
```

Responses are wrapped in MCP `content` objects:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [{ "type": "text", "text": "{ ... }" }]
  }
}
```

## Security notes

- Secrets (`apiKey`, `accessToken`, `refreshToken`, `idToken`, OAuth cookies, provider-specific `clientSecret`) are never returned by `list_connections` or `toggle_connection_active`. The endpoint reuses the shared client allowlist sanitizer and additionally drops `connectionProxyUrl`, which may contain embedded credentials.
- Custom OpenAI/Anthropic-compatible provider IDs are validated against the provider-node registry before `toggle_provider_active` applies.
- Connection toggles mirror the same `notifyQuotaAutoPingSettingChanged` side-effects as the dashboard provider routes.

## Implementation

- `src/app/api/mcp/control/route.js` — Next.js POST handler and JSON-RPC dispatcher
- `src/lib/mcp/control/tools.js` — tool definitions and handlers
- `src/dashboardGuard.js` — route auth exemption from `LOCAL_ONLY_PATHS`
