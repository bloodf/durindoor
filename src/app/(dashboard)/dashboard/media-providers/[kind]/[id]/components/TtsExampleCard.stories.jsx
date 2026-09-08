import React from "react";
import { expect, userEvent, within } from "storybook/test";
import { TtsExampleCard } from "./TtsExampleCard";

const voicesByLang = {
  "en-US": { code: "en-US", name: "English (US)", voices: [{ id: "alloy", name: "Alloy" }, { id: "echo", name: "Echo" }] },
  "vi-VN": { code: "vi-VN", name: "Vietnamese", voices: [{ id: "hoai-my", name: "Hoai My" }] },
};

const routes = {
  "GET /api/tunnel/status": { body: {}, status: 200 },
  "GET /api/media-providers/tts/voices": { body: { languages: Object.values(voicesByLang), byLang: voicesByLang }, status: 200 },
  "POST /api/v1/audio/speech": { body: {}, status: 200 },
};

export default {
  title: "Production/media/TtsExampleCard",
  component: TtsExampleCard,
  parameters: {
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/media-providers/tts/edge-tts",
      params: { kind: "tts", id: "edge-tts" },
      routes,
    },
  },
};

export const Default = { args: { providerId: "edge-tts" } };
export const OpenLanguageModal = {
  args: { providerId: "edge-tts" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: /Select language/ });
    await userEvent.click(trigger);
    const body = within(document.body);
    const dialog = await body.findByRole("dialog");
    await expect(within(dialog).getByText("English (US)")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByText("English (US)"));
    await expect(await canvas.findByText("Alloy")).toBeInTheDocument();
  },
};
