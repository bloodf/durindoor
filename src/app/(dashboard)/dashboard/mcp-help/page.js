import { Card } from "@/shared/components";

export default function McpHelpPage() {
  return <div className="space-y-6"><div><h1 className="text-xl font-semibold">MCP Gateway Help</h1><p className="text-sm text-text-muted">Connect MCP clients to DurinDoor&apos;s embedded streamable-HTTP gateway.</p></div><Card><div className="space-y-3 text-sm"><p><strong>Transport:</strong> <code>/api/mcp-gateway/message</code></p><p><strong>Keys:</strong> create a gateway key under MCP Gateway → Keys. Tool grants and allowlists attached to that key control exposed tools.</p><p>Send the gateway key as a bearer token. Dashboard API keys and MCP gateway keys are separate credentials.</p></div></Card></div>;
}
