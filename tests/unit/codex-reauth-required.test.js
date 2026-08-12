import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: dbMocks.getProviderConnections,
  updateProviderConnection: dbMocks.updateProviderConnection,
  getProviderConnectionById: dbMocks.getProviderConnectionById,
  getSettings: dbMocks.getSettings,
  validateApiKey: vi.fn(),
}));
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(),
  clearProviderRateLimitEvidence: vi.fn(),
}));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
const originalDataDir = process.env.DATA_DIR;
let sqliteDb;
let tempDir;

beforeEach(async () => {
  vi.clearAllMocks();
  dbMocks.updateProviderConnection.mockResolvedValue({});
  dbMocks.getProviderConnectionById.mockResolvedValue(null);
  dbMocks.getProviderConnections.mockResolvedValue([{
    id: "codex-a",
    provider: "codex",
    name: "codex-a",
    backoffLevel: 0,
    modelLock_gpt5: "2026-08-11T11:00:00.000Z",
  }]);
  if (!sqliteDb) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-codex-reauth-"));
    process.env.DATA_DIR = tempDir;
    sqliteDb = await import("../../src/lib/db/index.js");
    await sqliteDb.initDb();
  }
});

afterEach(() => vi.useRealTimers());
afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Codex permanent OAuth invalidation", () => {
  it("quarantines a Codex account with reauth_required and clears model locks", async () => {
    await markAccountUnavailable(
      "codex-a", 401, "refresh_token_invalidated: please reauthenticate", "codex", "gpt-5",
    );

    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "codex-a",
      expect.objectContaining({
        testStatus: "reauth_required",
        isActive: false,
        errorCode: 401,
        backoffLevel: 0,
        modelLock_gpt5: null,
      }),
    );
  });

  it("keeps existing cooldown path for generic Codex 401 errors", async () => {
    await markAccountUnavailable("codex-a", 401, "Invalid bearer token", "codex", "gpt-5");

    const call = dbMocks.updateProviderConnection.mock.calls[0][1];
    expect(call.testStatus).not.toBe("reauth_required");
    expect(call.errorCode).toBe(401);
  });
});

describe("Codex OAuth reauthorization merge", () => {
  it("clears persisted reauth state and modelLock_* fields when same identity logs back in", async () => {
    const existing = await sqliteDb.createProviderConnection({
      provider: "codex", authType: "oauth", email: "reauth@example.com",
      accessToken: "stale-token", refreshToken: "stale-rt",
      providerSpecificData: { chatgptAccountId: "account-1" },
    });
    await sqliteDb.updateProviderConnection(existing.id, {
      isActive: false, testStatus: "reauth_required", lastError: "Codex OAuth token invalidated",
      lastErrorAt: "2026-08-11T10:00:00.000Z", errorCode: "REAUTH", backoffLevel: 3,
      modelLock_gpt5: "2026-08-11T11:00:00.000Z", modelLock___all: "2026-08-11T11:30:00.000Z",
    });

    const result = await sqliteDb.createProviderConnection({
      provider: "codex", authType: "oauth", email: "reauth@example.com",
      accessToken: "fresh-token", refreshToken: "fresh-rt",
      providerSpecificData: { chatgptAccountId: "account-1" },
    });

    expect(result).toMatchObject({
      id: existing.id, accessToken: "fresh-token", refreshToken: "fresh-rt", isActive: true, testStatus: "active",
    });
    for (const field of ["errorCode", "lastError", "lastErrorAt", "backoffLevel", "modelLock_gpt5", "modelLock___all"]) {
      expect(result).not.toHaveProperty(field);
    }
  });
});
