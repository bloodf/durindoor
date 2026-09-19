import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { PROVIDER_MODELS, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("OpenCode Free Union Alpha", () => {
  it("registers Union Alpha as a Claude-format model", () => {
    expect(PROVIDER_MODELS.oc).toContainEqual(expect.objectContaining({ id: "union-alpha", name: "Union Alpha Free" }));
    expect(getModelTargetFormat("oc", "union-alpha")).toBe(FORMATS.CLAUDE);
  });

  it("scopes vision and context/output limits to Union Alpha only", () => {
    expect(getCapabilitiesForModel("opencode", "union-alpha")).toMatchObject({
      vision: true,
      contextWindow: 262144,
      maxOutput: 131072,
    });
    // Same-named id on another provider stays at safe defaults — capabilities are per-provider.
    expect(getCapabilitiesForModel("openai", "union-alpha")).toMatchObject({ vision: false, reasoning: false });
  });

  it("routes Union Alpha through the Messages endpoint with the Anthropic version header", () => {
    const executor = new OpenCodeExecutor();
    const url = executor.buildUrl("union-alpha");
    expect(url).toBe("https://opencode.ai/zen/v1/messages");
    expect(executor.buildHeaders({}, true, null, "union-alpha")).toMatchObject({
      "anthropic-version": "2023-06-01",
    });
    expect(executor.buildHeaders({}, true, null, "big-pickle")).not.toHaveProperty("anthropic-version");
  });

  it("leaves every other free model on its existing route", () => {
    const executor = new OpenCodeExecutor();
    expect(executor.buildUrl("big-pickle")).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(executor.buildUrl("muse-spark-1.2")).toBe("https://opencode.ai/zen/v1/responses");
  });

  it("translates an OpenAI request into Claude wire format for Union Alpha", () => {
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "union-alpha",
      { messages: [{ role: "user", content: "ping" }], max_tokens: 1 },
      false,
      {},
      "opencode",
    );
    expect(translated).toMatchObject({
      model: "union-alpha",
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      max_tokens: 1,
    });
  });
});
