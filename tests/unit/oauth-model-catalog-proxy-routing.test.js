import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
  refreshKiroToken: vi.fn(),
  refreshCopilotToken: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshKiroToken: mocks.refreshKiroToken,
  refreshCopilotToken: mocks.refreshCopilotToken,
}));

import {
  clearKiroModelCache,
  resolveKiroModels,
} from "../../open-sse/services/kiroModels.js";
import {
  clearCopilotModelCache,
  resolveCopilotModels,
} from "../../open-sse/services/copilotModels.js";

const strictRoute = Object.freeze({
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.internal:8080",
  strictProxy: true,
  disableEnvProxy: true,
});

const unauthorized = () => ({
  ok: false,
  status: 401,
  statusText: "Unauthorized",
  text: async () => "unauthorized",
});

describe("OAuth live model catalog proxy routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKiroModelCache();
    clearCopilotModelCache();
  });

  it("keeps Kiro initial fetch, refresh, and retry on the selected route", async () => {
    mocks.proxyAwareFetch
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          models: [{ modelId: "claude-test", modelName: "Claude Test" }],
        }),
      });
    mocks.refreshKiroToken.mockResolvedValue({
      accessToken: "kiro-access-new",
      refreshToken: "kiro-refresh-new",
    });
    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const providerSpecificData = {
      profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/test",
    };

    const result = await resolveKiroModels({
      accessToken: "kiro-access-old",
      refreshToken: "kiro-refresh-old",
      providerSpecificData,
    }, {
      forceRefresh: true,
      log,
      proxyOptions: strictRoute,
    });

    expect(result?.models.some((model) => model.id === "claude-test")).toBe(true);
    expect(mocks.refreshKiroToken).toHaveBeenCalledWith(
      "kiro-refresh-old",
      providerSpecificData,
      log,
      strictRoute
    );
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    for (const call of mocks.proxyAwareFetch.mock.calls) {
      expect(call[2]).toBe(strictRoute);
    }
    expect(mocks.proxyAwareFetch.mock.calls[1][1].headers.Authorization)
      .toBe("Bearer kiro-access-new");
  });

  it("keeps Copilot initial fetch, refresh, and retry on the selected route", async () => {
    mocks.proxyAwareFetch
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{
            id: "gpt-test",
            name: "GPT Test",
            capabilities: { type: "chat" },
            policy: { state: "enabled" },
          }],
        }),
      });
    mocks.refreshCopilotToken.mockResolvedValue({
      token: "copilot-new",
      expiresAt: 12345,
    });
    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    const result = await resolveCopilotModels({
      accessToken: "github-access",
      providerSpecificData: { copilotToken: "copilot-old" },
    }, {
      forceRefresh: true,
      log,
      proxyOptions: strictRoute,
    });

    expect(result?.models).toEqual([
      expect.objectContaining({ id: "gpt-test", name: "GPT Test" }),
    ]);
    expect(mocks.refreshCopilotToken).toHaveBeenCalledWith(
      "github-access",
      log,
      strictRoute
    );
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    for (const call of mocks.proxyAwareFetch.mock.calls) {
      expect(call[2]).toBe(strictRoute);
    }
    expect(mocks.proxyAwareFetch.mock.calls[1][1].headers.Authorization)
      .toBe("Bearer copilot-new");
  });

  it("limits auto to base and thinking variants while expanding gpt-5.6 fully", async () => {
    // decolua/9router#2596 — the shared generator used by the live path must
    // turn one upstream GPT-5.6 row into the 4 synthetic variants carrying
    // 272k context + upstreamModelId back to the base id, while the `auto`
    // row gains only its -thinking variant (never -agentic/-thinking-agentic).
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          {
            modelId: "gpt-5.6-sol",
            modelName: "GPT 5.6 Sol",
            tokenLimits: { maxInputTokens: 272000 },
            rateMultiplier: 2.4,
          },
          { modelId: "auto", modelName: "Auto" },
        ],
      }),
    });
    mocks.refreshKiroToken.mockResolvedValue({
      accessToken: "kiro-access",
      refreshToken: "kiro-refresh",
    });

    const result = await resolveKiroModels({
      accessToken: "kiro-access",
      refreshToken: "kiro-refresh",
      providerSpecificData: {},
    }, {
      forceRefresh: true,
      log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      proxyOptions: strictRoute,
    });

    const ids = result?.models.map((m) => m.id) ?? [];
    expect(ids).toEqual(
      expect.arrayContaining([
        "gpt-5.6-sol",
        "gpt-5.6-sol-thinking",
        "gpt-5.6-sol-agentic",
        "gpt-5.6-sol-thinking-agentic",
        "auto",
        "auto-thinking",
      ])
    );
    expect(ids).not.toContain("auto-agentic");
    expect(ids).not.toContain("auto-thinking-agentic");
    const sol = result.models.find((m) => m.id === "gpt-5.6-sol");
    expect(sol).toMatchObject({ contextLength: 272000, upstreamModelId: "gpt-5.6-sol" });
  });

  it("redacts proxy credentials from catalog warnings", async () => {
    mocks.proxyAwareFetch.mockRejectedValue(
      new Error("connect failed via http://alice:secret@proxy.internal:8080")
    );
    const warn = vi.fn();

    await resolveKiroModels({
      accessToken: "kiro-access",
      providerSpecificData: {},
    }, {
      forceRefresh: true,
      log: { warn },
      proxyOptions: strictRoute,
    });

    const output = JSON.stringify(warn.mock.calls);
    expect(output).not.toContain("alice");
    expect(output).not.toContain("secret");
    expect(output).toContain("[redacted]");
  });
});
