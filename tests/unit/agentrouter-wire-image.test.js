import { describe, it, expect } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";

describe("AgentRouter provider registry entry", () => {
  const entry = REGISTRY.find(p => p.id === "agentrouter");

  it("exists in registry with correct transport", () => {
    expect(entry).toBeDefined();
    expect(entry.transport.baseUrl).toBe("https://agentrouter.org/v1/messages");
    expect(entry.transport.format).toBe("claude");
    expect(entry.transport.urlSuffix).toBe("?beta=true");
  });

  it("builds claude-format headers without Authorization Bearer", () => {
    const executor = getExecutor("agentrouter");
    const headers = executor.buildHeaders({ apiKey: "sk-test" }, true);
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("includes a Claude Code User-Agent fallback", () => {
    const executor = getExecutor("agentrouter");
    const headers = executor.buildHeaders({ apiKey: "sk-test" }, true);
    expect(headers["User-Agent"]).toContain("claude-code");
  });

  it("builds URL that targets agentrouter, not anthropic", () => {
    const executor = getExecutor("agentrouter");
    const url = executor.buildUrl("claude-opus-4-6", true);
    expect(url).toBe("https://agentrouter.org/v1/messages?beta=true");
    expect(url).not.toContain("api.anthropic.com");
  });

  it("does not leak agentrouter headers into the native claude provider", () => {
    const claude = getExecutor("claude");
    const claudeHeaders = claude.buildHeaders({ apiKey: "sk-other" }, true);
    const agentHeaders = getExecutor("agentrouter").buildHeaders({ apiKey: "sk-test" }, true);
    expect(claudeHeaders["x-api-key"]).toBe("sk-other");
    expect(agentHeaders["x-api-key"]).toBe("sk-test");
    expect(claudeHeaders["Authorization"]).toBeUndefined();
  });
});
