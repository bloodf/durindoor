import { describe, expect, it } from "vitest";
import { convertOpenAIContentToParts } from "../../open-sse/translator/formats/gemini.js";

describe("Gemini inlineData MIME fields (#3117)", () => {
  it("uses Gemini's mimeType key for image, audio, and file blocks", () => {
    const parts = convertOpenAIContentToParts([
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
      { type: "input_audio", input_audio: { format: "mp3", data: "YXVkaW8=" } },
      { type: "audio_url", audio_url: { url: "data:audio/wav;base64,YXVkaW8=" } },
      { type: "file", file: { data: "ZmlsZQ==", mime_type: "application/pdf" } },
    ]);

    expect(parts.map(({ inlineData }) => inlineData)).toEqual([
      { mimeType: "image/png", data: "aW1hZ2U=" },
      { mimeType: "audio/mpeg", data: "YXVkaW8=" },
      { mimeType: "audio/wav", data: "YXVkaW8=" },
      { mimeType: "application/pdf", data: "ZmlsZQ==" },
    ]);
  });
});
