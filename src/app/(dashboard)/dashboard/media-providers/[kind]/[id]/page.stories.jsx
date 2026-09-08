import React from "react";
import { expect, userEvent, within } from "storybook/test";
import MediaProviderDetailPage from "./page.js";

const baseRoutes = {
  "GET /api/tunnel/status": { body: {}, status: 200 },
  "GET /api/providers": { body: { connections: [{ id: "openai-1", provider: "openai", isActive: true, testStatus: "success" }] }, status: 200 },
  "GET /api/providers/client": { body: { connections: [] }, status: 200 },
  "GET /api/models/custom": { body: { models: [] }, status: 200 },
  "POST /api/v1/embeddings": { body: { object: "list", data: [{ object: "embedding", index: 0, embedding: [0.002301, -0.019212, 0.004815, -0.031249, 0.022918] }], model: "openai/text-embedding-3-small", usage: { prompt_tokens: 9, total_tokens: 9 } }, status: 200 },
};

export default {
  title: "Production/media/ProviderDetail",
  component: MediaProviderDetailPage,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/embedding/openai",
      params: { kind: "embedding", id: "openai" },
      routes: baseRoutes,
    },
  },
};

// Page-level coverage:
//   - Header, badges, ProviderLogo: covered here.
//   - ConnectionsCard, ModelsCard, ProviderInfoCard: NOT covered here (owned
//     by the providers / shared lane; see producer's stories).
//   - EmbeddingExampleCard, SttExampleCard, TtsExampleCard, GenericExampleCard:
//     exercised in their dedicated stories under [kind]/[id]/components/*.
export const EmbeddingExample = {};

export const RunExample = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const run = await canvas.findByRole("button", { name: /Run/ });
    await userEvent.click(run);
    await expect(await canvas.findByText(/⚡ \d+ms/, { selector: "span" }, { timeout: 3000 })).toBeInTheDocument();
  },
};

export const TtsExample = {
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/tts/openai",
      params: { kind: "tts", id: "openai" },
      routes: baseRoutes,
    },
  },
};
