import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCodexQuota } from "../../open-sse/services/quota/providers/codex.js";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

const NOW = Date.parse("2026-01-01T00:00:00.000Z");
const sparkRateLimit = {
  limit_reached: true,
  primary_window: { used_percent: 41, reset_at: "2026-01-01T01:00:00.000Z" },
  secondary_window: { used_percent: 63, reset_at: "2026-01-08T00:00:00.000Z" },
};

const shapes = [
  ["spark_rate_limit", { spark_rate_limit: sparkRateLimit }],
  ["gpt_5_3_codex_spark_rate_limit", { gpt_5_3_codex_spark_rate_limit: sparkRateLimit }],
  ["rate_limits_by_limit_id", { rate_limits_by_limit_id: { "gpt-5.3-codex-spark": sparkRateLimit } }],
  ["additional_rate_limits", { additional_rate_limits: [{ limit_name: "codex-spark", rate_limit: sparkRateLimit }] }],
];

describe("GPT-5.3-Codex-Spark quota response shapes", () => {
  beforeEach(() => {
    mocks.proxyAwareFetch.mockReset();
  });

  it.each(shapes)("normalizes %s in the usage parser", async (_name, payload) => {
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");

    await expect(getCodexUsage("token")).resolves.toMatchObject({
      sparkLimitReached: true,
      quotas: {
        spark_session: { used: 41, remaining: 59 },
        spark_weekly: { used: 63, remaining: 37 },
      },
    });
  });

  it.each(shapes)("normalizes %s in quota preflight", (_name, payload) => {
    const rows = normalizeCodexQuota(payload, { now: NOW });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceKey: "model:codex-spark",
        dimensionKey: "requests:session",
        amounts: expect.objectContaining({ remainingRatio: 0.59 }),
      }),
      expect.objectContaining({
        resourceKey: "model:codex-spark",
        dimensionKey: "requests:weekly",
        amounts: expect.objectContaining({ remainingRatio: 0.37 }),
      }),
    ]));
  });
});
