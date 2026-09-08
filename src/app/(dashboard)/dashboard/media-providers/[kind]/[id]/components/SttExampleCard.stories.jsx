import React from "react";
import { expect, userEvent, within } from "storybook/test";
import { SttExampleCard } from "./SttExampleCard";

const routes = {
  "GET /api/tunnel/status": { body: {}, status: 200 },
  "GET /api/models/custom": { body: { models: [] }, status: 200 },
  "POST /api/v1/audio/transcriptions": { body: { text: "Hello world" }, status: 200 },
};

export default {
  title: "Production/media/SttExampleCard",
  component: SttExampleCard,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/stt/openai",
      params: { kind: "stt", id: "openai" },
      routes,
    },
  },
};

export const Default = { args: { providerId: "openai" } };
export const CurlCopies = {
  args: { providerId: "openai" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const copy = await canvas.findByRole("button", { name: /Copy/ });
    await expect(copy).toBeInTheDocument();
    await userEvent.click(copy);
  },
};
