import React, { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import ApiKeyModelAccessModal from "./ApiKeyModelAccessModal";

const apiKey = { id: "story-key", name: "Build harness", policy: { modelAccess: { mode: "allow", patterns: ["openai/*"] } } };
const catalog = [{ id: "openai/gpt-5", displayId: "openai/gpt-5" }, { id: "cx/gpt-5.6-sol", displayId: "cx/gpt-5.6-sol" }];

const meta = {
  title: "Production/endpoint/ApiKeyModelAccessModal",
  component: ApiKeyModelAccessModal,
  parameters: {
    layout: "padded",
    storyFixture: { scenario: "default", pathname: "/dashboard/endpoint", routes: { "GET /api/settings": { body: { settings: { requireApiKey: false } } } } },
  },
  args: { apiKey, catalog, onClose: () => {}, onSave: () => {} },
};

export default meta;

export const AllowListWithSecurityWarning = {
  play: async ({ canvasElement }) => {
    const dialogElement = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Model access for Build harness" });
    await expect(dialogElement).toBeVisible();
    const dialog = within(dialogElement);
    const warning = await dialog.findByRole("alert");
    await expect(warning).toHaveTextContent(/Rules only apply to requests that send this key/i);
    await expect(warning).toHaveTextContent(/Require API key/i);
    await expect(dialog.getByText("openai/*")).toBeVisible();
  },
};

export const AddAndRejectDuplicateRule = {
  render: (args) => {
    function Wrapper() {
      const [open, setOpen] = useState(true);
      return open ? <ApiKeyModelAccessModal {...args} onClose={() => setOpen(false)} /> : null;
    }
    return <Wrapper />;
  },
  play: async ({ canvasElement }) => {
    const dialogElement = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Model access for Build harness" });
    const dialog = within(dialogElement);
    // A native input with a datalist exposes combobox, not textbox semantics.
    const rule = await dialog.findByRole("combobox", { name: "Add a rule" });
    await waitFor(() => expect(rule).toBeVisible());
    await userEvent.type(rule, "cx/gpt-5.6-sol");
    await userEvent.click(dialog.getByRole("button", { name: "Add" }));
    await expect(dialog.getByText("cx/gpt-5.6-sol")).toBeVisible();
    await userEvent.type(rule, "OPENAI/*");
    await userEvent.click(dialog.getByRole("button", { name: "Add" }));
    await expect(await dialog.findByText("That rule is already in the list.")).toBeVisible();
  },
};

export const EmptyBlockList = {
  args: { apiKey: { ...apiKey, policy: { modelAccess: { mode: "deny", patterns: [] } } } },
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Model access for Build harness" }));
    const emptyState = await dialog.findByText(/empty blocklist blocks nothing/i);
    await expect(emptyState).toBeVisible();
  },
};
