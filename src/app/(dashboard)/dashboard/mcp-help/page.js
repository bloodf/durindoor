import { Card, CardContent } from "@/shared/ui/components/Card.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";

const GATEWAY_URL = "https://<your-durindoor-host>/api/mcp-gateway/message";
const CLIENT_CONFIG = `{
  "mcpServers": {
    "durindoor": {
      "url": "${GATEWAY_URL}",
      "headers": { "Authorization": "Bearer <gateway-key>" }
    }
  }
}`;
const CONTROL_TOOLS = [
  ["list_providers", "List built-in AI providers and their registry metadata."],
  ["list_connections", "List all configured provider connections (no credentials)."],
  ["toggle_connection_active", "Enable or disable a single connection by ID."],
  ["toggle_provider_active", "Enable or disable every connection for a provider ID."],
  ["usage_stats", "Aggregate usage statistics for a time period."],
  ["token_saver_stats", "Token-saver statistics for a time period."],
  ["model_list", "List available LLM models in OpenAI-compatible format."],
];

function InlineCode({ children }) {
  return <code className="rounded-dd bg-dd-surface-2 px-1.5 py-0.5 font-mono text-xs text-dd-text">{children}</code>;
}
function CodeBlock({ label, children }) {
  return <div className="flex flex-col gap-1.5"><span className="text-[11px] font-medium uppercase tracking-wide text-dd-subtle">{label}</span><pre tabIndex={0} aria-label={label} className="overflow-x-auto rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-4 font-mono text-xs leading-5 text-dd-text" role="region"><code>{children}</code></pre></div>;
}
function DocCard({ icon, title, subtitle, children }) {
  return <Card padding={false}><div className="flex items-center gap-3 border-b border-dd-border-subtle px-5 py-4"><span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent"><span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">{icon}</span></span><h2 className="min-w-0 flex-1 text-sm font-semibold text-dd-text">{title}</h2>{subtitle ? <span className="text-xs text-dd-subtle">{subtitle}</span> : null}</div><CardContent className="flex flex-col gap-3 text-[13px] leading-5 text-dd-muted">{children}</CardContent></Card>;
}

export default function McpHelpPage() {
  return <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-2"><PageHeader icon="hub" title="MCP Help" subtitle="DurinDoor speaks the Model Context Protocol on two surfaces: gateway (aggregated upstream MCP servers) and control (DurinDoor's own management tools)." className="lg:col-span-2" />
    <DocCard icon="info" title="Overview" subtitle="Embedded streamable-HTTP gateway">
      <p>DurinDoor exposes an embedded MCP gateway that speaks the streamable-HTTP transport. External MCP clients (IDE extensions, agents, the Claude Desktop app, etc.) send JSON-RPC requests over HTTP and receive streamed responses. The gateway authenticates each request with a gateway key, then fans the call out to the MCP server instances you have registered and granted to that key.</p>
      <p>A single key can expose the tools from one or more registered instances, so you can scope access per client without exposing every upstream tool.</p>
    </DocCard>
    <DocCard icon="compare_arrows" title="Transports" subtitle="Streamable-HTTP, SSE, stdio bridge">
      <ul className="list-disc space-y-1.5 pl-5">
        <li><strong className="font-medium text-dd-text">Streamable-HTTP</strong> — one JSON-RPC <InlineCode>POST</InlineCode> per request at <InlineCode>/api/mcp-gateway/message</InlineCode>. Notifications return <InlineCode>202 Accepted</InlineCode>.</li>
        <li><strong className="font-medium text-dd-text">SSE</strong> — open a stream at <InlineCode>GET /api/mcp-gateway/sse</InlineCode>; the handshake returns the per-session message endpoint and responses are pushed over <InlineCode>text/event-stream</InlineCode>.</li>
        <li><strong className="font-medium text-dd-text">Stdio bridge</strong> — allowlisted local plugins are bridged to SSE from a child process; arbitrary commands are never spawned.</li>
      </ul>
      <p>Aggregated tools are namespaced <InlineCode>&lt;instanceSlug&gt;__&lt;toolName&gt;</InlineCode>.</p>
    </DocCard>
    <DocCard icon="vpn_key" title="Authentication" subtitle="Bearer token per request">
      <p>Create a gateway key under <strong className="font-medium text-dd-text">MCP Gateway → Keys</strong>, then send it with every request as a Bearer token.</p>
      <CodeBlock label="Authorization header">Authorization: Bearer &lt;gateway-key&gt;</CodeBlock>
      <ul className="list-disc space-y-1.5 pl-5">
        <li>Dashboard API keys and MCP gateway keys are <strong className="font-medium text-dd-text">separate credentials</strong>. A dashboard API key will not authenticate against the gateway, and a gateway key will not authenticate against the dashboard REST API.</li>
        <li>Requests with a missing or invalid key receive an HTTP <InlineCode>401</InlineCode> with a JSON-RPC error.</li>
      </ul>
    </DocCard>
    <DocCard icon="lock_open" title="Keys & tool grants" subtitle="Per-key scope">
      <p>Each gateway key carries a set of <strong className="font-medium text-dd-text">grants</strong> that select which registered MCP server instances the key may reach. The tools a client sees are exactly the tools exposed by the granted instances — nothing more.</p>
      <ul className="list-disc space-y-1.5 pl-5">
        <li>Create a key under <strong className="font-medium text-dd-text">MCP Gateway → Keys</strong>.</li>
        <li>Open the key&apos;s grant editor and pick the MCP instances it should expose. Removing a grant revokes access immediately.</li>
        <li>Register new upstream MCP servers under <strong className="font-medium text-dd-text">MCP Gateway</strong> first (HTTP, SSE, stdio, npx, python, docker, or command instances).</li>
      </ul>
    </DocCard>
    <DocCard icon="code" title="Client configuration" subtitle="Point any streamable-HTTP client">
      <p>Point any streamable-HTTP MCP client at the gateway. Replace <InlineCode>&lt;your-durindoor-host&gt;</InlineCode> with your DurinDoor base URL and <InlineCode>&lt;gateway-key&gt;</InlineCode> with a key created under MCP Gateway → Keys.</p>
      <CodeBlock label="MCP client config (JSON)">{CLIENT_CONFIG}</CodeBlock>
    </DocCard>
    <DocCard icon="build" title="Control server" subtitle="Manage DurinDoor itself">
      <p>Separate from the gateway, DurinDoor runs a <strong className="font-medium text-dd-text">control</strong> MCP server that exposes management tools. It is a JSON-RPC 2.0 server at <InlineCode>POST /api/mcp/control</InlineCode>, authenticated by your dashboard session or CLI token.</p>
      <ul className="space-y-1.5">{CONTROL_TOOLS.map(([name, desc]) => <li key={name} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2"><code className="shrink-0 rounded-dd bg-dd-surface-2 px-1.5 py-0.5 font-mono text-xs text-dd-text">{name}</code><span className="text-[13px] text-dd-muted">{desc}</span></li>)}</ul>
    </DocCard>
    <DocCard icon="lock" title="Connecting upstream servers over OAuth" subtitle="Authorization-code flow">
      <ul className="list-disc space-y-1.5 pl-5">
        <li><strong className="font-medium text-dd-text">Discovery</strong> — reads the server&apos;s <InlineCode>WWW-Authenticate</InlineCode> challenge and the <InlineCode>.well-known</InlineCode> protected-resource / authorization-server metadata.</li>
        <li><strong className="font-medium text-dd-text">Registration</strong> — Dynamic Client Registration, or a Client ID Metadata Document when the server supports it.</li>
        <li><strong className="font-medium text-dd-text">Login</strong> — click <strong className="font-medium text-dd-text">Connect</strong> on the instance; DurinDoor opens the provider&apos;s consent page with PKCE and a resource indicator, then exchanges the code and stores the tokens.</li>
        <li><strong className="font-medium text-dd-text">Refresh</strong> — tokens are refreshed automatically before expiry and on a 401. If a refresh token is permanently rejected, the instance shows <strong className="font-medium text-dd-text">Needs login</strong> — click Connect again to re-authorize.</li>
      </ul>
      <p>OAuth requires a publicly reachable callback, so it works over a configured tunnel or Tailscale, not a loopback-only host.</p>
    </DocCard>
    <DocCard icon="build_circle" title="Troubleshooting" subtitle="Common gateway errors">
      <ul className="list-disc space-y-1.5 pl-5">
        <li><strong className="font-medium text-dd-text">401 from the gateway</strong> — the gateway key is missing, invalid, or disabled. Confirm you sent a <em>gateway</em> key (not a dashboard API key) as a Bearer token.</li>
        <li><strong className="font-medium text-dd-text">A tool is missing</strong> — its instance is disabled or not granted to your key.</li>
        <li><strong className="font-medium text-dd-text">Instance shows Needs login</strong> — the upstream OAuth token expired and could not refresh.</li>
        <li><strong className="font-medium text-dd-text">Blocked URL</strong> — an upstream URL was rejected by the SSRF guard.</li>
        <li><strong className="font-medium text-dd-text">Stdio spawn failed</strong> — the command is not on the local-plugin allowlist, or the process exited.</li>
      </ul>
    </DocCard>
  </div>;
}
