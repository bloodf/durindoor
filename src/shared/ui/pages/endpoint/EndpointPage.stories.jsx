import React, { useState } from "react";

// Storybook currently compiles shared shell JSX with the classic runtime.
globalThis.React ??= React;

import Button from "@/shared/ui/components/Button.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import Field from "@/shared/ui/components/Field.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { withDashboardShell } from "@/shared/ui/shell/withDashboardShell.jsx";

import EndpointPage from "./EndpointPage.jsx";
import { apiKeys } from "./mockData.js";

const createKeyAction = (
  <Button variant="primary" size="sm" icon="add">
    Create Key
  </Button>
);

const meta = {
  title: "Durin DS/Pages/Endpoint & Key",
  component: EndpointPage,
  parameters: { layout: "fullscreen" },
  decorators: [
    withDashboardShell({
      activePath: "/dashboard/endpoint",
      title: "Endpoint",
      subtitle: "API endpoint configuration",
      icon: "key",
      actions: createKeyAction,
    }),
  ],
};

export default meta;

/** Endpoint URLs and four representative active API keys. */
export const Default = {
  args: { apiKeys: apiKeys.slice(0, 4) },
};

const expiryOptions = [
  { value: "never", label: "Never expires" },
  { value: "30-days", label: "30 days" },
  { value: "90-days", label: "90 days" },
  { value: "one-year", label: "1 year" },
];

function CreateKeyModalStory() {
  const [open, setOpen] = useState(true);
  const [expiry, setExpiry] = useState("never");

  return (
    <>
      <EndpointPage apiKeys={apiKeys.slice(0, 4)} />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create API key"
        subtitle="Set optional limits before sharing this key."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" icon="key" onClick={() => setOpen(false)}>
              Create Key
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label="Name" placeholder="e.g. Hermes - Cortex" autoFocus />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Daily token limit"
              type="number"
              min="0"
              placeholder="No limit"
              className="dd-tnum font-mono"
            />
            <Input
              label="Daily spend limit"
              type="number"
              min="0"
              step="0.01"
              placeholder="No limit"
              className="dd-tnum font-mono"
            />
          </div>
          <Field label="Expiry">
            <Select options={expiryOptions} value={expiry} onChange={setExpiry} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

/** Create-key form with name, daily limits, and expiry controls. */
export const WithCreateModal = {
  render: () => <CreateKeyModalStory />,
};

function RevokeConfirmStory() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <EndpointPage apiKeys={apiKeys.slice(0, 4)} />
      <ConfirmDialog
        open={open}
        title="Delete this key?"
        message="Cortex will immediately lose access. This action cannot be undone."
        confirmLabel="Delete key"
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

/** Destructive confirmation shown before revoking an API key. */
export const WithRevokeConfirm = {
  render: () => <RevokeConfirmStory />,
};
