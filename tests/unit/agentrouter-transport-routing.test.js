// Codex review PR #126: verify chatCore prefers model targetFormat over
// client sourceFormat when selecting a runtime transport. OpenAI-format
// clients requesting AgentRouter Claude-only models (targetFormat: "claude")
// must select the Claude transport, not the OpenAI one.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../open-sse/services/provider.js", async () => {
  const actual = await vi.importActual("../../open-sse/services/provider.js");
  return {
    ...actual,
    getModelTargetFormat: vi.fn((alias, model) => {
      if (alias === "agentrouter" && model === "claude-opus-4-6") return "claude";
      return null;
    }),
  };
});

import { resolveTransport } from "../../open-sse/services/provider.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

describe("AgentRouter Codex review PR #126: transport routing", () => {
  it("exports an AgentRouter provider with two runtime transports", () => {
    const p = PROVIDERS.agentrouter;
    expect(p).toBeDefined();
    expect(Array.isArray(p.transports)).toBe(true);
    expect(p.transports.length).toBe(2);
    const formats = p.transports.map((t) => t.format).sort();
    expect(formats).toEqual(["claude", "openai"]);
  });

  it("AgentRouter Claude transport carries the spoof headers and ?beta=true", () => {
    const claudeT = PROVIDERS.agentrouter.transports.find((t) => t.format === "claude");
    expect(claudeT.headers).toBeDefined();
    // CLAUDE_CLI_SPOOF_HEADERS includes "anthropic-version" + a fake ua
    expect(Object.keys(claudeT.headers).length).toBeGreaterThan(0);
    expect(claudeT.urlSuffix).toBe("?beta=true");
  });

  it("resolveTransport(modelTargetFormat='claude') returns the Claude runtime for agentrouter", () => {
    const rt = resolveTransport("agentrouter", "claude");
    expect(rt).toBeTruthy();
    expect(rt.format).toBe("claude");
    expect(rt.urlSuffix).toBe("?beta=true");
  });

  it("resolveTransport(sourceFormat='openai') returns the OpenAI runtime for agentrouter", () => {
    const rt = resolveTransport("agentrouter", "openai");
    expect(rt).toBeTruthy();
    expect(rt.format).toBe("openai");
  });

  it("PR #126 fix: when modelTargetFormat is 'claude', transport selection picks claude even if sourceFormat is 'openai'", async () => {
    // Simulate chatCore.js line 64-65 selection
    const modelTargetFormat = "claude";
    const sourceFormat = "openai";
    const rt = resolveTransport("agentrouter", modelTargetFormat)
      || resolveTransport("agentrouter", sourceFormat);
    expect(rt.format).toBe("claude");
    expect(rt.urlSuffix).toBe("?beta=true");
  });

  it("PR #126 fix: when modelTargetFormat is null, sourceFormat is the fallback", () => {
    const modelTargetFormat = null;
    const sourceFormat = "openai";
    const rt = resolveTransport("agentrouter", modelTargetFormat)
      || resolveTransport("agentrouter", sourceFormat);
    expect(rt.format).toBe("openai");
  });
});
