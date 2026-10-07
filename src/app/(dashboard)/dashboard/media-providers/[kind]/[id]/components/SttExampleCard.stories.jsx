import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { SttExampleCard } from "./SttExampleCard";

const routes = {
  "GET /api/tunnel/status": { body: {}, status: 200 },
  "GET /api/models/custom": { body: { models: [] }, status: 200 },
  "POST /api/v1/audio/transcriptions": { body: { text: "Fixture transcription complete" }, status: 200 },
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

export const UploadAndTranscribe = {
  args: { providerId: "openai" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const response = canvas.getByRole("region", { name: "Response output" });
    await expect(response).toHaveTextContent("Hello world");
    await expect(response).not.toHaveTextContent("Fixture transcription complete");
    const file = new File([new Uint8Array([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 128, 62, 0, 0, 0, 125, 0, 0, 2, 0, 16, 0, 100, 97, 116, 97, 0, 0, 0, 0])], "sample.wav", { type: "audio/wav" });
    await userEvent.upload(await canvas.findByLabelText("Audio file"), file);
    await expect(canvas.getByText(/sample.wav/)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(response).toHaveTextContent("Fixture transcription complete"));
    await expect(response).not.toHaveTextContent("Hello world");
  },
};
