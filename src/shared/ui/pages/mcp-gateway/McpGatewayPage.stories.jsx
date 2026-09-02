import React, { useState } from "react";

globalThis.React ??= React;

import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import PromptDialog from "@/shared/ui/components/PromptDialog.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Textarea from "@/shared/ui/components/Textarea.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import McpGatewayPage from "./McpGatewayPage.jsx";
import { instanceKindOptions } from "./mockData.js";

const actions = (
  <>
    <Button variant="secondary" size="sm" icon="vpn_key">
      New key
    </Button>
    <Button variant="primary" size="sm" icon="add">
      New instance
    </Button>
  </>
);

const meta = {
  title: "Durin DS/Pages/MCP Gateway",
  component: McpGatewayPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/mcp-gateway",
      title: "MCP Gateway",
      subtitle:
        "Register upstream MCP servers and expose them through one endpoint. Tools appear as <slug>__<toolName>",
      icon: "hub",
      actions,
    }),
  ],
};

export default meta;

/** Registered Granola MCP instance and the empty gateway-key state. */
export const Default = {};

function NewInstanceModalStory() {
  const [open, setOpen] = useState(true);
  const [kind, setKind] = useState("http");
  const [requiresOAuth, setRequiresOAuth] = useState(true);
  const [enabled, setEnabled] = useState(true);

  return (
    <>
      <McpGatewayPage />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New MCP instance"
        subtitle="Register an upstream server with the shared MCP gateway."
        size="lg"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" icon="add" onClick={() => setOpen(false)}>
              Create instance
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-xs font-medium text-dd-muted">Preset</p>
            <Badge tone="accent" icon="auto_awesome">
              Z.AI MCP
            </Badge>
          </div>
          <Input label="Slug" placeholder="z-ai" autoFocus />
          <Input label="Title" placeholder="Z.AI MCP" />
          <Field label="Kind">
            <Select options={instanceKindOptions} value={kind} onChange={setKind} />
          </Field>
          <Input label="URL" placeholder="https://api.example.com/mcp" />
          <div className="sm:col-span-2">
            <Textarea
              label="Headers (JSON object)"
              defaultValue={'{\n  "Authorization": "Bearer ${TOKEN}"\n}'}
              rows={4}
              className="font-mono"
            />
          </div>
          <div className="sm:col-span-2">
            <Input label="Provider Connection ID" placeholder="connection_01JZ…" />
          </div>
          <div className="rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-3 sm:col-span-2">
            <div className="flex flex-col gap-4">
              <Toggle
                checked={requiresOAuth}
                onChange={setRequiresOAuth}
                label="Requires OAuth"
                description="Prompt for upstream authorization after creation."
              />
              <Toggle
                checked={enabled}
                onChange={setEnabled}
                label="Enabled"
                description="Expose this instance through the gateway immediately."
              />
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** New-instance form with HTTP, SSE, and Stdio transport choices. */
export const WithNewInstanceModal = {
  render: () => <NewInstanceModalStory />,
};

function NewKeyPromptStory() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <McpGatewayPage />
      <PromptDialog
        open={open}
        title="New gateway key"
        label="Gateway key name (optional):"
        placeholder="e.g. ci-runner"
        submitLabel="Mint key"
        onSubmit={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

/** PromptDialog replacement for the former native window.prompt key-name flow. */
export const WithNewKeyPrompt = {
  render: () => <NewKeyPromptStory />,
};
