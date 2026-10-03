import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const USAGE = {
  user: { membership: { level: "LEVEL_ADVANCED" } },
  usage: { limit: "100", used: "35", remaining: "65" },
};

describe("Kimi Coding usage", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["kimi-coding", "kimi-coding-apikey"])("uses supported quota handler for %s", async (provider) => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(USAGE));

    const usage = await getUsageForProvider({ provider, apiKey: "kimi-coding-key" });
    expect(usage.quotas.Weekly).toMatchObject({ used: 35, total: 100, remainingPercentage: 65 });

    const [, options] = proxyAwareFetch.mock.calls[0];
    expect(options.headers["x-api-key"]).toBe("kimi-coding-key");
  });

  it("uses OAuth bearer credentials for Kimi Coding quota", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(USAGE));

    await getUsageForProvider({
      provider: "kimi-coding",
      accessToken: "coding-oauth-token",
      providerSpecificData: { deviceId: "coding-device" },
    });

    const [, options] = proxyAwareFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer coding-oauth-token");
    expect(options.headers["x-api-key"]).toBeUndefined();
    expect(options.headers["X-Msh-Device-Id"]).toBe("coding-device");
  });

  it("does not advertise Kimi Platform pay-as-you-go usage as Kimi Coding quota", async () => {
    const usage = await getUsageForProvider({ provider: "kimi", apiKey: "platform-key" });
    expect(usage.quotas).toBeUndefined();
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("prefers API-key credentials when both auth types are supplied", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(USAGE));
    await getUsageForProvider({
      provider: "kimi-coding", accessToken: "oauth-token", apiKey: "selected-key",
    });
    const [, options] = proxyAwareFetch.mock.calls[0];
    expect(options.headers["x-api-key"]).toBe("selected-key");
    expect(options.headers.Authorization).toBeUndefined();
    expect(options.headers["X-Msh-Platform"]).toBeUndefined();
  });

  it("maps membership levels while preserving an unknown future level", async () => {
    for (const [level, plan] of [
      ["Andante", "Andante"], ["LEVEL_BASIC", "Moderato"],
      ["LEVEL_INTERMEDIATE", "Allegretto"], ["LEVEL_ADVANCED", "Allegro"],
      ["LEVEL_STANDARD", "Vivace"], ["LEVEL_FUTURE", "future"],
    ]) {
      proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
        user: { membership: { level } }, usage: { limit: "10", used: "1", remaining: "9" },
      }));
      const usage = await getUsageForProvider({ provider: "kimi-coding", accessToken: "token" });
      expect(usage.plan).toBe(plan);
    }
  });

  it("keeps rolling and weekly quota windows separate", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      ...USAGE,
      limits: [{
        window: { type: "rate" },
        detail: { limit: "60", remaining: "40", resetTime: "2026-07-29T12:00:00Z" },
      }],
    }));
    const usage = await getUsageForProvider({ provider: "kimi-coding", accessToken: "token" });
    expect(usage.quotas.Weekly).toMatchObject({ used: 35, total: 100, remainingPercentage: 65 });
    expect(usage.quotas["Rolling 5-hour"]).toMatchObject({
      used: 20, total: 60, remainingPercentage: expect.closeTo(40 / 60 * 100, 5),
    });
  });

  it("does not fabricate quota when the provider omits limits", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      user: { membership: { level: "LEVEL_BASIC" } }, usage: {},
    }));
    const usage = await getUsageForProvider({ provider: "kimi-coding", accessToken: "token" });
    expect(usage.plan).toBe("Moderato");
    expect(usage.quotas).toBeUndefined();
  });

  it("does not probe without credentials", async () => {
    const usage = await getUsageForProvider({ provider: "kimi-coding" });
    expect(usage.quotas).toBeUndefined();
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("aborts a stalled quota request at its deadline", async () => {
    vi.useFakeTimers();
    try {
      let requestSignal;
      proxyAwareFetch.mockImplementationOnce((_url, { signal }) => {
        requestSignal = signal;
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      });
      const pending = getUsageForProvider({ provider: "kimi-coding", accessToken: "token" });
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).quotas).toBeUndefined();
      expect(requestSignal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a quota body that stalls after headers", async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      proxyAwareFetch.mockResolvedValueOnce({
        ok: true, status: 200, text: () => new Promise(() => {}), body: { cancel },
      });
      const pending = getUsageForProvider({ provider: "kimi-coding", accessToken: "token" });
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).quotas).toBeUndefined();
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
