import { describe, expect, it } from "vitest";
import agentrouter from "../../open-sse/providers/registry/agentrouter.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("AgentRouter provider", () => {
  it("uses dynamic x-api-key auth without static spoof headers", () => {
    const executor = new DefaultExecutor("agentrouter");
    const headers = executor.buildHeaders({ apiKey: "sk-agentrouter" }, false);

    expect(headers).toMatchObject({
      "x-api-key": "sk-agentrouter",
    });
    expect(headers["Anthropic-Version"]).toBeUndefined();
    expect(headers["User-Agent"]).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
    expect(agentrouter.transport.headers).toBeUndefined();
  });

  it("keeps the source Claude passthrough and context settings stable", () => {
    expect(agentrouter.passthroughModels).toBe(true);
    expect(PROVIDERS.agentrouter).toMatchObject({
      format: "claude",
      defaultContextLength: 128000,
      auth: {
        apiKey: { header: "x-api-key", scheme: "raw" },
        hooks: ["claudeOverlay"],
      },
    });
  });

  it("keeps every advertised model on the source Claude wire endpoint", () => {
    expect(PROVIDERS.agentrouter.transports).toBeUndefined();
    expect(PROVIDERS.agentrouter.baseUrl).toBe("https://agentrouter.org/v1/messages");
    expect(agentrouter.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "deepseek-v3.2" }),
        expect.objectContaining({ id: "claude-opus-4-6" }),
      ]),
    );
    expect(agentrouter.models.every((model) => model.targetFormat === undefined)).toBe(true);
  });
});
