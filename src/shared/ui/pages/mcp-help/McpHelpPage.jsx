import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";

import {
  authorizationHeader,
  clientConfig,
  transports,
} from "./mockData.js";

function InlineCode({ children }) {
  return (
    <code className="rounded bg-dd-surface-2 px-1.5 py-0.5 font-mono text-xs text-dd-text">
      {children}
    </code>
  );
}

function CodeBlock({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-dd-subtle">
        {label}
      </span>
      <pre className="overflow-x-auto rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-4 font-mono text-xs leading-5 text-dd-text">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function DocCard({ icon, title, subtitle, children }) {
  return (
    <Card padding={false}>
      <CardHeader icon={icon} title={title} subtitle={subtitle} />
      <CardContent className="flex flex-col gap-3 text-[13px] leading-5 text-dd-muted">
        {children}
      </CardContent>
    </Card>
  );
}

export default function McpHelpPage() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-2">
      <PageHeader
        className="lg:col-span-2"
        icon="help"
        title="MCP Help"
        subtitle="Model Context Protocol gateway documentation"
      />

      <div className="lg:col-span-2">
        <DocCard
          icon="hub"
          title="Overview"
          subtitle="One authenticated endpoint for all registered MCP servers"
        >
          <p>
            DurinDoor exposes an embedded Model Context Protocol gateway over
            streamable HTTP. IDE extensions, agents, and desktop clients send
            JSON-RPC requests to one endpoint and receive streamed responses.
          </p>
          <p>
            The gateway authenticates every request with a gateway key, then
            routes the call to enabled MCP server instances granted to that key.
            Aggregated tools use the namespace{" "}
            <InlineCode>{"<instanceSlug>__<toolName>"}</InlineCode>; for example,
            a <InlineCode>search</InlineCode> tool on the{" "}
            <InlineCode>brave</InlineCode> instance becomes{" "}
            <InlineCode>brave__search</InlineCode>.
          </p>
        </DocCard>
      </div>

      <DocCard
        icon="swap_horiz"
        title="Transports"
        subtitle="Streamable HTTP is recommended for most clients"
      >
        <ul className="flex flex-col divide-y divide-dd-border-subtle">
          {transports.map((transport) => (
            <li key={transport.name} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <span className="font-medium text-dd-text">{transport.name}</span>
              <InlineCode>{transport.endpoint}</InlineCode>
              <span>{transport.description}</span>
            </li>
          ))}
        </ul>
      </DocCard>

      <DocCard
        icon="key"
        title="Authentication"
        subtitle="Gateway keys are separate from dashboard API keys"
      >
        <p>
          Create a gateway key under{" "}
          <strong className="font-medium text-dd-text">MCP Gateway → Keys</strong>
          , then send it with every request as a Bearer token.
        </p>
        <CodeBlock label="Authorization header">{authorizationHeader}</CodeBlock>
        <p>
          Missing or invalid credentials receive HTTP <InlineCode>401</InlineCode>{" "}
          with a JSON-RPC error. Dashboard API keys do not authenticate MCP
          gateway requests, and gateway keys cannot call dashboard REST APIs.
        </p>
      </DocCard>

      <DocCard
        icon="admin_panel_settings"
        title="Keys & tool grants"
        subtitle="Expose only the instances and tools each client needs"
      >
        <p>
          Each key carries grants selecting which registered MCP instances it
          may reach. A client sees only tools exposed by enabled, granted
          instances; removing a grant revokes access immediately.
        </p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Create a key under MCP Gateway → Keys.</li>
          <li>Select one or more enabled server instances in the grant editor.</li>
          <li>Optionally narrow each instance grant to an explicit tool allowlist.</li>
        </ol>
      </DocCard>

      <DocCard
        icon="code"
        title="Client configuration"
        subtitle="Connect any streamable-HTTP MCP client"
      >
        <p>
          Replace <InlineCode>{"<your-durindoor-host>"}</InlineCode> with your
          DurinDoor base URL and <InlineCode>{"<gateway-key>"}</InlineCode> with
          a key created in MCP Gateway.
        </p>
        <CodeBlock label="MCP client config (JSON)">{clientConfig}</CodeBlock>
      </DocCard>
    </div>
  );
}
