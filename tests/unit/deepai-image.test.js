// DeepAI text2img (#1172). Unverified: live responses; shapes follow https://deepai.org/docs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";

const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const originalFetch = global.fetch;
const run = (body = { prompt: "a lake", size: "1024x576" }) => handleImageGenerationCore({
  body,
  modelInfo: { provider: "deepai", model: "text2img" },
  credentials: { apiKey: "da-key" },
  log: null,
});

describe("deepai image provider", () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  it("posts text to /api/text2img with the api-key header and returns output_url", async () => {
    global.fetch.mockResolvedValueOnce(json({ id: "j1", output_url: "https://api.deepai.org/job-view-file/j1/output.jpg" }));
    const result = await run({ prompt: "a lake", size: "1024x576", negative_prompt: "blurry" });
    expect(result.success).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.deepai.org/api/text2img");
    expect(init.headers["api-key"]).toBe("da-key");
    expect(JSON.parse(init.body)).toEqual({ text: "a lake", negative_prompt: "blurry", width: "1024", height: "576" });
    expect((await result.response.json()).data).toEqual([{ url: "https://api.deepai.org/job-view-file/j1/output.jpg" }]);
  });

  it("drops sizes outside the documented range instead of forwarding them", async () => {
    global.fetch.mockResolvedValueOnce(json({ output_url: "https://x/o.jpg" }));
    await run({ prompt: "a lake", size: "1000x2000" });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ text: "a lake" });
  });

  it("maps a 401 (bad key or quota) to a failed result", async () => {
    global.fetch.mockResolvedValueOnce(json({ err: "invalid api key" }, 401));
    const result = await run();
    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
  });

  it("is registered as an image-only provider with no chat transport", () => {
    expect(getImageAdapter("deepai")).toBeTruthy();
    const entry = REGISTRY.find((e) => e.id === "deepai");
    expect(entry.serviceKinds).toEqual(["image"]);
    expect(entry.transport).toBeNull();
  });
});
