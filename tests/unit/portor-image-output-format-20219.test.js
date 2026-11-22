import { afterEach, describe, expect, it, vi } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import openAiAdapterFactory from "../../open-sse/handlers/imageProviders/openai.js";
import falAi from "../../open-sse/handlers/imageProviders/falAi.js";
import stabilityAi from "../../open-sse/handlers/imageProviders/stabilityAi.js";
import { sniffImageFormat } from "../../open-sse/handlers/imageProviders/outputFormat.js";

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const GIF = b64("GIF89a\x01\x00\x01\x00\x00\x00\x00;");
const PNG = b64(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
const SVG = b64('<?xml version="1.0"?><!-- c --><svg xmlns="http://www.w3.org/2000/svg"/>');

afterEach(() => vi.restoreAllMocks());

function mockFetch(payload) {
  const fn = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("sniffImageFormat", () => {
  it("detects GIF, PNG, SVG with prolog, and rejects text", () => {
    expect(sniffImageFormat(GIF)).toBe("gif");
    expect(sniffImageFormat(PNG)).toBe("png");
    expect(sniffImageFormat(SVG)).toBe("svg");
    expect(sniffImageFormat(b64("hello world"))).toBeUndefined();
  });
});

describe("OpenAI-compatible output options (#20219)", () => {
  const adapter = openAiAdapterFactory("openai");
  it("forwards GIF container and frame controls", () => {
    expect(adapter.buildBody("m", { prompt: "p", output_format: "GIF", frame_count: 4, frame_duration_ms: 100 }))
      .toMatchObject({ output_format: "gif", frame_count: 4, frame_duration_ms: 100 });
  });
  it("rejects bad containers, bounds and frames without gif", () => {
    expect(() => adapter.buildBody("m", { prompt: "p", output_format: "bmp" })).toThrow(/output_format/);
    expect(() => adapter.buildBody("m", { prompt: "p", output_format: "gif", frame_count: 99 })).toThrow(/Invalid/);
    expect(() => adapter.buildBody("m", { prompt: "p", output_format: "png", frame_count: 4 })).toThrow(/require output_format=gif/);
    expect(() => adapter.buildBody("m", { prompt: "p", output_format: "gif", partial_images: 2 })).toThrow(/GIF output/);
  });
  it("returns 400 from the core before contacting upstream", async () => {
    const fetchFn = mockFetch({});
    const result = await handleImageGenerationCore({ body: { prompt: "p", output_format: "png", frame_count: 3 }, modelInfo: { provider: "openai", model: "m" }, credentials: { apiKey: "k" } });
    expect(result.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("reports the real container and mime_type from bytes, warning on mismatch", async () => {
    mockFetch({ created: 1, data: [{ b64_json: GIF }] });
    const warn = vi.fn();
    const result = await handleImageGenerationCore({ body: { prompt: "p", output_format: "png" }, modelInfo: { provider: "openai", model: "m" }, credentials: { apiKey: "k" }, log: { warn, debug() {} } });
    const json = await result.response.json();
    expect(json.output_format).toBe("gif");
    expect(json.data[0].mime_type).toBe("image/gif");
    expect(warn).toHaveBeenCalledWith("IMAGE", expect.stringContaining("requested png, received gif"));
  });
  it("leaves URL items unchanged", async () => {
    mockFetch({ created: 1, data: [{ url: "https://x.test/a.png" }] });
    const result = await handleImageGenerationCore({ body: { prompt: "p" }, modelInfo: { provider: "openai", model: "m" }, credentials: { apiKey: "k" } });
    expect(await result.response.json()).toEqual({ created: 1, data: [{ url: "https://x.test/a.png" }] });
  });
});

describe("Fal output options (#20219)", () => {
  it("preserves gif/svg and animation controls", () => {
    expect(falAi.buildBody("fal-ai/x", { prompt: "p", output_format: "GIF", frame_count: 5, frame_duration_ms: 50 }))
      .toMatchObject({ output_format: "gif", frame_count: 5, frame_duration_ms: 50 });
    expect(falAi.buildBody("fal-ai/x", { prompt: "p", output_format: "svg" }).output_format).toBe("svg");
  });
  it("enforces GPT Image 2.6 bounds on qualified openai/ endpoints, keeps the endpoint intact", () => {
    const ep = "openai/gpt-image-2.6/flare/text-to-image";
    expect(falAi.buildUrl(ep)).toContain(ep);
    expect(() => falAi.buildBody(ep, { prompt: "p", output_format: "gif", frame_duration_ms: 5000 })).toThrow(/20-2000/);
    expect(() => falAi.buildBody(ep, { prompt: "p", output_format: "png", frame_count: 3 })).toThrow(/require output_format=gif/);
    expect(() => falAi.buildBody("fal-ai/x", { prompt: "p", output_format: "tiff" })).toThrow(/Invalid fal/);
  });
});

describe("Stability output options (#20219)", () => {
  it("defaults to png and lowercases supported containers", () => {
    expect(stabilityAi.buildBody("core", { prompt: "p" }).output_format).toBe("png");
    expect(stabilityAi.buildBody("core", { prompt: "p", output_format: "WEBP" }).output_format).toBe("webp");
  });
  it("rejects gif/svg and frame controls locally with 400 before dispatch", async () => {
    expect(() => stabilityAi.buildBody("core", { prompt: "p", output_format: "gif" })).toThrow(/png, jpeg, webp/);
    expect(() => stabilityAi.buildBody("core", { prompt: "p", frame_count: 3 })).toThrow(/frame controls/);
    const fetchFn = mockFetch({});
    const result = await handleImageGenerationCore({ body: { prompt: "p", output_format: "svg" }, modelInfo: { provider: "stability-ai", model: "core" }, credentials: { apiKey: "k" } });
    expect(result.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("reports the actual container of the returned bytes", async () => {
    mockFetch({ image: PNG });
    const result = await handleImageGenerationCore({ body: { prompt: "p", output_format: "jpeg" }, modelInfo: { provider: "stability-ai", model: "core" }, credentials: { apiKey: "k" } });
    const json = await result.response.json();
    expect(json.output_format).toBe("png");
    expect(json.data[0].mime_type).toBe("image/png");
  });
});
