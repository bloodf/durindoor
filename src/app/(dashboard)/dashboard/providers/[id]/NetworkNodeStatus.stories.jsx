import React from "react";
import { expect, within } from "storybook/test";

import NetworkNodeStatus from "./NetworkNodeStatus";

const connection = { id: "lan-ollama", name: "Lab Ollama", provider: "ollama-local" };
const healthBody = (state, error = null) => ({
  timestamp: "2026-11-19T10:00:00.000Z",
  providers: [{ id: "lan-ollama", provider: "ollama-local", name: "Lab Ollama", state, error }],
});
const routesFor = (models, health) => ({
  "GET /api/providers/lan-ollama/models": models,
  "GET /api/health/providers": { body: health },
  "POST /api/providers/lan-ollama/test": { body: { valid: true } },
  "DELETE /api/providers/lan-ollama": { body: { message: "Connection deleted successfully" } },
});

const meta = {
  title: "Production/providers/NetworkNodeStatus",
  component: NetworkNodeStatus,
  args: { connection },
  parameters: {
    layout: "padded",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers/ollama-local",
      params: { id: "ollama-local" },
      routes: routesFor({ body: { models: [{ id: "llama3" }, { id: "qwen3" }] } }, healthBody("healthy")),
    },
  },
};

export default meta;

/** Healthy node: models listed, last-checked time shown, Test and Remove available. */
export const Healthy = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Health: healthy")).toBeInTheDocument();
    await expect(canvas.getByText("llama3")).toBeInTheDocument();
  },
};

/** Unreachable node: health is red and the model list reports its load error. */
export const Unreachable = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers/ollama-local",
      params: { id: "ollama-local" },
      routes: routesFor({ status: 502, body: { error: "connect ECONNREFUSED" } }, healthBody("down", "connect ECONNREFUSED")),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Health: unreachable")).toBeInTheDocument();
  },
};

/** Node answers with no models. */
export const NoModels = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers/ollama-local",
      params: { id: "ollama-local" },
      routes: routesFor({ body: { models: [] } }, healthBody("healthy")),
    },
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No models found on this node.")).toBeInTheDocument();
  },
};
