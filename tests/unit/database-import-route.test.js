import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  importDb: vi.fn(),
  getSettings: vi.fn(async () => ({})),
  applyOutboundProxyEnv: vi.fn(),
  verifyDashboardPassword: vi.fn(async () => true),
}));

vi.mock("@/lib/localDb", () => ({
  exportDb: vi.fn(),
  importDb: mocks.importDb,
  getSettings: mocks.getSettings,
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: mocks.applyOutboundProxyEnv }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardPassword: mocks.verifyDashboardPassword }));

import { POST, readJsonBodyWithLimit } from "../../src/app/api/settings/database/route.js";
import { DATABASE_IMPORT_MAX_BYTES } from "../../src/shared/constants/quota.js";

describe("database import request bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an oversized declared body with 413 before import", async () => {
    const request = new Request("http://localhost/api/settings/database", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(DATABASE_IMPORT_MAX_BYTES + 1),
        "x-9r-cli-token": "local",
      },
      body: "{}",
    });
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Database import is too large" });
    expect(mocks.importDb).not.toHaveBeenCalled();
  });

  it("bounds chunked bodies by bytes even without Content-Length", async () => {
    const encoder = new TextEncoder();
    const request = new Request("http://localhost/api/settings/database", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"value":'));
          controller.enqueue(encoder.encode('"too-large"}'));
          controller.close();
        },
      }),
      duplex: "half",
    });
    await expect(readJsonBodyWithLimit(request, 8)).rejects.toMatchObject({ code: "DATABASE_IMPORT_TOO_LARGE" });
  });

  it("imports a bounded CLI payload and re-applies proxy settings", async () => {
    const request = new Request("http://localhost/api/settings/database", {
      method: "POST",
      headers: { "content-type": "application/json", "x-9r-cli-token": "local" },
      body: JSON.stringify({ settings: { cloudEnabled: false } }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mocks.importDb).toHaveBeenCalledWith({ settings: { cloudEnabled: false } });
    expect(mocks.applyOutboundProxyEnv).toHaveBeenCalledWith({});
  });
});
