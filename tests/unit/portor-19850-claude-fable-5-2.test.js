import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { openAIToBedrockConverse } from "../../open-sse/executors/bedrock.js";

const BEDROCK_ID = "anthropic.claude-fable-5-2";
const SURFACES = [["anthropic", "claude-fable-5-2"], ["cc", "claude-fable-5-2"], ["bedrock", BEDROCK_ID]];
const tools = [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }];
const chat = (extra) => ({ messages: [{ role: "user", content: "hi" }], ...extra });

describe("OmniRoute #19850 — Claude Fable 5.2 on the local Claude surfaces", () => {
  it.each(SURFACES)("%s lists %s with always-on adaptive thinking and a 1M window", (provider, model) => {
    expect(PROVIDER_MODELS[provider].map((row) => row.id)).toContain(model);
    expect(getCapabilitiesForModel(provider, model)).toMatchObject({
      thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000,
    });
  });

  it("prices the Anthropic API row at the published rates", () => {
    expect(getPricingForModel("anthropic", "claude-fable-5-2")).toMatchObject({ input: 8, output: 40, cached: 0.2, cache_creation: 10 });
  });

  it.each(SURFACES)("%s turns disabled and budget thinking into adaptive thinking", (provider, model) => {
    const target = provider === "bedrock" ? "openai" : "claude";
    for (const thinking of [{ type: "disabled" }, { type: "enabled", budget_tokens: 5000 }]) {
      const out = translateRequest("openai", target, model, chat({ model, thinking }), false, {}, provider);
      expect(out.thinking.type).toBe("adaptive");
      expect(out.thinking.budget_tokens).toBeUndefined();
    }
  });

  it.each(["anthropic", "claude"])("%s drops every sampling control", (provider) => {
    const body = { temperature: 0.2, top_p: 0.9, top_k: 5, max_tokens: 10 };
    stripUnsupportedParams(provider, "claude-fable-5-2", body);
    expect(body).toEqual({ max_tokens: 10 });
  });

  it("leaves top_p on a Claude model that accepts it", () => {
    const body = { top_p: 0.9 };
    stripUnsupportedParams("anthropic", "claude-fable-5-1", body);
    expect(body).toEqual({ top_p: 0.9 });
  });

  it.each([BEDROCK_ID, `global.${BEDROCK_ID}`])("Bedrock Converse omits sampling for %s", (model) => {
    const payload = openAIToBedrockConverse(model, chat({ temperature: 0.2, top_p: 0.9, max_tokens: 10 }));
    expect(payload.inferenceConfig).toEqual({ maxTokens: 10 });
  });

  it.each(["required", { type: "function", function: { name: "read_file" } }])("Bedrock Converse relaxes the forced tool choice %j", (tool_choice) => {
    const payload = openAIToBedrockConverse(BEDROCK_ID, chat({ tools, tool_choice }));
    expect(payload.toolConfig.toolChoice).toEqual({ auto: {} });
    expect(payload.toolConfig.tools).toHaveLength(1);
  });

  it("Bedrock Converse keeps sampling and forced tools for a model that accepts them", () => {
    const payload = openAIToBedrockConverse("anthropic.claude-sonnet-4-6", chat({ temperature: 0.2, top_p: 0.9, tools, tool_choice: "required" }));
    expect(payload.inferenceConfig).toEqual({ temperature: 0.2, topP: 0.9 });
    expect(payload.toolConfig.toolChoice).toEqual({ any: {} });
  });
});
