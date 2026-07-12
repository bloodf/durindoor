import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
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
      pxpipeAutoInstall: true,
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

  it("rejects non-boolean pxpipeAutoInstall", async () => {
    const response = await settingsRoute.PATCH({
      json: async () => ({ pxpipeAutoInstall: 1 }),
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid pxpipeAutoInstall" });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("accepts valid pxpipe values and echoes them back from GET", async () => {
    const patch = {
      pxpipeEnabled: true,
      pxpipeAutoInstall: false,
      pxpipeMinChars: 40000,
      pxpipeTimeoutMs: 60000,
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
    const healthRoute = await import("../../src/app/api/pxpipe/health/route.js");

    expect(typeof healthRoute.GET).toBe("function");
    expect(typeof healthRoute.POST).toBe("function");

    const [getRes, postRes] = await Promise.all([healthRoute.GET(), healthRoute.POST()]);

    expect(getRes.body).toEqual(postRes.body);
    expect(getRes.status).toBe(postRes.status);
    expect(Object.keys(getRes.body).sort()).toEqual(Object.keys(postRes.body).sort());
  });
});
