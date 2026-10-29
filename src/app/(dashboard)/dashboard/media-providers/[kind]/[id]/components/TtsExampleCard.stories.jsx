import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { TtsExampleCard } from "./TtsExampleCard";

const voicesByLang = {
  "en-US": { code: "en-US", name: "English (US)", voices: [{ id: "alloy", name: "Alloy" }, { id: "echo", name: "Echo" }] },
  "vi-VN": { code: "vi-VN", name: "Vietnamese", voices: [{ id: "hoai-my", name: "Hoai My" }] },
};

function createSilentWav() {
  const sampleRate = 8000;
  const data = new Uint8Array(sampleRate / 10 * 2);
  const wav = new Uint8Array(44 + data.length);
  const view = new DataView(wav.buffer);
  const writeAscii = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + data.length, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, data.length, true);
  return wav;
}

const silentWav = createSilentWav();

const routes = {
  "GET /api/tunnel/status": { body: {}, status: 200 },
  "GET /api/media-providers/tts/voices": { body: { languages: Object.values(voicesByLang), byLang: voicesByLang }, status: 200 },
  "POST /api/v1/audio/speech": { body: silentWav, contentType: "audio/wav", status: 200 },
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

export const GenerateAudio = {
  args: { providerId: "edge-tts" },
  beforeEach: () => {
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    const generatedUrls = new Set();
    URL.createObjectURL = (...args) => {
      const url = createObjectURL(...args);
      generatedUrls.add(url);
      return url;
    };
    return () => {
      for (const url of generatedUrls) revokeObjectURL(url);
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /Select language/ }));
    const dialog = within(document.body);
    await userEvent.click(await dialog.findByText("English (US)"));
    await userEvent.click(await canvas.findByText("Alloy"));
    await userEvent.click(canvas.getByRole("button", { name: "Run" }));
    const audio = await waitFor(() => {
      const element = canvasElement.querySelector("audio");
      expect(element).not.toBeNull();
      return element;
    });
    audio.preload = "auto";
    audio.load();
    await waitFor(() => {
      expect(audio.error).toBeNull();
      expect(audio.readyState).toBeGreaterThanOrEqual(HTMLMediaElement.HAVE_FUTURE_DATA);
      expect(Number.isFinite(audio.duration)).toBe(true);
      expect(audio.duration).toBeGreaterThan(0);
    }, { timeout: 5000 });
  },
};
