import React, { useState } from "react";

globalThis.React ??= React;

import Button from "@/shared/ui/components/Button.jsx";
import PromptDialog from "@/shared/ui/components/PromptDialog.jsx";
import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";
import { InstanceEditModal } from "@/app/(dashboard)/dashboard/mcp-gateway/McpGatewayComponents.jsx";
import { emptyInstance } from "@/app/(dashboard)/dashboard/mcp-gateway/shared.js";

import McpGatewayPage from "./McpGatewayPage.jsx";

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
  return <><McpGatewayPage />{open ? <InstanceEditModal initial={emptyInstance()} onClose={() => setOpen(false)} onSave={async () => setOpen(false)} /> : null}</>;
}

/** Production instance editor and server-preset selection path. */
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
