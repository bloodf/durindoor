import { describe, expect, it } from "vitest";
import { getExecutor } from "../../open-sse/executors/index.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { parseModel } from "../../open-sse/services/model.js";
import { buildRegistryProviderProbe } from "../../src/app/api/providers/providerProbe.js";
import { parseLlmtrModels } from "../../src/app/api/providers/[id]/models/modelsConfig.js";
import llmtr from "../../open-sse/providers/registry/llmtr.js";

describe("LLMTR API key provider", () => {
  it("routes a namespaced model without losing its vendor prefix", () => {
    expect(parseModel("lt/llmtr/qwen3-8-27b")).toMatchObject({ providerAlias: "lt", model: "llmtr/qwen3-8-27b" });
    expect(llmtr.transport.baseUrl).toBe("https://llmtr.com/v1/chat/completions");
    expect(getExecutor("llmtr")).toBeTruthy();
  });
  it("keeps vendor-qualified chat IDs and filters non-chat models", () => {
    const result = parseLlmtrModels({ data: [
      { id: "llmtr/qwen3-8-27b", supported_operations: ["CHAT_COMPLETIONS"] },
      { id: "llmtr/embed", supported_operations: ["EMBEDDINGS"] },
    ] });
    expect(result.map((row) => row.id)).toEqual(["llmtr/qwen3-8-27b"]);
  });
  it("tests credentials against chat rather than the public catalog", () => {
    const probe = buildRegistryProviderProbe("llmtr", "fixture-key");
    expect(probe.url).toBe(llmtr.transport.baseUrl);
    expect(probe.options.method).toBe("POST");
    expect(JSON.parse(probe.options.body).model).toBe("llmtr/qwen3-8-27b");
  });
  it("uses boolean reasoning for translated and native requests", () => {
    const body = {};
    applyThinking("openai", "llmtr/qwen3-8-27b", body, "llmtr", { mode: "level", level: "high" });
    expect(body.reasoning).toBe(true);
    expect(stripUnsupportedParams("llmtr", "llmtr/qwen3-8-27b", { reasoning: { effort: "none" } }).reasoning).toBe(false);
  });
});
