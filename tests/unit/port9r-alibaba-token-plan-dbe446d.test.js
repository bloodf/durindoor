import { describe, expect, it } from "vitest";
import alibaba from "../../open-sse/providers/registry/alitp-intl.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { canonicalizeUsage, mergeUsage } from "../../open-sse/utils/usageTracking.js";

describe("Alibaba Token Plan native transport and accounting", () => {
  it("routes Claude requests to its native endpoint with bearer authentication", () => {
    expect(alibaba.transports.find((transport) => transport.format === "claude")).toMatchObject({
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic/v1/messages",
      auth: { header: "Authorization", scheme: "bearer" },
    });
    expect(alibaba.models.some((model) => model.id === "qwen4-max")).toBe(true);
  });
  it("routes QwenCloud Responses and Claude requests to their native endpoints", () => {
    expect(resolveTransport("qwencloud", "openai-responses").baseUrl).toBe("https://token-plan.maas.qwencloudapi.com/compatible-mode/v1/responses");
    expect(resolveTransport("qwencloud", "claude").auth).toMatchObject({ header: "x-api-key", scheme: "raw" });
  });
  it("uses the uncached input from the delta when cache counts first arrive", () => {
    const usage = mergeUsage({ prompt_tokens: 1000, completion_tokens: 0 }, {
      prompt_tokens: 200, completion_tokens: 5, cache_read_input_tokens: 800,
    });
    expect(canonicalizeUsage(usage)).toMatchObject({ prompt_tokens: 1000, cached_tokens: 800, completion_tokens: 5 });
  });
});
