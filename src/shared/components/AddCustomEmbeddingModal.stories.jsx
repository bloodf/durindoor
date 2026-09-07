import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import AddCustomEmbeddingModal from "./AddCustomEmbeddingModal.js";

export default {
  title: "Production/shared-config/AddCustomEmbeddingModal",
  component: AddCustomEmbeddingModal,
  parameters: {
    layout: "fullscreen",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/embedding",
      routes: {
        "POST /api/provider-nodes/validate": async (request) => {
          const body = await request.json().catch(() => ({}));
          const valid = Boolean(body && body.apiKey && body.modelId);
          return { body: valid ? { valid: true, dimensions: 1024 } : { valid: false, error: "Key rejected" }, status: 200 };
        },
        "POST /api/provider-nodes": async (request) => {
          const body = await request.json().catch(() => ({}));
          return { body: { node: { id: "new-1", ...body } }, status: 200 };
        },
        "PUT /api/provider-nodes/node-1": async (request) => {
          const body = await request.json().catch(() => ({}));
          return { body: { node: { id: "node-1", ...body } }, status: 200 };
        },
      },
    },
  },
  argTypes: {
    isOpen: { control: "boolean" },
    node: { control: "object" },
  },
};

export const Open = {
  args: {
    isOpen: true,
    onClose: () => {},
    onCreated: (n) => { /* eslint-disable-next-line no-console */ console.log("created", n); },
    onSaved: (n) => { /* eslint-disable-next-line no-console */ console.log("saved", n); },
  },
  render: (args) => <AddCustomEmbeddingModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Add Custom Embedding" });
    await expect(within(dialog).getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("API Key"), "sk-voyage-test");
    await userEvent.type(within(dialog).getByLabelText("Model ID"), "voyage-3");
    await userEvent.click(within(dialog).getByRole("button", { name: "Check" }));
    await expect(within(dialog).findByText("Valid")).resolves.toBeInTheDocument();
  },
};

export const EditingExisting = {
  args: {
    isOpen: true,
    node: { id: "node-1", name: "Voyage AI", prefix: "voyage", baseUrl: "https://api.voyageai.com/v1" },
    onClose: () => {},
    onCreated: (n) => { /* eslint-disable-next-line no-console */ console.log("created", n); },
    onSaved: (n) => { /* eslint-disable-next-line no-console */ console.log("saved", n); },
  },
  render: (args) => <AddCustomEmbeddingModal {...args} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Edit Custom Embedding" });
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Voyage AI"));
  },
};

export const Closed = {
  args: {
    isOpen: false,
    onClose: () => {},
    onCreated: () => {},
    onSaved: () => {},
  },
  render: (args) => <AddCustomEmbeddingModal {...args} />,
};
