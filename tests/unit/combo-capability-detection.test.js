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

  it("ignores attachment media from completed turns", () => {
    const required = detectRequiredCapabilities({
      messages: [
        { role: "user", content: "old", images: ["base64-image"] },
        { role: "assistant", content: "previous response" },
        { role: "user", content: "current" },
      ],
    });

    expect(required).toEqual(new Set());
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

  it("detects audio and PDF attachments without requiring vision", () => {
    const required = detectRequiredCapabilities({
      messages: [{
        role: "user",
        content: "transcribe and summarize",
        attachments: [
          { contentType: "audio/wav", url: "data:audio/wav;base64,AA==" },
          { mediaType: "application/pdf", url: "data:application/pdf;base64,AA==" },
        ],
      }],
    });

    expect(required).toEqual(new Set(["audioInput", "pdf"]));
  });

  it("detects video attachments and inline video data URIs", () => {
    const fromAttachment = detectRequiredCapabilities({
      messages: [{
        role: "user",
        content: "watch this",
        attachments: [{ contentType: "video/mp4", url: "data:video/mp4;base64,AA==" }],
      }],
    });
    expect(fromAttachment).toEqual(new Set(["videoInput"]));

    const fromInline = detectRequiredCapabilities({
      messages: [{ role: "user", content: "clip: data:video/mp4;base64,AA==" }],
    });
    expect(fromInline).toEqual(new Set(["videoInput"]));
  });

  it("does not require vision for resolvable non-media MIME types", () => {
    const required = detectRequiredCapabilities({
      messages: [{
        role: "user",
        content: "here is data",
        attachments: [
          { contentType: "text/csv", url: "https://example.test/data.csv" },
          { mediaType: "application/json", url: "https://example.test/data.json" },
        ],
      }],
    });

    expect(required).toEqual(new Set());
  });

  it("ignores tool-role messages so their data URIs don't pin routing", () => {
    const required = detectRequiredCapabilities({
      messages: [
        { role: "user", content: "run the tool" },
        { role: "tool", content: "data:image/png;base64,AA==" },
      ],
    });

    expect(required).toEqual(new Set());
  });

  it("detects structured media blocks from role-less and tool messages", () => {
    const required = detectRequiredCapabilities({
      messages: [
        { content: [{ type: "image_url", image_url: "data:image/png;base64,AA==" }] },
        { role: "tool", content: [{ type: "input_file", file_data: "data:application/pdf;base64,AA==" }] },
      ],
    });

    expect(required).toEqual(new Set(["vision", "pdf"]));
  });

  it("appends placeholders for unsupported message-level media beside text", () => {
    const body = {
      messages: [{
        role: "user",
        content: "Describe these files.",
        images: ["base64-image"],
        audio_url: "data:audio/wav;base64,AA==",
        video_url: "data:video/mp4;base64,AA==",
        document: "data:application/pdf;base64,AA==",
      }],
    };

    stripUnsupportedModalities(body, FORMATS.OPENAI, {
      vision: false, audioInput: false, videoInput: false, pdf: false,
    });

    expect(body.messages[0].content).toContain("Describe these files.");
    expect(body.messages[0].content).toContain("[image omitted: model has no vision support]");
    expect(body.messages[0].content).toContain("[audio omitted: model has no audio support]");
    expect(body.messages[0].content).toContain("[video omitted: model has no video support]");
    expect(body.messages[0].content).toContain("[file omitted: model has no document support]");
  });

  it("appends an attachment placeholder beside text when media is removed", () => {
    const body = {
      messages: [{
        role: "user",
        content: "Describe this attachment.",
        attachments: [{ contentType: "image/png", url: "https://example.test/image.png" }],
      }],
    };

    stripUnsupportedModalities(body, FORMATS.OPENAI, { vision: false, audioInput: true, videoInput: true, pdf: true });

    expect(body.messages[0].content).toBe("Describe this attachment. [image omitted: model has no vision support]");
    expect(body.messages[0].attachments).toEqual([]);
  });

  it("preserves attachments with neither MIME nor media payload", () => {
    const body = {
      messages: [{
        role: "user",
        content: "metadata",
        attachments: [{ name: "metadata-only" }],
      }],
    };

    stripUnsupportedModalities(body, FORMATS.OPENAI, { vision: false, audioInput: true, videoInput: true, pdf: true });

    expect(body.messages[0].attachments).toEqual([{ name: "metadata-only" }]);
  });

  it("falls back to attachments when experimental_attachments is malformed", () => {
    const required = detectRequiredCapabilities({
      messages: [{
        role: "user",
        content: "listen to this",
        experimental_attachments: { not: "an array" },
        attachments: [{ contentType: "audio/wav", url: "data:audio/wav;base64,AA==" }],
      }],
    });

    expect(required).toEqual(new Set(["audioInput"]));
  });

  it("detects every modality present in mixed string content", () => {
    const required = detectRequiredCapabilities({
      messages: [{
        role: "user",
        content: "data:image/png;base64,AA== data:audio/wav;base64,BB== data:application/pdf;base64,CC== data:video/mp4;base64,DD==",
      }],
    });

    expect(required).toEqual(new Set(["vision", "audioInput", "pdf", "videoInput"]));
  });

  it("never assigns content when it is not originally a string or array", () => {
    const nullContentBody = {
      messages: [{ role: "user", content: null, images: ["base64-image"] }],
    };
    stripUnsupportedModalities(nullContentBody, FORMATS.OPENAI, { vision: false, audioInput: true, pdf: true });
    expect(nullContentBody.messages[0]).not.toHaveProperty("images");
    expect(nullContentBody.messages[0].content).toBeNull();

    const noContentBody = {
      messages: [{ role: "user", images: ["base64-image"] }],
    };
    stripUnsupportedModalities(noContentBody, FORMATS.OPENAI, { vision: false, audioInput: true, pdf: true });
    expect(noContentBody.messages[0]).not.toHaveProperty("images");
    expect(noContentBody.messages[0]).not.toHaveProperty("content");
  });

  it("bounds the inline data URI MIME match against a hostile long tail", () => {
    // Repeated "data:" prefixes with no comma/semicolon anywhere: each regex
    // attempt must scan the unterminated MIME segment before failing. An
    // unbounded `[^;,:]+` capture rescans the full remaining tail per
    // attempt (O(n^2)); the bounded `{1,255}` capture gives up after 255
    // chars per attempt, staying near-linear.
    const hostileTail = "data:".repeat(20000);
    const body = {
      messages: [{ role: "user", content: `data:image/png;base64,ok\n${hostileTail}` }],
    };

    const start = Date.now();
    stripUnsupportedModalities(body, FORMATS.OPENAI, { vision: false, audioInput: true, pdf: true });
    expect(Date.now() - start).toBeLessThan(500);
    expect(body.messages[0].content).toContain("[image omitted: model has no vision support]");
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

  it("replaces unsupported message fields and inline data URLs", () => {
    const body = {
      messages: [{
        role: "user",
        content: "data:image/png;base64,AA== and data:audio/wav;base64,AA==",
        images: ["base64-image"],
        audio_url: "data:audio/wav;base64,AA==",
        attachments: [
          { contentType: "image/png", url: "data:image/png;base64,AA==" },
          { mediaType: "audio/wav", url: "data:audio/wav;base64,AA==" },
          { mediaType: "application/pdf", url: "data:application/pdf;base64,AA==" },
        ],
      }],
    };

    stripUnsupportedModalities(body, FORMATS.OPENAI, { vision: false, audioInput: false, pdf: true });

    expect(body.messages[0]).not.toHaveProperty("images");
    expect(body.messages[0]).not.toHaveProperty("audio_url");
    expect(body.messages[0].attachments).toEqual([
      { mediaType: "application/pdf", url: "data:application/pdf;base64,AA==" },
    ]);
    expect(body.messages[0].content).toContain("[image omitted: model has no vision support]");
    expect(body.messages[0].content).toContain("[audio omitted: model has no audio support]");
  });
});
