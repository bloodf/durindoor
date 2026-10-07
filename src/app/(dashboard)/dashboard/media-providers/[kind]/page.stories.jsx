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

export const LocalAndCustomProviders = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/embedding",
      params: { kind: "embedding" },
      routes: {
        ...baseRoutes,
        "GET /api/providers": { body: { connections: [
          { id: "ollama-1", provider: "ollama-local", isActive: false, testStatus: "success", providerSpecificData: { prefix: "local" } },
          { id: "custom-1", provider: "custom-embedding-voyage", isActive: true, testStatus: "error" },
        ] }, status: 200 },
        "PUT /api/providers/ollama-1": { body: { id: "ollama-1", isActive: true }, status: 200 },
        "GET /api/v1/models/embedding": { body: { data: [{ id: "nomic-embed-text", owned_by: "local" }] }, status: 200 },
        "GET /api/provider-nodes": { body: { nodes: [{ id: "custom-embedding-voyage", type: "custom-embedding", name: "Voyage Internal", prefix: "voyage" }] }, status: 200 },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Ollama Local")).toBeVisible();
    await expect(canvas.getByText("Voyage Internal")).toBeVisible();
    await expect(canvas.getByText("Custom")).toBeVisible();
    const toggle = canvas.getByRole("switch", { name: /Enable Ollama Local/ });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  },
};

export const OpenAddCustomSystemOneModal = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/systemone",
      params: { kind: "systemone" },
      routes: baseRoutes,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /Add Custom System One/ }));
    await expect(await within(document.body).findByRole("dialog")).toBeInTheDocument();
  },
};
