import { describe, expect, it } from "vitest";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("NVIDIA text parameter (decolua/9router#5070)", () => {
  it.each(["nvidia/nemotron-3-ultra-550b-a55b", "meta/llama-3.3-70b-instruct"])("drops top-level text for %s", (model) => {
    const messages = [{ role: "user", content: [{ type: "text", text: "Hi" }] }];
    const body = { model, text: { verbosity: "low" }, messages: structuredClone(messages) };

    stripUnsupportedParams("nvidia", model, body);

    expect(body).not.toHaveProperty("text");
    expect(body.messages).toEqual(messages);
  });

  // NVIDIA's own catalog ids start with "nvidia/"; upstream's prefix strip is not ported.
  it("keeps the vendor segment of an NVIDIA model id", () => {
    const body = { model: "nvidia/nemotron-3-ultra-550b-a55b", messages: [] };

    stripUnsupportedParams("nvidia", body.model, body);

    expect(body.model).toBe("nvidia/nemotron-3-ultra-550b-a55b");
  });

  it("leaves text alone for other providers", () => {
    const body = { text: { verbosity: "low" } };

    stripUnsupportedParams("openai", "gpt-6.1-sol", body);

    expect(body.text).toEqual({ verbosity: "low" });
  });
});
