/**
 * GHSA-qvfm / issue #561: database export/import must require dual auth
 * (CLI+password or JWT+password). A stolen machine-bound CLI token alone
 * must not dump or replace credentials.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportDb: vi.fn(async () => ({ version: 1, settings: {} })),
  importDb: vi.fn(async () => undefined),
  getSettings: vi.fn(async () => ({})),
  applyOutboundProxyEnv: vi.fn(),
  verifyDashboardPassword: vi.fn(async () => false),
  hasValidCliToken: vi.fn(async () => false),
  hasValidToken: vi.fn(async () => false),
}));

vi.mock("@/lib/localDb", () => ({
  exportDb: mocks.exportDb,
  importDb: mocks.importDb,
  getSettings: mocks.getSettings,
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: mocks.applyOutboundProxyEnv }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardPassword: mocks.verifyDashboardPassword }));
vi.mock("@/dashboardGuard", () => ({
  hasValidCliToken: mocks.hasValidCliToken,
  hasValidToken: mocks.hasValidToken,
}));

const { GET, POST, requireDatabaseDualAuth } = await import("../../src/app/api/settings/database/route.js");

const UNAUTH = {
  error: "Unauthorized: CLI token + password or JWT session + password required",
};

function exportRequest({ password, cliToken } = {}) {
  const headers = {};
  if (password != null) headers["x-9r-password"] = password;
  if (cliToken != null) headers["x-9r-cli-token"] = cliToken;
  return new Request("http://localhost/api/settings/database", { method: "GET", headers });
}

function importRequest({ password, cliToken, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (cliToken != null) headers["x-9r-cli-token"] = cliToken;
  return new Request("http://localhost/api/settings/database", {
    method: "POST",
    headers,
    body: JSON.stringify({ settings: { cloudEnabled: false }, ...(body || {}), ...(password != null ? { password } : {}) }),
  });
}

describe("requireDatabaseDualAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasValidCliToken.mockResolvedValue(false);
    mocks.hasValidToken.mockResolvedValue(false);
    mocks.verifyDashboardPassword.mockResolvedValue(false);
  });

  it("rejects when neither CLI nor JWT is valid", async () => {
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    await expect(requireDatabaseDualAuth(exportRequest({ password: "x" }), "x")).resolves.toBe(false);
  });

  it("rejects valid CLI without password", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);
    await expect(requireDatabaseDualAuth(exportRequest({ cliToken: "tok" }), null)).resolves.toBe(false);
    expect(mocks.verifyDashboardPassword).not.toHaveBeenCalled();
  });

  it("rejects valid JWT without password", async () => {
    mocks.hasValidToken.mockResolvedValue(true);
    await expect(requireDatabaseDualAuth(exportRequest(), "")).resolves.toBe(false);
  });

  it("rejects valid CLI with wrong password", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);
    mocks.verifyDashboardPassword.mockResolvedValue(false);
    await expect(requireDatabaseDualAuth(exportRequest({ password: "nope" }), "nope")).resolves.toBe(false);
  });

  it("accepts valid CLI + correct password", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    await expect(requireDatabaseDualAuth(exportRequest({ password: "ok" }), "ok")).resolves.toBe(true);
  });

  it("accepts valid JWT + correct password", async () => {
    mocks.hasValidToken.mockResolvedValue(true);
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    await expect(requireDatabaseDualAuth(exportRequest({ password: "ok" }), "ok")).resolves.toBe(true);
  });
});

describe("GET /api/settings/database dual auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasValidCliToken.mockResolvedValue(false);
    mocks.hasValidToken.mockResolvedValue(false);
    mocks.verifyDashboardPassword.mockResolvedValue(false);
    mocks.exportDb.mockResolvedValue({ version: 1 });
  });

  it("rejects CLI token alone", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);
    const response = await GET(exportRequest({ cliToken: "stolen" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTH);
    expect(mocks.exportDb).not.toHaveBeenCalled();
  });

  it("rejects JWT alone", async () => {
    mocks.hasValidToken.mockResolvedValue(true);
    const response = await GET(exportRequest());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTH);
    expect(mocks.exportDb).not.toHaveBeenCalled();
  });

  it("rejects forged CLI header that would previously skip password when JWT is valid", async () => {
    // Old hole: isCliRequest only checked header presence. JWT passed ALWAYS_PROTECTED;
    // a forged x-9r-cli-token then skipped password. Dual auth must still require password.
    mocks.hasValidCliToken.mockResolvedValue(false);
    mocks.hasValidToken.mockResolvedValue(true);
    const response = await GET(exportRequest({ cliToken: "forged-not-machine-bound" }));
    expect(response.status).toBe(401);
    expect(mocks.exportDb).not.toHaveBeenCalled();
    expect(mocks.verifyDashboardPassword).not.toHaveBeenCalled();
  });

  it("exports with CLI + password", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    const response = await GET(exportRequest({ cliToken: "tok", password: "secret" }));
    expect(response.status).toBe(200);
    expect(mocks.verifyDashboardPassword).toHaveBeenCalledWith("secret");
    expect(mocks.exportDb).toHaveBeenCalled();
  });

  it("exports with JWT + password", async () => {
    mocks.hasValidToken.mockResolvedValue(true);
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    const response = await GET(exportRequest({ password: "secret" }));
    expect(response.status).toBe(200);
    expect(mocks.verifyDashboardPassword).toHaveBeenCalledWith("secret");
    expect(mocks.exportDb).toHaveBeenCalled();
  });
});

describe("POST /api/settings/database dual auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasValidCliToken.mockResolvedValue(false);
    mocks.hasValidToken.mockResolvedValue(false);
    mocks.verifyDashboardPassword.mockResolvedValue(false);
  });

  it("rejects CLI token alone", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);
    const response = await POST(importRequest({ cliToken: "stolen" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTH);
    expect(mocks.importDb).not.toHaveBeenCalled();
  });

  it("rejects JWT alone", async () => {
    mocks.hasValidToken.mockResolvedValue(true);
    const response = await POST(importRequest({}));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTH);
    expect(mocks.importDb).not.toHaveBeenCalled();
  });

  it("imports with CLI + password", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    const response = await POST(importRequest({ cliToken: "tok", password: "secret" }));
    expect(response.status).toBe(200);
    expect(mocks.importDb).toHaveBeenCalledWith({ settings: { cloudEnabled: false } });
  });

  it("imports with JWT + password", async () => {
    mocks.hasValidToken.mockResolvedValue(true);
    mocks.verifyDashboardPassword.mockResolvedValue(true);
    const response = await POST(importRequest({ password: "secret" }));
    expect(response.status).toBe(200);
    expect(mocks.verifyDashboardPassword).toHaveBeenCalledWith("secret");
    expect(mocks.importDb).toHaveBeenCalled();
  });
});
