import { describe, expect, it } from "vitest";
import agentrouter from "../../open-sse/providers/registry/agentrouter.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("AgentRouter provider", () => {
  it("uses the Claude CLI spoof fingerprint with explicit x-api-key auth", () => {
    const executor = new DefaultExecutor("agentrouter");
    const headers = executor.buildHeaders({ apiKey: "sk-agentrouter" }, false);

    expect(headers).toMatchObject({
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": expect.stringContaining("claude-code-20250219"),
      "User-Agent": expect.stringContaining("claude-code/"),
      "X-App": "cli",
      "X-Stainless-Helper-Method": "stream",
      "X-Stainless-Lang": "js",
      "X-Stainless-Runtime": "node",
      "x-api-key": "sk-agentrouter",
    });
    expect(headers["Anthropic-Beta"]).toContain("oauth-2025-04-20");
    expect(headers.Authorization).toBeUndefined();
  });

  it("keeps Claude passthrough and context settings stable", () => {
    expect(agentrouter.passthroughModels).toBe(true);
    expect(PROVIDERS.agentrouter).toMatchObject({
      format: "claude",
      defaultContextLength: 128000,
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    });
  });

  it("exposes a multi-transport mapping for mixed OpenAI/Claude models", () => {
    expect(PROVIDERS.agentrouter.transports).toHaveLength(2);
    const openai = PROVIDERS.agentrouter.transports.find((t) => t.format === "openai");
    const claude = PROVIDERS.agentrouter.transports.find((t) => t.format === "claude");
    expect(openai?.baseUrl).toBe("https://agentrouter.org/v1/chat/completions");
    expect(claude?.baseUrl).toBe("https://agentrouter.org/v1/messages");
    expect(agentrouter.models).toContainEqual(
      expect.objectContaining({ id: "deepseek-v3.2", targetFormat: "openai" })
    );
    expect(agentrouter.models).toContainEqual(
      expect.objectContaining({ id: "claude-opus-4-6", targetFormat: "claude" })
    );
  });
});
