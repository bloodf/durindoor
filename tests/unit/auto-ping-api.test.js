import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setProviderConnectionAutoPing: vi.fn(),
  notifyQuotaAutoPingSettingChanged: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => ({ body, status: init.status || 200 }),
  },
}));
vi.mock("@/lib/localDb", () => ({
  setProviderConnectionAutoPing: mocks.setProviderConnectionAutoPing,
}));
vi.mock("@/shared/services/quotaAutoPing", () => ({
  notifyQuotaAutoPingSettingChanged: mocks.notifyQuotaAutoPingSettingChanged,
}));

const route = await import("../../src/app/api/providers/[id]/auto-ping/route.js");

function request(body) {
  return { json: vi.fn().mockResolvedValue(body) };
}

describe("connection auto-ping API", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([undefined, null, 1, "true"])('rejects non-boolean enabled value %j', async (enabled) => {
    const response = await route.PATCH(request({ enabled }), { params: Promise.resolve({ id: "conn-1" }) });

    expect(response.status).toBe(400);
    expect(mocks.setProviderConnectionAutoPing).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing connection", async () => {
    mocks.setProviderConnectionAutoPing.mockResolvedValue(null);

    const response = await route.PATCH(request({ enabled: true }), { params: Promise.resolve({ id: "missing" }) });

    expect(response.status).toBe(404);
    expect(mocks.notifyQuotaAutoPingSettingChanged).not.toHaveBeenCalled();
  });

  it("persists one eligible connection then reconciles the scheduler with durable config", async () => {
    const config = { connections: { "conn-1": true } };
    const result = { connectionId: "conn-1", provider: "claude", enabled: true, config };
    mocks.setProviderConnectionAutoPing.mockResolvedValue(result);

    const response = await route.PATCH(request({ enabled: true }), { params: Promise.resolve({ id: "conn-1" }) });

    expect(response).toMatchObject({ status: 200, body: result });
    expect(mocks.setProviderConnectionAutoPing).toHaveBeenCalledWith("conn-1", true);
    expect(mocks.notifyQuotaAutoPingSettingChanged).toHaveBeenCalledWith("claude", "conn-1", true, config);
  });

  it("maps eligibility failures to 400 without notifying", async () => {
    const error = Object.assign(new Error("OAuth only"), { code: "AUTO_PING_INELIGIBLE" });
    mocks.setProviderConnectionAutoPing.mockRejectedValue(error);

    const response = await route.PATCH(request({ enabled: false }), { params: Promise.resolve({ id: "conn-1" }) });

    expect(response).toMatchObject({ status: 400, body: { error: "OAuth only" } });
    expect(mocks.notifyQuotaAutoPingSettingChanged).not.toHaveBeenCalled();
  });
});
