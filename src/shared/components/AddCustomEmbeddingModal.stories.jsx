import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import AddCustomEmbeddingModal from "./AddCustomEmbeddingModal.js";

const fixture = (validate) => ({
  scenario: "default",
  pathname: "/dashboard/media-providers/embedding",
  routes: {
    "POST /api/provider-nodes/validate": validate,
    "POST /api/provider-nodes": async (request) => ({ body: { node: { id: "new-1", ...await request.json() } }, status: 200 }),
    "PUT /api/provider-nodes/node-1": async (request) => ({ body: { node: { id: "node-1", ...await request.json() } }, status: 200 }),
  },
});

const validValidation = async (request) => {
  const body = await request.json().catch(() => ({}));
  return { body: body.apiKey && body.modelId ? { valid: true, dimensions: 1024 } : { valid: false, error: "Key rejected" }, status: 200 };
};

const meta = {
  title: "Production/shared-config/AddCustomEmbeddingModal",
  component: AddCustomEmbeddingModal,
  parameters: { layout: "fullscreen", storyFixture: fixture(validValidation) },
  argTypes: { isOpen: { control: "boolean" }, node: { control: "object" } },
};
export default meta;

const callbacks = { onClose: () => {}, onCreated: () => {}, onSaved: () => {} };

export const Open = {
  args: { isOpen: true, ...callbacks },
  render: (args) => <AddCustomEmbeddingModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Add Custom Embedding" });
    await userEvent.type(within(dialog).getByLabelText("API Key"), "sk-voyage-test");
    await userEvent.type(within(dialog).getByLabelText("Model ID"), "voyage-3");
    await userEvent.click(within(dialog).getByRole("button", { name: "Check" }));
    await expect(within(dialog).findByText("Valid")).resolves.toBeInTheDocument();
  },
};

export const InvalidEndpoint = {
  args: { isOpen: true, ...callbacks },
  render: (args) => <AddCustomEmbeddingModal {...args} />,
  parameters: { storyFixture: fixture({ body: { valid: false, error: "Embedding endpoint rejected this key" }, status: 200 }) },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Add Custom Embedding" });
    await userEvent.type(within(dialog).getByLabelText("API Key"), "sk-invalid");
    await userEvent.type(within(dialog).getByLabelText("Model ID"), "missing-model");
    await userEvent.click(within(dialog).getByRole("button", { name: "Check" }));
    await expect(within(dialog).findByText("Invalid")).resolves.toBeVisible();
    expect(within(dialog).getByText("Embedding endpoint rejected this key")).toBeVisible();
  },
};

export const EditingExisting = {
  args: { isOpen: true, node: { id: "node-1", name: "Voyage AI", prefix: "voyage", baseUrl: "https://api.example.test/v1" }, ...callbacks },
  render: (args) => <AddCustomEmbeddingModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Edit Custom Embedding" });
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Voyage AI"));
  },
};

export const Closed = {
  args: { isOpen: false, ...callbacks },
  render: (args) => <AddCustomEmbeddingModal {...args} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement.ownerDocument.body).queryByRole("dialog", { name: "Add Custom Embedding" })).not.toBeInTheDocument();
  },
};
