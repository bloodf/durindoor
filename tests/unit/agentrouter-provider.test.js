import { describe, expect, it } from "vitest";
import agentrouter from "../../open-sse/providers/registry/agentrouter.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { mapStainlessArch, mapStainlessOs } from "../../open-sse/providers/shared.js";
describe("AgentRouter provider", () => {
  it("uses the Claude CLI spoof fingerprint with explicit x-api-key auth", () => {
    const executor = new DefaultExecutor("agentrouter");
    const headers = executor.buildHeaders({ apiKey: "sk-agentrouter" }, false);

    expect(headers).toMatchObject({
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,effort-2025-11-24,fallback-credit-2026-06-01",
      "User-Agent": "claude-cli/2.1.258 (external, sdk-cli)",
      "X-App": "cli",
      "X-Stainless-Lang": "js",
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": "v26.3.0",
      "X-Stainless-Package-Version": "0.112.1",
      "X-Stainless-Retry-Count": "0",
      "X-Stainless-Timeout": "600",
      "x-api-key": "sk-agentrouter",
    });
    expect(headers["X-Stainless-Arch"]).toBe(mapStainlessArch());
    expect(headers["X-Stainless-Os"]).toBe(mapStainlessOs());
    expect(headers).not.toHaveProperty("X-Stainless-Helper-Method");
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
