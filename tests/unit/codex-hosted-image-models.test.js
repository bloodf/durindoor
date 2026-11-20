import { describe, expect, it, vi } from "vitest";
import codex from "../../open-sse/handlers/imageProviders/codex.js";
import config from "../../open-sse/providers/registry/codex.js";

describe("Codex hosted image models", () => {
  it.each(["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"])("routes %s through the image tool", (model) => {
    expect(config.models).toContainEqual(expect.objectContaining({ id: model, kind: "image" }));
    expect(codex.buildBody(model, { prompt: "Draw a star", size: "1024x1024" })).toMatchObject({
      model: "gpt-6-sol",
      reasoning: null,
      tools: [{ type: "image_generation", model, size: "1024x1024" }]
    });
  });

  it.each([
    [{ type: "image_generation_call", error: { message: "Image tool failed" } }, "Image tool failed"],
    [{ type: "message", content: [{ type: "output_text", text: "No image" }] }, "returned text instead of an image"],
  ])("reports the reason for a completed response without an image", async (item, message) => {
    const data = { type: "response.completed", response: { status: "completed", output: [item] } };
    const upstream = new Response(`data: ${JSON.stringify(data)}\n\n`);
    await expect(codex.parseResponse(upstream, {})).rejects.toThrow(message);
  });
});

describe("Codex native image routing", () => {
  const model = "gpt-image-2.6-flare";
  it("uses the native generation endpoint for one automatic PNG", async () => {
    const body = { prompt: "A star" };
    const native = codex.buildBody(model, body);
    expect(codex.buildUrl(model, {}, body)).toBe("https://chatgpt.com/backend-api/codex/images/generations");
    expect(native).toMatchObject({ model, prompt: body.prompt, n: 1, size: "auto", output_format: "png" });
    const onReceipt = vi.fn();
    const data = [{ b64_json: "Y2F0" }];
    const raw = { data, usage: { input_tokens: 12 } };
    await expect(codex.parseResponse(Response.json(raw), { requestBody: native, onReceipt })).resolves.toMatchObject({ data });
    expect(onReceipt).toHaveBeenCalledWith(raw, "");
  });

  it("passes references to the edit endpoint and preserves streaming on Responses", () => {
    const body = { prompt: "A star", image: "Y2F0" };
    expect(codex.buildUrl(model, {}, body)).toMatch(/\/images\/edits$/);
    expect(codex.buildBody(model, body).images).toEqual([{ image_url: "data:image/png;base64,Y2F0" }]);
    expect(codex.buildUrl(model, {}, body, { streamToClient: true })).toMatch(/\/codex\/responses$/);
  });

  it("retries only the unsupported hosted model error on the fallback host", () => {
    const original = codex.buildBody(model, { prompt: "A star", size: "1024x1024" });
    expect(codex.buildFallbackBody(original, 400, "model is not supported when using Codex")).toEqual({
      ...original, model: "gpt-5.6-terra"
    });
    expect(codex.buildFallbackBody(original, 400, "Unsupported image size")).toBeNull();
    expect(codex.buildFallbackBody(original, 429, "model is not supported when using Codex")).toBeNull();
  });
});
