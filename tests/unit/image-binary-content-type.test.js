/**
 * Upstream 9router #5372: `?response_format=binary` must label raw image bytes
 * with the Content-Type of the actual bytes, not the requested (or default)
 * output format. Cloudflare FLUX and Leonardo answer with JPEG even when the
 * request asked for PNG, and the old code always declared `image/png`, so the
 * client saved a broken file.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/handlers/imageProviders/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getImageAdapter: (provider) => (provider === "fake-exec" ? {
      useExecutor: true,
      executeViaExecutor: async (_model, body) => ({ created: 1, data: [{ b64_json: body.testImage }] }),
      normalize: (value) => ({ created: 1, data: value.data }),
    } : actual.getImageAdapter(provider)),
  };
});

const { handleImageGenerationCore } = await import("../../open-sse/handlers/imageGenerationCore.js");

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const UNKNOWN = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);

async function generate(bytes, outputFormat) {
  return handleImageGenerationCore({
    body: { prompt: "a red apple", testImage: bytes.toString("base64"), ...(outputFormat ? { output_format: outputFormat } : {}) },
    modelInfo: { provider: "fake-exec", model: "m" },
    credentials: {},
    binaryOutput: true,
  });
}

async function expectBinary(result, { mime, filename, bytes }) {
  expect(result.success).toBe(true);
  expect(result.response.headers.get("Content-Type")).toBe(mime);
  expect(result.response.headers.get("Content-Disposition")).toBe(`inline; filename="${filename}"`);
  expect(Buffer.from(await result.response.arrayBuffer()).equals(bytes)).toBe(true);
}

describe("binary image Content-Type (#5372)", () => {
  it("labels JPEG bytes as image/jpeg even when the request asked for png", async () => {
    await expectBinary(await generate(JPEG, "png"), { mime: "image/jpeg", filename: "image.jpg", bytes: JPEG });
  });

  it("keeps image/png for PNG bytes", async () => {
    await expectBinary(await generate(PNG, "png"), { mime: "image/png", filename: "image.png", bytes: PNG });
  });

  it("labels WebP bytes as image/webp", async () => {
    await expectBinary(await generate(WEBP), { mime: "image/webp", filename: "image.webp", bytes: WEBP });
  });

  it("trusts the bytes over a mismatching output format", async () => {
    await expectBinary(await generate(PNG, "jpeg"), { mime: "image/png", filename: "image.png", bytes: PNG });
  });

  it("falls back to the requested output format for unrecognized bytes", async () => {
    await expectBinary(await generate(UNKNOWN, "jpeg"), { mime: "image/jpeg", filename: "image.jpg", bytes: UNKNOWN });
  });

  it("falls back to image/png for unrecognized bytes with no output format", async () => {
    await expectBinary(await generate(UNKNOWN), { mime: "image/png", filename: "image.png", bytes: UNKNOWN });
  });
});
