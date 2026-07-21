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
        <h1 className="text-xl font-semibold text-text">MCP Gateway Help</h1>
        <p className="text-sm text-text-muted">
          Connect Model Context Protocol clients to DurinDoor&apos;s embedded
          streamable-HTTP MCP gateway. The gateway aggregates your registered
          MCP server instances behind a single authenticated endpoint.
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

      <Section title="Transport &amp; endpoint">
        <p>
          The gateway accepts JSON-RPC <code className="rounded bg-surface-2 px-1.5 py-0.5">POST</code> requests
          at the streamable-HTTP endpoint below:
        </p>
        <CodeBlock label="Endpoint">POST /api/mcp-gateway/message</CodeBlock>
        <p>
          Responses are streamed as{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5">text/event-stream</code>{" "}
          for server-driven messages.
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
    </div>
  );
}
