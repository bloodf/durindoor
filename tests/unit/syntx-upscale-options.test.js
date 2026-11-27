import { describe, expect, it, vi } from "vitest";
import { createSyntxUpscaleAdapter, parseSyntxUpscaleRequest } from "../../open-sse/services/providerParity/native-image-upscale/syntx.js";

const image = "https://93.184.216.34/source.png";
const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGlj";
const json = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

describe("SYNTX upscale provider options", () => {
  it.each([
    ["ideogram/upscale", { factor: 4, creativity: 0 }, { model_type: "upscale", image_url: [image], scale_factor: 4, creativity: 0, mode: "upscale" }],
    ["magnific/magnific", { factor: 2 }, { model_type: "magnific", image_url: [image], scale_factor: 2 }],
    ["ideogram/upscale", {}, { model_type: "upscale", image_url: [image], mode: "upscale" }],
  ])("preserves the settings wire payload for %s with %j", async (model, options, expected) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ uuid: "chat-1" }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ messages: [{ author_id: -1, message_object: [{ object_type: "image", object_url: "https://cdn.syntx.ai/result.png", completed: true }] }] }));
    const adapter = createSyntxUpscaleAdapter({ fetchImpl, sleep: async () => {} });
    const body = { image, ...options };
    const parsed = parseSyntxUpscaleRequest(model, body);
    expect(parsed.settings).toEqual({ ...expected, image_url: [] });
    const result = await adapter.upscale({ model, body, credentials: { token } });
    expect(result.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ chat_uuid: "chat-1", prompt: "upscale", settings: expected });
  });
});
