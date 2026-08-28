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
vi.mock("@/lib/pxpipe/service.js", () => ({ runHealthCheck: vi.fn() }));

const settingsRoute = await import("../../src/app/api/settings/route.js");

/**
 * Headroom timeouts share the bounded timeout contract used by PXPIPE and
 * must reject invalid values before settings persistence.
 */
describe("settings API Headroom timeout validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSettings.mockImplementation(async (patch) => ({ ...patch }));
  });

  it.each(["abc", 999, 120001, 1500.5])("rejects invalid timeout %s", async (headroomTimeoutMs) => {
    const response = await settingsRoute.PATCH({
      json: async () => ({ headroomTimeoutMs }),
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid headroomTimeoutMs" });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("persists a valid timeout", async () => {
    const response = await settingsRoute.PATCH({
      json: async () => ({ headroomTimeoutMs: 5000 }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ headroomTimeoutMs: 5000 });
  });
});
