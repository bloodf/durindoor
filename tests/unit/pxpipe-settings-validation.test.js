import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  runHealthCheck: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => ({ body, status: init.status || 200 }),
  },
}));
vi.mock("@/lib/localDb", () => mocks);
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
}));
vi.mock("@/shared/services/quotaAutoPing", () => ({ runQuotaAutoPingTick: vi.fn() }));
vi.mock("@/lib/pxpipe/service.js", () => ({ runHealthCheck: mocks.runHealthCheck }));

const settingsRoute = await import("../../src/app/api/settings/route.js");

/**
 * Settings PATCH validation for PXPIPE keys must reject bad types/bounds
 * with the repo's `{ error }` 400 shape, and let valid values flow through
 * to persistence (echoed back by GET).
 */
describe("settings API PXPIPE validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSettings.mockImplementation(async (patch) => ({ ...patch }));
    mocks.getSettings.mockResolvedValue({
      pxpipeEnabled: false,
      pxpipeMinChars: 25000,
      pxpipeTimeoutMs: 15000,
    });
  });

  it("rejects negative pxpipeMinChars", async () => {
    const response = await settingsRoute.PATCH({
      json: async () => ({ pxpipeMinChars: -5 }),
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid pxpipeMinChars" });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects non-numeric pxpipeTimeoutMs", async () => {
    const response = await settingsRoute.PATCH({
      json: async () => ({ pxpipeTimeoutMs: "abc" }),
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid pxpipeTimeoutMs" });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects pxpipeTimeoutMs below the 1000ms floor", async () => {
    const response = await settingsRoute.PATCH({
      json: async () => ({ pxpipeTimeoutMs: 500 }),
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid pxpipeTimeoutMs" });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects non-boolean pxpipeEnabled", async () => {
    const response = await settingsRoute.PATCH({
      json: async () => ({ pxpipeEnabled: "yes" }),
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid pxpipeEnabled" });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects non-array pxpipeAllowedModels", async () => {
    const response = await settingsRoute.PATCH({
      json: async () => ({ pxpipeAllowedModels: "claude-fable-5" }),
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid pxpipeAllowedModels" });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects non-string items in pxpipeAllowedModels", async () => {
    const response = await settingsRoute.PATCH({
      json: async () => ({ pxpipeAllowedModels: ["claude-fable-5", 5] }),
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid pxpipeAllowedModels" });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("normalizes pxpipeAllowedModels to trimmed, deduplicated strings", async () => {
    const response = await settingsRoute.PATCH({
      json: async () => ({ pxpipeAllowedModels: ["  claude-fable-5  ", "", "claude-fable-5", "custom-fable"] }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      pxpipeAllowedModels: ["claude-fable-5", "custom-fable"],
    });
  });

  it("strips legacy pxpipeAutoInstall instead of persisting it", async () => {
    const response = await settingsRoute.PATCH({
      json: async () => ({ pxpipeAutoInstall: 1, pxpipeEnabled: true }),
    });

    expect(response.status).toBe(200);
    // removed key must never reach persistence
    expect(mocks.updateSettings).toHaveBeenCalledWith({ pxpipeEnabled: true });
  });

  it("accepts valid pxpipe values and echoes them back from GET", async () => {
    const patch = {
      pxpipeEnabled: true,
      pxpipeMinChars: 40000,
      pxpipeTimeoutMs: 60000,
      pxpipeAllowedModels: ["claude-fable-5"],
    };
    const patchResponse = await settingsRoute.PATCH({ json: async () => patch });

    expect(patchResponse.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith(patch);

    mocks.getSettings.mockResolvedValue({ ...patch });
    const getResponse = await settingsRoute.GET();

    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toMatchObject(patch);
  });
});

/**
 * The health probe must answer GET identically to POST so the dashboard
 * card can probe on page load without issuing a mutation-shaped request.
 */
describe("pxpipe health route", () => {
  it("GET returns the same shape as POST", async () => {
    mocks.runHealthCheck.mockResolvedValue({
      healthy: true,
      checks: [{ id: "installed", ok: true, detail: "v0.9.0" }],
      error: null,
    });

    const healthRoute = await import("../../src/app/api/pxpipe/health/route.js");

    expect(typeof healthRoute.GET).toBe("function");
    expect(typeof healthRoute.POST).toBe("function");

    const [getRes, postRes] = await Promise.all([healthRoute.GET(), healthRoute.POST()]);

    expect(getRes.body).toEqual(postRes.body);
    expect(getRes.status).toBe(postRes.status);
    expect(Object.keys(getRes.body).sort()).toEqual(Object.keys(postRes.body).sort());
  });
});
