const {
  applyStatusRestatement,
  parseRestatedRateLimitEvidence,
  statusRestatementRegistry,
} = await import("../../open-sse/config/upstreamStatusRestatement.js");

describe("upstream status restatement", () => {
  const quotaEnvelope = { error: { message: "用户额度不足", type: "insufficient_user_quota" } };

  it("restates structured AgentRouter quota-shaped 403 responses as retryable 429", () => {
    expect(applyStatusRestatement({ provider: "agentrouter", status: 403, body: quotaEnvelope, retryAfterMs: null })).toEqual({
      status: 429,
      fromStatus: 403,
      ruleId: "agentrouter-quota-misstatus",
      retryAfterMs: 60_000,
    });
  });

  it("keeps prompt echoes, model-access denials, and unrelated envelopes unchanged", () => {
    expect(applyStatusRestatement({
      provider: "agentrouter",
      status: 403,
      message: "额度不足",
      body: { error: { message: "Forbidden", type: "invalid_request_error" }, prompt: "额度不足" },
    })).toMatchObject({ status: 403, ruleId: null });
    expect(applyStatusRestatement({
      provider: "agentrouter",
      status: 403,
      body: { error: { message: "无权访问模型 claude-sonnet-4", type: "auth_error" } },
    })).toMatchObject({ status: 403, ruleId: null });
  });

  it("preserves upstream retry timing over its synthetic default", () => {
    expect(applyStatusRestatement({ provider: "agentrouter", status: 403, body: quotaEnvelope, retryAfterMs: 5_000 }))
      .toMatchObject({ status: 429, retryAfterMs: 5_000 });
  });

  it("accepts bounded Retry-After evidence after the status becomes 429", () => {
    const now = 1_800_000_000_000;
    const restatement = applyStatusRestatement({ provider: "agentrouter", status: 403, body: quotaEnvelope });
    const evidence = parseRestatedRateLimitEvidence({
      status: restatement.status,
      headers: new Headers({ "retry-after": "120" }),
      body: quotaEnvelope,
      now,
    });

    expect(restatement.status).toBe(429);
    expect(evidence.resetAtMs).toBe(now + 120_000);
  });

  it("handles AgentRouter's structured 400 variant but leaves unrelated providers unchanged", () => {
    expect(applyStatusRestatement({ provider: "agentrouter", status: 400, body: quotaEnvelope })).toMatchObject({ status: 429 });
    expect(applyStatusRestatement({ provider: "openai", status: 403, body: quotaEnvelope })).toMatchObject({ status: 403, ruleId: null });
    expect(applyStatusRestatement({ provider: "agentrouter", status: 429, body: quotaEnvelope, retryAfterMs: 1_000 }))
      .toEqual({ status: 429, fromStatus: 429, ruleId: null, retryAfterMs: 1_000 });
  });

  it("registers AgentRouter rules for future gateway-specific restatements", () => {
    expect(statusRestatementRegistry.get("agentrouter")).toHaveLength(1);
  });
});
