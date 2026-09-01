import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

describe("port-2853: Codex quota window duration", () => {
  it("preserves finite durations and degrades missing or invalid values to null", async () => {
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        rate_limit: {
          primary_window: { used_percent: 7, limit_window_seconds: "18000" },
          secondary_window: { used_percent: 19, limit_window_seconds: "invalid" },
        },
        code_review_rate_limit: {
          primary_window: { used_percent: 3 },
        },
      }),
    });

    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");

    await expect(getCodexUsage("token")).resolves.toMatchObject({
      quotas: {
        session: { used: 7, windowSeconds: 18000 },
        weekly: { used: 19, windowSeconds: null },
        review_session: { used: 3, windowSeconds: null },
      },
    });
  });

  it("labels a sole seven-day primary window as weekly", async () => {
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        plan_type: "pro",
        rate_limit: {
          primary_window: { used_percent: 1, limit_window_seconds: 604800 },
        },
      }),
    });

    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");
    const usage = await getCodexUsage("token");

    expect(usage.quotas.session).toBeUndefined();
    expect(usage.quotas.weekly).toMatchObject({ used: 1, windowSeconds: 604800 });
  });
});
