import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.js";

describe("DigitalOcean provider", () => {
  it("uses Bearer auth without Anthropic-Beta for native Claude messages", () => {
    const transport = PROVIDERS.digitalocean.transports.find(t => t.format === "claude");
    const executor = new DefaultExecutor("digitalocean");
    const headers = executor.buildHeaders({
      apiKey: "dop_v1_test",
      runtimeTransport: transport,
    }, true);

    expect(headers.Authorization).toBe("Bearer dop_v1_test");
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["Anthropic-Version"]).toBe("2023-06-01");
    expect(headers["Anthropic-Beta"]).toBeUndefined();
  });

  it("routes DigitalOcean GPT 5.x serverless models through Responses", () => {
    expect(getModelTargetFormat("digitalocean", "openai-gpt-5.5")).toBe("openai-responses");
    expect(getModelTargetFormat("digitalocean", "openai-gpt-5.4-pro")).toBe("openai-responses");
    expect(getModelTargetFormat("digitalocean", "openai-gpt-5.4")).toBe("openai-responses");
    expect(getModelTargetFormat("digitalocean", "openai-gpt-5.4-mini")).toBe("openai-responses");
    expect(getModelTargetFormat("digitalocean", "openai-gpt-5.4-nano")).toBe("openai-responses");
  });
});
