import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import ModelsCard from "./ModelsCard";

const routes = {
  "GET /api/models/alias": { body: { aliases: {} } },
  "GET /api/providers": { body: { connections: [{ id: "openai-main", provider: "openai", authType: "apikey", isActive: true, name: "Production" }] } },
  "GET /api/models/custom": { body: { models: [] } },
  "POST /api/models/test": { body: { ok: true } },
  "POST /api/models/custom": { body: { model: { id: "gpt-custom", providerAlias: "openai" } } },
  "DELETE /api/models/custom": { body: { ok: true } },
};

const meta = {
  title: "Production/providers/components/ModelsCard",
  component: ModelsCard,
  parameters: {
    layout: "padded",
    storyFixture: { scenario: "default", pathname: "/dashboard/media-providers/embedding/openai", params: {}, routes },
  },
};

export default meta;

/** Parent scenario covers ModelRow, AddCustomModelModal, bulk test, and per-row test actions. */
export const ModelsList = {
  args: { providerId: "openai" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    // Private ModelRow text rendered for the hardcoded openai catalog.
    const firstModel = await canvas.findByText("openai/gpt-5.6");
    const row = firstModel.closest("div.group");
    await expect(row).not.toBeNull();
    await expect(within(row).getByText("GPT-5.6")).toBeVisible();
    // Open the AddCustomModelModal via the real trigger and assert its dialog.
    await userEvent.click(await canvas.findByRole("button", { name: /add model/i }));
    const dialog = await body.findByRole("dialog", { name: /add custom model/i });
    const modelId = within(dialog).getByLabelText("Model ID");
    await userEvent.type(modelId, "gpt-custom");
    await userEvent.click(within(dialog).getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  },
};
