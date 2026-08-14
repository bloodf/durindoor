import { describe, expect, it } from "vitest";
import { detectRequiredCapabilities } from "../../open-sse/services/combo.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("combo capability detection for attachment payloads", () => {
  it("detects Hermes images on the current user turn", () => {
    const required = detectRequiredCapabilities({
      messages: [{ role: "user", content: "describe this", images: ["base64-image"] }],
    });

    expect(required).toEqual(new Set(["vision"]));
  });

  it("detects Vercel experimental image attachments", () => {
    const required = detectRequiredCapabilities({
      messages: [{
        role: "user",
        content: "describe this",
        experimental_attachments: [{ contentType: "image/png", url: "data:image/png;base64,AA==" }],
      }],
    });

    expect(required).toEqual(new Set(["vision"]));
  });

  it("keeps supported attachment modalities while stripping images for non-vision models", () => {
    const body = {
      messages: [{
        role: "user",
        content: "mixed attachments",
        images: ["base64-image"],
        image_url: "data:image/png;base64,AA==",
        experimental_attachments: [
          { contentType: "image/png", url: "data:image/png;base64,AA==" },
          { mediaType: "audio/wav", url: "data:audio/wav;base64,AA==" },
        ],
        attachments: [
          { mediaType: "image/jpeg", url: "https://example.test/photo.jpg" },
          { contentType: "application/pdf", url: "data:application/pdf;base64,AA==" },
        ],
      }],
    };

    stripUnsupportedModalities(body, FORMATS.OPENAI, { vision: false, audioInput: true, pdf: true });

    expect(body.messages[0]).not.toHaveProperty("images");
    expect(body.messages[0]).not.toHaveProperty("image_url");
    expect(body.messages[0].experimental_attachments).toEqual([
      { mediaType: "audio/wav", url: "data:audio/wav;base64,AA==" },
    ]);
    expect(body.messages[0].attachments).toEqual([
      { contentType: "application/pdf", url: "data:application/pdf;base64,AA==" },
    ]);
  });
});
