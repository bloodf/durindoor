import { describe, expect, it } from "vitest";

const { applyStatusRestatement, statusRestatementRegistry } = await import(
  "../../open-sse/config/upstreamStatusRestatement.js"
);

const { parseRateLimitEvidence } = await import("../../open-sse/utils/error.js");

describe("upstream status restatement", () => {
  it("restates AgentRouter quota-shaped 403 responses as retryable 429", () => {
    expect(applyStatusRestatement({
      provider: "agentrouter",
      status: 403,
      message: '{"error":{"message":"用户额度不足","type":"insufficient_user_quota"}}',
      retryAfterMs: null,
    })).toEqual({
      status: 429,
      fromStatus: 403,
      ruleId: "agentrouter-quota-misstatus",
      retryAfterMs: 60_000,
    });
  });

  it("keeps AgentRouter model-access denials as 403", () => {
    expect(applyStatusRestatement({
      provider: "agentrouter",
      status: 403,
      message: "无权访问模型 claude-sonnet-4",
    })).toMatchObject({ status: 403, ruleId: null });
  });

  it("matches quota text in a structured error body", () => {
    expect(applyStatusRestatement({
      provider: "agentrouter",
      status: 403,
      message: "Forbidden",
      body: { error: { message: "用户额度不足，请充值" } },
    })).toMatchObject({ status: 429, ruleId: "agentrouter-quota-misstatus" });
  });

  it("preserves upstream retry timing over its synthetic default", () => {
    expect(applyStatusRestatement({
      provider: "agentrouter",
      status: 403,
      message: "用户额度不足",
      retryAfterMs: 5_000,
    })).toMatchObject({ status: 429, retryAfterMs: 5_000 });
  });

  it("accepts bounded Retry-After evidence after the status becomes 429", () => {
    const now = 1_800_000_000_000;
    const restatement = applyStatusRestatement({
      provider: "agentrouter",
      status: 403,
      message: "用户额度不足",
    });
    const evidence = parseRateLimitEvidence({
      status: restatement.status,
      headers: new Headers({ "retry-after": "120" }),
      bodyText: '{"error":{"message":"用户额度不足"}}',
      now,
    });

    expect(evidence.resetAtMs).toBe(now + 120_000);
  });

  it("handles AgentRouter's 400 variant but leaves unrelated statuses/providers unchanged", () => {
    expect(applyStatusRestatement({
      provider: "agentrouter",
      status: 400,
      message: "额度不足",
    })).toMatchObject({ status: 429 });

    expect(applyStatusRestatement({
      provider: "openai",
      status: 403,
      message: "用户额度不足",
    })).toMatchObject({ status: 403, ruleId: null });

    expect(applyStatusRestatement({
      provider: "agentrouter",
      status: 429,
      message: "用户额度不足",
      retryAfterMs: 1_000,
    })).toEqual({ status: 429, fromStatus: 429, ruleId: null, retryAfterMs: 1_000 });
  });

  it("registers AgentRouter rules for future gateway-specific restatements", () => {
    expect(statusRestatementRegistry.get("agentrouter")).toHaveLength(1);
  });
});
