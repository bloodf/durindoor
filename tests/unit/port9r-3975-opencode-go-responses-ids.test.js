import { describe, expect, it } from "vitest";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";

describe("9router #3975 (0ba2ebc32c8e) - OpenCode Go serves gpt-5.6-luna and grok-4.6 on Responses only", () => {
  const executor = new OpenCodeGoExecutor();

  it.each(["gpt-5.6-luna", "grok-4.6", "grok-4.6(high)"])("routes unlisted id %s to /responses", (model) => {
    for (const alias of ["opencode-go", "ocg"]) {
      expect(getModelTargetFormat(alias, model)).toBe("openai-responses");
    }
    const chatTransport = { runtimeTransport: { format: "openai", baseUrl: "https://opencode.ai/inference/go/openai/v1/chat/completions" } };
    expect(executor.buildUrl(model, true, 0, chatTransport)).toBe("https://opencode.ai/inference/go/openai/v1/responses");
  });

  it("leaves other models and other providers alone", () => {
    expect(getModelTargetFormat("opencode-go", "glm-5.3")).not.toBe("openai-responses");
    expect(getModelTargetFormat("openrouter", "grok-4.6")).toBeNull();
    expect(executor.buildUrl("kimi-k2.6")).toBe("https://opencode.ai/inference/go/openai/v1/chat/completions");
  });
});
