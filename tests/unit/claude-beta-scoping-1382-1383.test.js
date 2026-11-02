// #1383: Claude OAuth Messages send oauth-2025-04-20 (2.1.312 capture order).
// #1382: first-party-gated betas never reach third-party Anthropic-compatible gateways.
import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import {
  CLAUDE_FIRST_PARTY_ANTHROPIC_BETA,
  CLAUDE_FIRST_PARTY_ONLY_BETAS,
  buildClaudeOAuthAnthropicBeta,
} from "../../open-sse/providers/shared.js";

// Claude Code 2.1.312 OAuth Messages wire, from the #1372 capture.
const OAUTH_WIRE = "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,thinking-binding-controls-2026-08-01,extended-cache-ttl-2025-04-11,cache-diagnosis-2026-04-07";

const beta = (provider, credentials, model = "") => {
  const headers = new DefaultExecutor(provider).buildHeaders(credentials, true, null, model);
  return headers["Anthropic-Beta"] ?? headers["anthropic-beta"];
};

describe("#1383 Claude OAuth Messages beta", () => {
  it("builds the captured OAuth wire with oauth-2025-04-20 at index 1", () => {
    expect(buildClaudeOAuthAnthropicBeta()).toBe(OAUTH_WIRE);
    expect(OAUTH_WIRE.split(",")[1]).toBe("oauth-2025-04-20");
  });

  it("sends the OAuth wire on claude provider Messages with a Bearer token", () => {
    expect(beta("claude", { accessToken: "sk-ant-oat-test" }, "claude-sonnet-5-5")).toBe(OAUTH_WIRE);
  });

  it("keeps the API-key Messages path on the first-party pin without OAuth extras", () => {
    const apiKey = beta("claude", { apiKey: "sk-ant-api-test" }, "claude-sonnet-5-5");
    expect(apiKey).toBe(CLAUDE_FIRST_PARTY_ANTHROPIC_BETA);
    expect(apiKey).not.toContain("oauth-2025-04-20");
  });
});

describe("#1382 first-party-gated betas", () => {
  const thirdPartyPaths = [
    ["agentrouter", "agentrouter", { apiKey: "k" }],
    ["third-party anthropic-compatible", "anthropic-compatible-x", { apiKey: "k", providerSpecificData: { baseUrl: "https://gateway.example.com/v1" } }],
    ["look-alike host", "anthropic-compatible-x", { apiKey: "k", providerSpecificData: { baseUrl: "https://api.anthropic.com.evil.test/v1" } }],
  ];

  it.each(thirdPartyPaths)("never sends first-party-only betas on %s", (_label, provider, credentials) => {
    const value = beta(provider, credentials, "claude-sonnet-5-5");
    for (const flag of CLAUDE_FIRST_PARTY_ONLY_BETAS) expect(value).not.toContain(flag);
    expect(value).toContain("context-management-2025-06-27");
  });

  it.each([
    ["default base URL", {}],
    ["api.anthropic.com", { baseUrl: "https://api.anthropic.com/v1" }],
  ])("keeps prompt-caching-scope for an anthropic-compatible node on %s", (_label, providerSpecificData) => {
    expect(beta("anthropic-compatible-x", { apiKey: "k", providerSpecificData }, "claude-sonnet-5-5"))
      .toBe("claude-code-20250219,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,fallback-credit-2026-06-01,effort-2025-11-24");
  });
});
