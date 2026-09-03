import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  importDb: vi.fn(),
  getSettings: vi.fn(async () => ({})),
  applyOutboundProxyEnv: vi.fn(),
  verifyDashboardPassword: vi.fn(async () => true),
  hasValidCliToken: vi.fn(async () => false),
  hasValidToken: vi.fn(async () => false),
  startQuotaAutoPing: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  exportDb: vi.fn(),
  importDb: mocks.importDb,
  getSettings: mocks.getSettings,
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: mocks.applyOutboundProxyEnv }));
vi.mock("@/shared/services/quotaAutoPing", () => ({
  startQuotaAutoPing: mocks.startQuotaAutoPing,
}));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardPassword: mocks.verifyDashboardPassword }));
vi.mock("@/dashboardGuard", () => ({
  hasValidCliToken: mocks.hasValidCliToken,
  hasValidToken: mocks.hasValidToken,
}));

import { POST, readJsonBodyWithLimit } from "../../src/app/api/settings/database/route.js";
import { DATABASE_IMPORT_MAX_BYTES } from "../../src/shared/constants/quota.js";

describe("database import request bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    mocks.hasValidCliToken.mockResolvedValue(false);
    mocks.hasValidToken.mockResolvedValue(false);
  });

  it("rejects an oversized declared body with 413 before import", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);
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


  it("still reconciles the scheduler when re-applying the outbound proxy env throws", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);
    mocks.applyOutboundProxyEnv.mockImplementationOnce(() => { throw new Error("proxy env boom"); });
    const settingsSnapshot = { claudeAutoPing: { connections: { c1: true } } };
    mocks.getSettings.mockResolvedValueOnce(settingsSnapshot);
    const request = new Request("http://localhost/api/settings/database", {
      method: "POST",
      headers: { "content-type": "application/json", "x-9r-cli-token": "local" },
      body: JSON.stringify({ settings: settingsSnapshot, password: "correct-horse" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.startQuotaAutoPing).toHaveBeenCalledWith(settingsSnapshot);
  });
  it("imports a bounded CLI+password payload and re-applies proxy settings", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    const request = new Request("http://localhost/api/settings/database", {
      method: "POST",
      headers: { "content-type": "application/json", "x-9r-cli-token": "local" },
      body: JSON.stringify({ settings: { cloudEnabled: false }, password: "correct-horse" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mocks.verifyDashboardPassword).toHaveBeenCalledWith("correct-horse");
    expect(mocks.importDb).toHaveBeenCalledWith({ settings: { cloudEnabled: false } });
    expect(mocks.applyOutboundProxyEnv).toHaveBeenCalledWith({});
  });

  it("activates the scheduler when the imported settings carry opt-ins, only after successful import", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);
    const settingsSnapshot = { claudeAutoPing: { connections: { c1: true } } };
    mocks.getSettings.mockResolvedValueOnce(settingsSnapshot);
    const request = new Request("http://localhost/api/settings/database", {
      method: "POST",
      headers: { "content-type": "application/json", "x-9r-cli-token": "local" },
      body: JSON.stringify({ settings: settingsSnapshot, password: "correct-horse" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.importDb).toHaveBeenCalled();
    expect(mocks.startQuotaAutoPing).toHaveBeenCalledWith(settingsSnapshot);
  });

  it("reconciles the scheduler with zero-opt-in imported settings", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);
    const settingsSnapshot = {};
    mocks.getSettings.mockResolvedValueOnce(settingsSnapshot);
    const request = new Request("http://localhost/api/settings/database", {
      method: "POST",
      headers: { "content-type": "application/json", "x-9r-cli-token": "local" },
      body: JSON.stringify({ settings: {}, password: "correct-horse" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.startQuotaAutoPing).toHaveBeenCalledWith(settingsSnapshot);
  });

  it("never reconciles the scheduler when auth fails before import", async () => {
    mocks.hasValidCliToken.mockResolvedValue(false);
    mocks.hasValidToken.mockResolvedValue(false);
    const request = new Request("http://localhost/api/settings/database", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: {}, password: "wrong" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(mocks.importDb).not.toHaveBeenCalled();
    expect(mocks.startQuotaAutoPing).not.toHaveBeenCalled();
  });
});
