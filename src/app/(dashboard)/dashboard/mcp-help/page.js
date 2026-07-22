/**
 * @file MCP Gateway help page.
 *
 * Static, server-rendered documentation for connecting external MCP clients to
 * DurinDoor's embedded streamable-HTTP MCP gateway. Surfaces the real
 * transport endpoint (`/api/mcp-gateway/message`), the gateway-key auth flow,
 * per-key grants, and a concrete client configuration example.
 */
import { Card } from "@/shared/components";

// Placeholder host; operators replace with their own DurinDoor base URL.
const GATEWAY_URL = "https://<your-durindoor-host>/api/mcp-gateway/message";

// Streamable-HTTP MCP client config (e.g. Claude Desktop / IDE MCP clients).
const CLIENT_CONFIG = `{
  "mcpServers": {
    "durindoor": {
      "url": "${GATEWAY_URL}",
      "headers": {
        "Authorization": "Bearer <gateway-key>"
      }
    }
  }
}`;

// The seven management tools exposed by the control server (/api/mcp/control).
const CONTROL_TOOLS = [
  ["list_providers", "List built-in AI providers and their registry metadata."],
  ["list_connections", "List all configured provider connections (no credentials)."],
  ["toggle_connection_active", "Enable or disable a single connection by ID."],
  ["toggle_provider_active", "Enable or disable every connection for a provider ID."],
  ["usage_stats", "Aggregate usage statistics for a time period."],
  ["token_saver_stats", "Token-saver statistics for a time period."],
  ["model_list", "List available LLM models in OpenAI-compatible format."],
];

function Section({ title, children }) {
  return (
    <Card>
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-text">{title}</h2>
        <div className="space-y-3 text-sm text-text-muted">{children}</div>
      </div>
    </Card>
  );
}

function CodeBlock({ children, label }) {
  return (
    <div className="space-y-1.5">
      {label ? (
        <p className="text-xs font-medium uppercase tracking-wide text-text-subtle">
          {label}
        </p>
      ) : null}
      <pre className="overflow-x-auto rounded-lg bg-surface-2 p-4 text-xs leading-relaxed text-text">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export default function McpHelpPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-text">MCP Help</h1>
        <p className="text-sm text-text-muted">
          DurinDoor speaks the Model Context Protocol on two surfaces: the{" "}
          <strong className="font-medium text-text">gateway</strong>, which
          aggregates your registered upstream MCP servers behind one
          authenticated endpoint, and the{" "}
          <strong className="font-medium text-text">control server</strong>,
          which exposes DurinDoor&apos;s own management tools to MCP clients.
        </p>
      </div>

      <Section title="Overview">
        <p>
          DurinDoor exposes an embedded MCP gateway that speaks the
          streamable-HTTP transport. External MCP clients (IDE extensions,
          agents, the Claude Desktop app, etc.) send JSON-RPC requests over HTTP
          and receive streamed responses. The gateway authenticates each request
          with a gateway key, then fans the call out to the MCP server instances
          you have registered and granted to that key.
        </p>
        <p>
          A single key can expose the tools from one or more registered
          instances, so you can scope access per client without exposing every
          upstream tool.
        </p>
      </Section>

      <Section title="Transports">
        <p>
          The gateway supports three transports. Most clients use
          streamable-HTTP.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="font-medium text-text">Streamable-HTTP</strong> —
            one JSON-RPC{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">POST</code> per
            request at{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">/api/mcp-gateway/message</code>.
            Notifications return{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">202 Accepted</code>.
          </li>
          <li>
            <strong className="font-medium text-text">SSE</strong> — open a
            stream at{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">GET /api/mcp-gateway/sse</code>;
            the handshake returns the per-session message endpoint and responses
            are pushed over{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">text/event-stream</code>.
          </li>
          <li>
            <strong className="font-medium text-text">Stdio bridge</strong> —
            allowlisted local plugins are bridged to SSE from a child process;
            arbitrary commands are never spawned.
          </li>
        </ul>
        <p>
          Aggregated tools are namespaced{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5">&lt;instanceSlug&gt;__&lt;toolName&gt;</code>,
          so a <code className="rounded bg-surface-2 px-1.5 py-0.5">search</code>{" "}
          tool on an instance with slug{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5">brave</code> is
          called as{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5">brave__search</code>.
        </p>
      </Section>

      <Section title="Authentication">
        <p>
          Create a gateway key under{" "}
          <strong className="font-medium text-text">MCP Gateway → Keys</strong>,
          then send it with every request as a Bearer token:
        </p>
        <CodeBlock label="Authorization header">
          Authorization: Bearer &lt;gateway-key&gt;
        </CodeBlock>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Dashboard API keys and MCP gateway keys are{" "}
            <strong className="font-medium text-text">separate credentials</strong>.
            A dashboard API key will not authenticate against the gateway, and a
            gateway key will not authenticate against the dashboard REST API.
          </li>
          <li>
            Requests with a missing or invalid key receive an HTTP{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">401</code> with
            a JSON-RPC error.
          </li>
        </ul>
      </Section>

      <Section title="Keys &amp; tool grants">
        <p>
          Each gateway key carries a set of{" "}
          <strong className="font-medium text-text">grants</strong> that select
          which registered MCP server instances the key may reach. The tools a
          client sees are exactly the tools exposed by the granted instances —
          nothing more.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Create a key under{" "}
            <strong className="font-medium text-text">MCP Gateway → Keys</strong>.
          </li>
          <li>
            Open the key&apos;s grant editor and pick the MCP instances it should
            expose. Removing a grant revokes access immediately.
          </li>
          <li>
            Register new upstream MCP servers under{" "}
            <strong className="font-medium text-text">MCP Gateway</strong> first
            (HTTP, SSE, stdio, npx, python, docker, or command instances) — only
            enabled, granted instances are reachable through a key.
          </li>
        </ul>
      </Section>

      <Section title="Client configuration">
        <p>
          Point any streamable-HTTP MCP client at the gateway. Replace{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5">&lt;your-durindoor-host&gt;</code>{" "}
          with your DurinDoor base URL and{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5">&lt;gateway-key&gt;</code>{" "}
          with a key created under MCP Gateway → Keys.
        </p>
        <CodeBlock label="MCP client config (JSON)">{CLIENT_CONFIG}</CodeBlock>
      </Section>

      <Section title="Control server (manage DurinDoor)">
        <p>
          Separate from the gateway, DurinDoor runs a{" "}
          <strong className="font-medium text-text">control</strong> MCP server
          that exposes management tools for DurinDoor itself. It is a JSON-RPC
          2.0 server at{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5">POST /api/mcp-gateway/message</code>
          &apos;s sibling,{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5">POST /api/mcp/control</code>,
          and is authenticated by your dashboard session or CLI token — not by a
          gateway key.
        </p>
        <p className="text-text-muted">Available tools:</p>
        <ul className="space-y-1.5">
          {CONTROL_TOOLS.map(([name, desc]) => (
            <li key={name} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
              <code className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs">{name}</code>
              <span className="text-sm text-text-muted">{desc}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Connecting upstream servers over OAuth">
        <p>
          When you register an upstream MCP server that requires OAuth, DurinDoor
          runs the full authorization-code flow for you:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="font-medium text-text">Discovery</strong> — reads
            the server&apos;s{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">WWW-Authenticate</code>{" "}
            challenge and the{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">.well-known</code>{" "}
            protected-resource / authorization-server metadata.
          </li>
          <li>
            <strong className="font-medium text-text">Registration</strong> —
            Dynamic Client Registration, or a Client ID Metadata Document when
            the server supports it.
          </li>
          <li>
            <strong className="font-medium text-text">Login</strong> — click{" "}
            <strong className="font-medium text-text">Connect</strong> on the
            instance; DurinDoor opens the provider&apos;s consent page with PKCE
            and a resource indicator, then exchanges the code and stores the
            tokens.
          </li>
          <li>
            <strong className="font-medium text-text">Refresh</strong> — tokens
            are refreshed automatically before expiry and on a 401. If a refresh
            token is permanently rejected, the instance shows{" "}
            <strong className="font-medium text-text">Needs login</strong> — click
            Connect again to re-authorize.
          </li>
        </ul>
        <p className="text-text-muted">
          OAuth requires a publicly reachable callback, so it works over a
          configured tunnel or Tailscale, not a loopback-only host.
        </p>
      </Section>

      <Section title="Troubleshooting">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="font-medium text-text">401 from the gateway</strong>{" "}
            — the gateway key is missing, invalid, or disabled. Confirm you sent
            a <em>gateway</em> key (not a dashboard API key) as a Bearer token.
          </li>
          <li>
            <strong className="font-medium text-text">A tool is missing</strong>{" "}
            — its instance is disabled or not granted to your key. Enable the
            instance and add a grant under MCP Gateway → Keys.
          </li>
          <li>
            <strong className="font-medium text-text">Instance shows Needs login</strong>{" "}
            — the upstream OAuth token expired and could not refresh. Click
            Connect to re-authorize.
          </li>
          <li>
            <strong className="font-medium text-text">Blocked URL</strong> — an
            upstream URL was rejected by the SSRF guard (loopback / private
            ranges are blocked for HTTP instances).
          </li>
          <li>
            <strong className="font-medium text-text">Stdio spawn failed</strong>{" "}
            — the command is not on the local-plugin allowlist, or the process
            exited; check the instance command and logs.
          </li>
        </ul>
      </Section>
    </div>
  );
}
