import { describe, it, expect } from "vitest";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

const image = { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } };

describe("port9r #5811 cloudflare-ai keeps image parts for vision models", () => {
  it("passes content-part arrays through for a vision-capable Workers AI model", () => {
    const body = {
      model: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
      messages: [{ role: "user", content: [{ type: "text", text: "color?" }, image] }],
    };
    stripUnsupportedParams("cloudflare-ai", body.model, body);
    expect(Array.isArray(body.messages[0].content)).toBe(true);
    expect(body.messages[0].content).toHaveLength(2);
    expect(body.messages[0].content[1]).toEqual(image);
  });

  it("still refuses image parts on a non-vision Workers AI model", () => {
    const body = {
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      messages: [{ role: "user", content: [{ type: "text", text: "x" }, image] }],
    };
    expect(() => stripUnsupportedParams("cloudflare-ai", body.model, body)).toThrow(/does not accept image/i);
  });
});
