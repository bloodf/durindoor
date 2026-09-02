export const gatewayUrl =
  "https://<your-durindoor-host>/api/mcp-gateway/message";

export const authorizationHeader =
  "Authorization: Bearer <gateway-key>";

export const clientConfig = `{
  "mcpServers": {
    "durindoor": {
      "url": "${gatewayUrl}",
      "headers": {
        "Authorization": "Bearer <gateway-key>"
      }
    }
  }
}`;

export const transports = [
  {
    name: "Streamable HTTP",
    endpoint: "POST /api/mcp-gateway/message",
    description:
      "Recommended for most clients. Each request carries one JSON-RPC message; notifications return 202 Accepted.",
  },
  {
    name: "Server-sent events",
    endpoint: "GET /api/mcp-gateway/sse",
    description:
      "Opens a text/event-stream session and returns a per-session message endpoint during the handshake.",
  },
  {
    name: "Stdio bridge",
    endpoint: "allowlisted local plugins",
    description:
      "Bridges approved local plugins to SSE without allowing arbitrary commands to run.",
  },
];
