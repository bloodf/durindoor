import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

const chat = (extra = {}) => ({ messages: [{ role: "user", content: "hi" }], ...extra });

describe("OpenCode Free reasoning rows (upstream 4c58e7f3, #2690)", () => {
  const ids = [
    "space-bunny-free", "space-bunny", "exo-free", "fledge-alpha-free", "longcat-2.0",
    "longcat-2.0-free", "longcat-2.5-preview-free", "north-mini-code-free", "ring-2.6-1t-free",
  ];

  it.each(ids)("marks %s reasoning-capable on both OpenCode lanes", (id) => {
    for (const provider of ["opencode", "opencode-zen"]) {
      expect(getCapabilitiesForModel(provider, id)).toMatchObject({ reasoning: true });
    }
  });

  it("keeps the client's reasoning_effort instead of stripping it", () => {
    expect(applyThinking("openai", "space-bunny-free", chat({ reasoning_effort: "high" }), "opencode-zen").reasoning_effort).toBe("high");
    expect(applyThinking("openai", "ring-2.6-1t-free", chat({ reasoning_effort: "low" }), "opencode").reasoning_effort).toBe("low");
  });

  it("still strips reasoning_effort for an id with no entry at all (control)", () => {
    expect(applyThinking("openai", "no-such-model-xyz", chat({ reasoning_effort: "high" }), "opencode-zen").reasoning_effort).toBeUndefined();
  });

  it("takes limits verbatim from models.dev instead of the *longcat* pattern", () => {
    expect(getCapabilitiesForModel("opencode", "longcat-2.5-preview-free")).toMatchObject({ vision: true, contextWindow: 1000000, maxOutput: 131072 });
  });
});

describe("OpenCode Free deepseek-v4.1-flash-free window (upstream 1da5b0d7)", () => {
  it("caps the opencode lane at 330k with output inside the window", () => {
    const caps = getCapabilitiesForModel("opencode", "deepseek-v4.1-flash-free");
    expect(caps.contextWindow).toBe(330000);
    expect(caps.maxOutput).toBeLessThanOrEqual(caps.contextWindow);
    expect(caps).toMatchObject({ vision: true, reasoning: true });
  });
});

describe("glm-5.3-flash-free thinking format (upstream 32c5f30a)", () => {
  it("sends reasoning_effort, not the zai thinking object, on opencode-zen", () => {
    const out = applyThinking("openai", "glm-5.3-flash-free", chat({ reasoning_effort: "high" }), "opencode-zen");
    expect(out.reasoning_effort).toBe("high");
    expect(out.thinking).toBeUndefined();
  });

  it("leaves the z.ai glm-5.3 family on its native format", () => {
    expect(getCapabilitiesForModel("glm", "glm-5.3").thinkingFormat).toBe("zai");
  });
});

describe("OpenCode Go deepseek response_format (upstream 468aa7d9)", () => {
  const format = { type: "json_schema", json_schema: { name: "x", schema: { type: "object" } } };

  it("drops response_format for opencode-go deepseek models", () => {
    for (const model of ["deepseek-v4.1-flash", "deepseek-v4-pro", "DeepSeek-V4-Flash"]) {
      const out = stripUnsupportedParams("opencode-go", model, chat({ response_format: format }));
      expect(out).not.toHaveProperty("response_format");
    }
    const jsonObject = stripUnsupportedParams("opencode-go", "deepseek-v4.1-flash", chat({ response_format: { type: "json_object" } }));
    expect(jsonObject).not.toHaveProperty("response_format");
  });

  it("keeps response_format for other opencode-go models and other deepseek hosts", () => {
    expect(stripUnsupportedParams("opencode-go", "glm-5.3", chat({ response_format: format })).response_format).toEqual(format);
    expect(stripUnsupportedParams("deepseek", "deepseek-v4-pro", chat({ response_format: format })).response_format).toEqual(format);
  });
});
