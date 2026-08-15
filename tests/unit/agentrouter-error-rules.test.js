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

  it("classifies structured quota-shaped 400 and 403 responses as connection-scoped", () => {
    const body = { error: { message: "用户额度不足", type: "quota_exhausted" } };
    for (const status of [400, 403]) {
      expect(checkFallbackError(status, "Forbidden", 0, "agentrouter", null, body)).toMatchObject({
        shouldFallback: true,
        cooldownMs: 2_000,
        newBackoffLevel: 1,
        scope: "connection",
      });
    }
  });

  it("does not treat an echoed prompt or unrelated envelope type as quota exhaustion", () => {
    const echoedPrompt = { error: { message: "Forbidden", type: "invalid_request_error" }, prompt: "额度不足" };
    const unrelatedType = { error: { message: "额度不足", type: "invalid_request_error" } };

    expect(checkFallbackError(400, "额度不足", 0, "agentrouter", null, echoedPrompt)).toMatchObject({
      shouldFallback: false,
      cooldownMs: 0,
    });
    expect(checkFallbackError(400, "Forbidden", 0, "agentrouter", null, unrelatedType)).toMatchObject({
      shouldFallback: false,
      cooldownMs: 0,
    });
  });

  it("accepts JSON-string error envelopes but rejects raw error text", () => {
    const body = resolveRuleMatchBody(
      "agentrouter",
      '{"error":{"message":"用户额度不足","type":"quota_exhausted"}}',
      "用户额度不足",
    );
    expect(getProviderErrorRuleMatch("agentrouter", 403, null, body)).toMatchObject({
      reason: "quota_exhausted",
      scope: "connection",
    });
    expect(getProviderErrorRuleMatch("agentrouter", 403, null, "用户额度不足")).toBeNull();
  });

  it("keeps structured model access denial distinct and model-scoped", () => {
    const body = { error: { message: "无权访问模型 claude-opus", type: "auth_error" } };
    expect(getProviderErrorRuleMatch("agentrouter", 403, null, body)).toEqual({
      reason: "auth_error",
      scope: "model",
      cooldownMs: 6 * 60 * 60 * 1_000,
    });
    expect(checkFallbackError(403, "Forbidden", 0, "agentrouter", null, body)).toEqual({
      shouldFallback: true,
      cooldownMs: 6 * 60 * 60 * 1_000,
      newBackoffLevel: 0,
      scope: "model",
    });
  });

  it("does not apply AgentRouter matching to other providers", () => {
    expect(checkFallbackError(400, "用户额度不足", 0, "openai")).toMatchObject({
      shouldFallback: false,
      cooldownMs: 0,
      scope: null,
    });
  });
});
