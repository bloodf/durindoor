import React from "react";
import { expect, userEvent, within } from "storybook/test";
import MediaProviderKindPage from "./page.js";

const connections = [
  { id: "openai-1", provider: "openai", testStatus: "success", isActive: true },
];

const baseRoutes = {
  "GET /api/providers": { body: { connections }, status: 200 },
  "GET /api/v1/models/embedding": { body: { data: [] }, status: 200 },
  "GET /api/provider-nodes": { body: { nodes: [] }, status: 200 },
  "GET /api/combos": { body: { combos: [] }, status: 200 },
};


export default {
  title: "Production/media/KindListing",
  component: MediaProviderKindPage,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/embedding",
      params: { kind: "embedding" },
      routes: baseRoutes,
    },
  },
};

export const Default = {};

// Exercises the shared AddCustomEmbeddingModal consumer wiring: clicking
// "Add Custom Embedding" opens the (portal-rendered) modal dialog.
export const OpenAddCustomEmbeddingModal = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: /Add Custom Embedding/ });
    await userEvent.click(trigger);
    const body = within(document.body);
    const dialog = await body.findByRole("dialog");
    await expect(dialog).toBeInTheDocument();
  },
};
