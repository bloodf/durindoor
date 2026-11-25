import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

const MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

describe("9router#5730 Cloudflare Mistral Small 3.1 image input", () => {
  it.each(["cloudflare-ai", "cf"])("marks the model vision-capable for %s", (provider) => {
    expect(getCapabilitiesForModel(provider, MODEL)).toMatchObject({ vision: true, contextWindow: 128000 });
  });

  it("keeps image parts through parameter cleanup", () => {
    const content = [
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
    ];
    const body = { messages: [{ role: "user", content: structuredClone(content) }] };
    stripUnsupportedParams("cloudflare-ai", MODEL, body);
    expect(body.messages[0].content).toEqual(content);
  });

  it("does not widen vision to other Mistral models on Workers AI", () => {
    expect(getCapabilitiesForModel("cloudflare-ai", "@cf/mistral/mistral-7b-instruct-v0.2-lora").vision).toBe(false);
  });
});
