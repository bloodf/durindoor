import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => outbound(...args),
}));

const { AntigravityService } = await import("../../src/lib/oauth/services/antigravity.js");
const { getProvider } = await import("../../src/lib/oauth/providers.js");
const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

const outbound = vi.fn();

beforeEach(() => {
  outbound.mockReset();
  vi.stubGlobal("fetch", outbound);
});
afterEach(() => vi.unstubAllGlobals());

describe("upstream PR #141 - Antigravity onboarding mode", () => {
  it("sends numeric client metadata and mode 1 on the per-model quota request", async () => {
    outbound.mockImplementation(async (url) => Response.json(
      url.includes(":loadCodeAssist")
        ? { cloudaicompanionProject: "project-mode-quota", currentTier: { name: "Pro" } }
        : { models: {} },
    ));
    await getAntigravityUsage("synthetic-quota-token", {});
    const quota = outbound.mock.calls.find(([url]) => url.includes(":fetchAvailableModels"));
    expect(quota).toBeDefined();
    expect(JSON.parse(quota[1].body)).toMatchObject({
      project: "project-mode-quota", metadata: { ideType: 9, pluginType: 2 }, mode: 1,
    });
  });

  it("sends mode 1 for CLI project lookup and onboarding", async () => {
    const service = new AntigravityService();
    outbound.mockResolvedValueOnce(Response.json({
      cloudaicompanionProject: { id: "project-cli" },
      allowedTiers: [{ id: "free-tier", isDefault: true }],
    })).mockResolvedValueOnce(Response.json({ done: true }));

    await expect(service.loadCodeAssist("synthetic-token")).resolves.toEqual({
      projectId: "project-cli", tierId: "free-tier",
    });
    await expect(service.onboardUser("synthetic-token", "project-cli", "free-tier"))
      .resolves.toEqual({ done: true });

    expect(outbound).toHaveBeenCalledTimes(2);
    const [load, onboard] = outbound.mock.calls;
    expect(load[0]).toBe(service.config.loadCodeAssistEndpoint);
    expect(onboard[0]).toBe(service.config.onboardUserEndpoint);
    expect(JSON.parse(load[1].body)).toEqual({ metadata: service.getMetadata(), mode: 1 });
    expect(JSON.parse(onboard[1].body)).toEqual({
      tierId: "free-tier", metadata: service.getMetadata(), mode: 1,
    });
    expect(load[1].headers.Authorization).toBe("Bearer synthetic-token");
    expect(onboard[1].headers.Authorization).toBe("Bearer synthetic-token");
  });

  it("sends mode 1 through dashboard account resolution without losing proxy context", async () => {
    const provider = getProvider("antigravity");
    const proxyOptions = { disableEnvProxy: true };
    outbound.mockResolvedValueOnce(Response.json({ email: "mode@example.test", sub: "subject-mode" }))
      .mockResolvedValueOnce(Response.json({ allowedTiers: [{ id: "free-tier", isDefault: true }] }))
      .mockResolvedValueOnce(Response.json({
        done: true, response: { cloudaicompanionProject: { id: "project-dashboard" } },
      }));

    const account = await provider.postExchange({ access_token: "synthetic-token" }, proxyOptions);
    expect(account.projectId).toBe("project-dashboard");
    expect(account.userInfo.email).toBe("mode@example.test");
    expect(outbound).toHaveBeenCalledTimes(3);
    const [, load, onboard] = outbound.mock.calls;
    expect(load[0]).toBe(provider.config.loadCodeAssistEndpoint);
    expect(onboard[0]).toBe(provider.config.onboardUserEndpoint);
    expect(JSON.parse(load[1].body)).toMatchObject({ mode: 1, metadata: { ideType: 9, pluginType: 2 } });
    expect(JSON.parse(onboard[1].body)).toMatchObject({ mode: 1, tier_id: "free-tier" });
    for (const [, options] of outbound.mock.calls) {
      expect(options.proxyOptions).toBe(proxyOptions);
      expect(options.headers.Authorization).toBe("Bearer synthetic-token");
    }
  });
});
