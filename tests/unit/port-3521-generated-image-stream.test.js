import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { hasValuableContent } from "../../open-sse/utils/streamHelpers.js";

const image = {
  type: "image_url",
  image_url: { url: "data:image/png;base64,BASE64DATA" },
};
const imageChunk = {
  choices: [{ index: 0, delta: { images: [image] }, finish_reason: null }],
};

async function transform(options, frames) {
  const stream = createSSEStream(options);
  const output = new Response(stream.readable).text();
  const writer = stream.writable.getWriter();
  await writer.write(new TextEncoder().encode(frames));
  await writer.close();
  return output;
}

describe("hasValuableContent OpenAI generated images", () => {
  it("keeps a non-empty delta.images", () => {
    expect(hasValuableContent(imageChunk, FORMATS.OPENAI)).toBeTruthy();
  });

  it.each([
    { choices: [{ delta: {} }] },
    { choices: [{ delta: { images: [] } }] },
  ])("drops empty OpenAI deltas %#", (chunk) => {
    expect(hasValuableContent(chunk, FORMATS.OPENAI)).toBeFalsy();
  });
});

describe("OpenAI generated image streams", () => {
  it("retains an image-only OpenAI passthrough frame", async () => {
    const output = await transform(
      {
        mode: "passthrough",
        targetFormat: FORMATS.OPENAI,
        sourceFormat: FORMATS.OPENAI,
      },
      `data: ${JSON.stringify(imageChunk)}\n\ndata: [DONE]\n\n`,
    );

    expect(output).toContain("data:image/png;base64,BASE64DATA");
  });

  it("delivers a translated Gemini image to an OpenAI stream", async () => {
    const output = await transform(
      {
        targetFormat: FORMATS.GEMINI,
        sourceFormat: FORMATS.OPENAI,
        provider: "gemini",
        body: {},
      },
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "BASE64DATA" } }] } }],
        responseId: "response-1",
        modelVersion: "gemini-3-flash-image",
      })}\n\ndata: ${JSON.stringify({ candidates: [{ finishReason: "STOP" }] })}\n\n`,
    );

    const chunks = output
      .split("\n")
      .filter((line) => line.startsWith("data: {") && line.includes("\"choices\""))
      .map((line) => JSON.parse(line.slice(6)));
    expect(chunks.some((chunk) => chunk.choices[0]?.delta?.images?.[0]?.image_url?.url === image.image_url.url)).toBe(true);
  });
});
