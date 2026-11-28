import { afterEach, describe, expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({ callback: null, url: null }));
vi.mock("open", () => ({ default: async (url) => { cli.url = url; } }));
vi.mock("../../src/lib/oauth/utils/server.js", () => ({
  startLocalServer: async (callback) => { cli.callback = callback; return { port: 51121, close() {} }; },
  waitForCallbackParams: async () => cli.callback({ code: "code", state: new URL(cli.url).searchParams.get("state") }),
}));
vi.mock("../../src/lib/oauth/utils/ui.js", () => {
  const spinner = { start: () => spinner, succeed: () => spinner, fail: () => spinner };
  return { spinner: () => spinner };
});

const { AntigravityService } = await import("../../src/lib/oauth/services/antigravity.js");
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("legacy CLI onboarding wire contract", () => {
  it.each([
    ["existing", { projectId: "existing-project", currentTier: { id: "standard-tier" } }, 0],
    ["new", { allowedTiers: [{ id: "selected-tier", isDefault: true }] }, 1],
  ])("handles an %s account", async (_kind, load, expectedOnboards) => {
    const service = new AntigravityService();
    vi.spyOn(service, "exchangeCode").mockResolvedValue({ access_token: "synthetic" });
    vi.spyOn(service, "getUserInfo").mockResolvedValue({ email: "user@example.test" });
    const save = vi.spyOn(service, "saveTokens").mockResolvedValue({});
    const fetchMock = vi.fn(async (url) => url.includes(":loadCodeAssist")
      ? Response.json(load)
      : Response.json({ done: true, response: { projectId: "new-project" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(service.connect()).resolves.toBe(true);
    const onboard = fetchMock.mock.calls.filter(([url]) => url.includes(":onboardUser"));
    expect(onboard).toHaveLength(expectedOnboards);
    if (expectedOnboards) {
      const body = JSON.parse(onboard[0][1].body);
      expect(body).toEqual({ tier_id: "selected-tier", metadata: service.getMetadata(), mode: 1 });
      expect(body).not.toHaveProperty("tierId");
    }
    expect(save).toHaveBeenCalledWith(expect.anything(), expect.anything(), expectedOnboards ? "new-project" : "existing-project");
  });

  it("keeps the selected tier on every poll and stops at the attempt bound", async () => {
    vi.useFakeTimers();
    const service = new AntigravityService();
    const fetchMock = vi.fn(async () => Response.json({ done: false }));
    vi.stubGlobal("fetch", fetchMock);
    const result = service.completeOnboarding("synthetic", "", "standard-tier", 2).catch((error) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await result).message).toMatch(/timeout/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchMock.mock.calls) {
      const body = JSON.parse(options.body);
      expect(body.tier_id).toBe("standard-tier");
      expect(body).not.toHaveProperty("tierId");
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});
