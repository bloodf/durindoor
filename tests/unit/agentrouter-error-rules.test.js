import { describe, expect, it } from "vitest";
import {
  getProviderErrorRuleMatch,
  providerRuleRegistry,
  resolveRuleMatchBody,
} from "../../open-sse/config/providerErrorRules.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("AgentRouter provider error rules", () => {
  it("registers provider-specific rules", () => {
    expect(providerRuleRegistry.get("agentrouter")).toHaveLength(2);
  });

  it("classifies quota-shaped 400 and 403 responses as retryable", () => {
    for (const status of [400, 403]) {
      expect(checkFallbackError(status, "用户额度不足", 0, "agentrouter")).toMatchObject({
        shouldFallback: true,
        cooldownMs: 2_000,
        newBackoffLevel: 1,
      });
    }
  });

  it("uses raw AgentRouter error text when structured parsing is unavailable", () => {
    const body = resolveRuleMatchBody("agentrouter", { error: "Forbidden" }, "用户额度不足");
    expect(getProviderErrorRuleMatch("agentrouter", 403, null, body)).toMatchObject({
      reason: "quota_exhausted",
      scope: "connection",
    });
  });

  it("keeps model access denial distinct from quota exhaustion", () => {
    expect(getProviderErrorRuleMatch("agentrouter", 403, null, "无权访问模型 claude-opus")).toEqual({
      reason: "auth_error",
      scope: "model",
      cooldownMs: 6 * 60 * 60 * 1_000,
    });
    expect(checkFallbackError(403, "无权访问模型 claude-opus", 0, "agentrouter")).toEqual({
      shouldFallback: true,
      cooldownMs: 6 * 60 * 60 * 1_000,
    });
  });

  it("does not apply AgentRouter text matching to other providers", () => {
    expect(checkFallbackError(400, "用户额度不足", 0, "openai")).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
    });
  });
});
