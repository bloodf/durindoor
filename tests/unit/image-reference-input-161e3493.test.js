// Port of upstream 9router 161e3493 (#4981): Gemini image reference inputs and
// Antigravity image error status / quota reset propagation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveImageInput } from "../../open-sse/handlers/imageProviders/_base.js";
import { MAX_IMAGE_BYTES } from "../../open-sse/config/mediaConfig.js";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ execute: mocks.execute })),
}));

const { handleImageGenerationCore } = await import("../../open-sse/handlers/imageGenerationCore.js");

const originalFetch = global.fetch;
const geminiOk = () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ inlineData: { data: "out" } }] } }],
}), { status: 200, headers: { "Content-Type": "application/json" } });

function generate(provider, model, body) {
  return handleImageGenerationCore({
    body: { prompt: "Edit this", ...body },
    modelInfo: { provider, model },
    credentials: { apiKey: "test-key", accessToken: "tok" },
    log: null,
  });
}

describe("Gemini image reference input", () => {
  beforeEach(() => { global.fetch = vi.fn(async () => geminiOk()); });
  afterEach(() => { global.fetch = originalFetch; });

  it("sends a data-URI reference image as inlineData before the prompt", async () => {
    const result = await generate("gemini", "gemini-image-preview", { image: "data:image/jpeg;base64,QUJD" });
    expect(result.success).toBe(true);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.contents[0].parts).toEqual([
      { inlineData: { mimeType: "image/jpeg", data: "QUJD" } },
      { text: "Edit this" },
    ]);
  });

  it("ignores URL references and keeps text-only prompts", async () => {
    await generate("gemini", "gemini-image-preview", { images: ["https://example.com/a.png"] });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).contents[0].parts).toEqual([{ text: "Edit this" }]);
  });
});

describe("resolveImageInput validation", () => {
  it("accepts raw base64 only with the full base64 charset", () => {
    const raw = "A".repeat(120) + "==";
    expect(resolveImageInput(raw)).toEqual({ inlineData: { mimeType: "image/png", data: raw } });
    expect(resolveImageInput("A".repeat(120) + " not base64!")).toBeNull();
    expect(resolveImageInput("A".repeat(120) + "-_")).toBeNull();
  });

  it("rejects payloads over MAX_IMAGE_BYTES decoded", () => {
    const tooBig = "A".repeat(Math.ceil((MAX_IMAGE_BYTES + 3) / 3) * 4);
    expect(resolveImageInput(tooBig)).toBeNull();
    expect(resolveImageInput(`data:image/png;base64,${tooBig}`)).toBeNull();
  });
});

describe("Antigravity image errors", () => {
  beforeEach(() => mocks.execute.mockReset());

  it("keeps upstream 429 and the quota reset time", async () => {
    const reset = new Date(Date.now() + 3_600_000);
    mocks.execute.mockResolvedValue({ response: new Response(JSON.stringify({
      error: { code: 429, message: "quota", details: [{ metadata: { quotaResetTimeStamp: reset.toISOString() } }] },
    }), { status: 429 }) });
    const result = await generate("antigravity", "gemini-3.1-flash-image", {});
    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBe(reset.getTime());
  });

  it("keeps non-JSON upstream status without a reset", async () => {
    mocks.execute.mockResolvedValue({ response: new Response("boom", { status: 503 }) });
    const result = await generate("agy", "gemini-3.1-flash-image", {});
    expect(result.status).toBe(503);
    expect(result.resetsAtMs).toBeUndefined();
  });
});
