import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setProviderConnectionAutoPing: vi.fn(),
  notifyQuotaAutoPingSettingChanged: vi.fn(),
  isOperatorRequest: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => ({ body, status: init.status || 200 }),
  },
}));
vi.mock("@/lib/localDb", () => ({
  setProviderConnectionAutoPing: mocks.setProviderConnectionAutoPing,
}));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: mocks.isOperatorRequest }));
vi.mock("@/shared/services/quotaAutoPing", () => ({
  notifyQuotaAutoPingSettingChanged: mocks.notifyQuotaAutoPingSettingChanged,
}));

const route = await import("../../src/app/api/providers/[id]/auto-ping/route.js");

function request(body) {
  return { json: vi.fn().mockResolvedValue(body) };
}

describe("connection auto-ping API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isOperatorRequest.mockResolvedValue(true);
  });

  it("returns 403 for non-operator callers such as inference API keys", async () => {
    mocks.isOperatorRequest.mockResolvedValue(false);

    const response = await route.PATCH(request({ enabled: true }), { params: Promise.resolve({ id: "conn-1" }) });

    expect(response.status).toBe(403);
    expect(mocks.setProviderConnectionAutoPing).not.toHaveBeenCalled();
  });

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

  it("validates the anchored schedule and keeps the reactive flag on schedule-only writes", async () => {
    const schedule = { enabled: true, anchor: "09:30", timezone: "UTC", windowHours: 5, slotsPerDay: 3 };
    const config = { connections: {}, schedules: { "conn-1": schedule } };
    mocks.setProviderConnectionAutoPing.mockResolvedValue({ connectionId: "conn-1", provider: "codex", enabled: false, schedule, config });

    const response = await route.PATCH(request({ schedule }), { params: Promise.resolve({ id: "conn-1" }) });

    expect(response.status).toBe(200);
    expect(mocks.setProviderConnectionAutoPing).toHaveBeenCalledWith("conn-1", undefined, schedule);
    expect(mocks.notifyQuotaAutoPingSettingChanged).toHaveBeenCalledWith("codex", "conn-1", true, config);
  });

  it("maps a disabled schedule to removal", async () => {
    mocks.setProviderConnectionAutoPing.mockResolvedValue({ connectionId: "conn-1", provider: "codex", enabled: false, schedule: null, config: {} });

    await route.PATCH(request({ schedule: { enabled: false } }), { params: Promise.resolve({ id: "conn-1" }) });

    expect(mocks.setProviderConnectionAutoPing).toHaveBeenCalledWith("conn-1", undefined, null);
    expect(mocks.notifyQuotaAutoPingSettingChanged).toHaveBeenCalledWith("codex", "conn-1", false, {});
  });

  it.each([
    [{ enabled: true, anchor: "25:00", timezone: "UTC", windowHours: 5, slotsPerDay: 1 }, /anchor/],
    [{ enabled: true, anchor: "09:30", timezone: "Mars/Olympus", windowHours: 5, slotsPerDay: 1 }, /timezone/],
    [{ enabled: true, anchor: "09:30", timezone: "UTC", windowHours: 0, slotsPerDay: 1 }, /windowHours/],
    [{ enabled: true, anchor: "09:30", timezone: "UTC", windowHours: 0.5, slotsPerDay: 1 }, /windowHours/],
    [{ enabled: true, anchor: "09:30", timezone: "UTC", windowHours: 5, slotsPerDay: 5 }, /slotsPerDay/],
    ["on", /schedule must be/],
  ])("rejects an invalid schedule %j", async (schedule, message) => {
    const response = await route.PATCH(request({ schedule }), { params: Promise.resolve({ id: "conn-1" }) });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(message);
    expect(mocks.setProviderConnectionAutoPing).not.toHaveBeenCalled();
  });
});
