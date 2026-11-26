import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue #2256: invalid outbound proxy saved, PATCH null body 500, store races.

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

vi.mock("@/lib/network/outboundProxy", () => ({
  applyOutboundProxyEnv: mocks.applyOutboundProxyEnv,
}));

vi.mock("@/lib/settings/settingsPatchAuth", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, canModifySecurityCriticalSettings: vi.fn(async () => true) };
});

vi.mock("@/dashboardGuard", async (importOriginal) => ({ ...(await importOriginal()), hasValidCliToken: async () => true }));

vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
}));

import { PATCH } from "../../src/app/api/settings/route.js";
import useSettingsStore from "../../src/store/settingsStore.js";

function req(body) {
  return new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("settings PATCH validation (#2256)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.updateSettings.mockResolvedValue({});
  });

  it("returns 400 for a null body", async () => {
    const res = await PATCH(req(null));
    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("returns 400 for an array body", async () => {
    const res = await PATCH(req([1]));
    expect(res.status).toBe(400);
  });

  it("rejects an enabled proxy with an unparseable URL", async () => {
    const res = await PATCH(req({ outboundProxyEnabled: true, outboundProxyUrl: "not a url" }));
    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects an enabled proxy with an unsupported scheme", async () => {
    const res = await PATCH(req({ outboundProxyEnabled: true, outboundProxyUrl: "ftp://proxy.example:21" }));
    expect(res.status).toBe(400);
  });

  it("rejects enabling against a stored invalid URL", async () => {
    mocks.getSettings.mockResolvedValue({ outboundProxyUrl: "garbage" });
    const res = await PATCH(req({ outboundProxyEnabled: true }));
    expect(res.status).toBe(400);
  });

  it("accepts a valid enabled proxy and a disabled proxy with a bad URL", async () => {
    const ok = await PATCH(req({ outboundProxyEnabled: true, outboundProxyUrl: "http://127.0.0.1:8080" }));
    expect(ok.status).toBe(200);
    const off = await PATCH(req({ outboundProxyEnabled: false, outboundProxyUrl: "not a url" }));
    expect(off.status).toBe(200);
  });
});

describe("settingsStore patchSettings (#2256)", () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: null, error: null, loading: false, lastFetched: 0 });
    vi.unstubAllGlobals();
  });

  it("sets error when the save fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Invalid outboundProxyUrl" }) })));
    const result = await useSettingsStore.getState().patchSettings({ outboundProxyEnabled: true });
    expect(result).toBeNull();
    expect(useSettingsStore.getState().error).toBe("Invalid outboundProxyUrl");
  });

  it("drops a stale response that resolves after a newer PATCH", async () => {
    let resolveOld;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }))
      .mockImplementationOnce(async () => ({ ok: true, json: async () => ({ v: "new" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const oldP = useSettingsStore.getState().patchSettings({ v: "old" });
    await useSettingsStore.getState().patchSettings({ v: "new" });
    resolveOld({ ok: true, json: async () => ({ v: "old" }) });
    await oldP;
    expect(useSettingsStore.getState().settings).toEqual({ v: "new" });
  });
});
