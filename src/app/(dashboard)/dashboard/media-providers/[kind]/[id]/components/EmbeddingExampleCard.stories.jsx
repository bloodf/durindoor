import React from "react";
import { expect, userEvent, within } from "storybook/test";
import { EmbeddingExampleCard } from "./EmbeddingExampleCard";

const routes = {
  "GET /api/tunnel/status": { body: {}, status: 200 },
  "POST /api/v1/embeddings": {
    body: { object: "list", data: [{ object: "embedding", index: 0, embedding: [0.002301, -0.019212, 0.004815, -0.031249, 0.022918] }], model: "openai/text-embedding-3-small", usage: { prompt_tokens: 9, total_tokens: 9 } },
    status: 200,
  },
};

export default {
  title: "Production/media/EmbeddingExampleCard",
  component: EmbeddingExampleCard,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/embedding/openai",
      params: { kind: "embedding", id: "openai" },
      routes,
    },
  },
};

export const Default = { args: { providerId: "openai" } };

export const RunShowsLatency = {
  args: { providerId: "openai" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const run = await canvas.findByRole("button", { name: /Run/ });
    await userEvent.click(run);
    await expect(await canvas.findByText(/⚡ \d+ms/, { selector: "span" }, { timeout: 3000 })).toBeInTheDocument();
  },
};

export const WithError = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/embedding/openai",
      params: { kind: "embedding", id: "openai" },
      routes: { "GET /api/tunnel/status": { body: {}, status: 200 }, "POST /api/v1/embeddings": { body: { error: { message: "Invalid API key" } }, status: 401 } },
    },
  },
  args: { providerId: "openai" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const run = await canvas.findByRole("button", { name: /Run/ });
    await userEvent.click(run);
    await expect(await canvas.findByRole("alert")).toHaveTextContent(/Invalid API key/);
  },
};
