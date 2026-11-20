// #1072 repair: the rotation response must agree with the committed write.
//
// A rotation swaps the credential in one transaction and then answers with the
// replacement. When anything between the commit and the response failed, the
// caller was left holding a dead credential and no replacement at all: the
// swap had happened, the secret was gone, and the only thing the caller saw
// was a 500. That is a partial success nobody can undo, because the retired
// secret is never stored.
//
// These tests pin the contract that removes it:
//
//   - the ancillary reads run before the swap, so a failing read never leaves a
//     committed rotation behind - the previous credential still works,
//   - a committed rotation always delivers the replacement exactly once, even
//     when an optional metadata read would fail after the commit,
//   - a lost race installs nothing and a refused write rolls back, so a failed
//     swap leaves the previous credential working,
//   - the response carries the no-store policy the other management credential
//     responses use.
//
// The fixtures are synthetic: a private temp directory holds the database, and
// every secret, id and usage row here is made up for the test. No real key, no
// provider and no network is involved.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rotateApiKey: vi.fn(),
  getApiKeyUsageTotals: vi.fn(),
  getApiKeyProviderConnectionIds: vi.fn(),
  getGroupIdsForApiKey: vi.fn(),
  canManageAccessConfig: vi.fn(),
  getConsistentMachineId: vi.fn(),
  generateApiKeyWithMachine: null,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      });
    },
  },
}));

vi.mock("@/dashboardGuard", () => ({
  canManageAccessConfig: mocks.canManageAccessConfig,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/lib/localDb", () => ({
  rotateApiKey: mocks.rotateApiKey,
  getApiKeyUsageTotals: mocks.getApiKeyUsageTotals,
  getApiKeyProviderConnectionIds: mocks.getApiKeyProviderConnectionIds,
  getGroupIdsForApiKey: mocks.getGroupIdsForApiKey,
}));

// The secret generator is replaceable so a test can force a collision or a
// failure inside the rotation. Without a replacement the real generator runs.
vi.mock("@/shared/utils/apiKey", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    generateApiKeyWithMachine: (...args) => (mocks.generateApiKeyWithMachine
      ? mocks.generateApiKeyWithMachine(...args)
      : actual.generateApiKeyWithMachine(...args)),
  };
});

const { POST: rotateRoute } = await import("../../src/app/api/keys/[id]/rotate/route");

const MACHINE = "fixturemachine";
const originalDataDir = process.env.DATA_DIR;
let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-rotate-commit-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  mocks.rotateApiKey.mockReset();
  mocks.getApiKeyUsageTotals.mockReset();
  mocks.getApiKeyProviderConnectionIds.mockReset();
  mocks.getGroupIdsForApiKey.mockReset();
  mocks.canManageAccessConfig.mockReset();
  mocks.getConsistentMachineId.mockReset();
  mocks.generateApiKeyWithMachine = null;
  mocks.canManageAccessConfig.mockResolvedValue(true);
  mocks.getConsistentMachineId.mockResolvedValue(MACHINE);
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch { /* already closed */ }
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Wire the route to the real repository and to a synthetic key in a private
 * database, so the swap under test is the production one.
 */
async function useRealRepository() {
  const repo = await import("@/lib/db/repos/apiKeysRepo.js");
  const database = await import("@/lib/db/index.js");
  const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  mocks.rotateApiKey.mockImplementation((id, machineId) => repo.rotateApiKey(id, machineId));
  mocks.getApiKeyUsageTotals.mockImplementation((id) => database.getApiKeyUsageTotals(id));
  mocks.getApiKeyProviderConnectionIds.mockImplementation((id) => database.getApiKeyProviderConnectionIds(id));
  mocks.getGroupIdsForApiKey.mockImplementation((id) => database.getGroupIdsForApiKey(id));
  const key = await database.createApiKey(
    "Fixture key",
    MACHINE,
    ["combo-a"],
    1000,
    null,
    { policy: { allowedModels: ["openai/gpt-test"] }, isAdmin: true }
  );
  return { repo, database, adapter, key };
}

const request = () => new Request("https://durindoor.local/api/keys/key-id/rotate", { method: "POST" });
const paramsFor = (id) => ({ params: Promise.resolve({ id }) });

describe("POST /api/keys/[id]/rotate — committed response", () => {
  it("delivers the committed replacement and retires the previous credential", async () => {
    const { database, key } = await useRealRepository();

    const response = await rotateRoute(request(), paramsFor(key.id));
    const body = await response.json();

    expect(response.status).toBe(200);
    // The replacement is the installed secret, not the retired one.
    expect(body.key).toMatch(/^sk-fixturemachine-/);
    expect(body.key).not.toBe(key.key);
    expect(body.key).toBe((await database.getApiKeyById(key.id)).key);
    // The retired credential stops working the moment the swap commits.
    expect(await database.validateApiKey(key.key)).toBe(false);
    expect(await database.validateApiKey(body.key)).toBe(true);
    // The replacement is delivered exactly once, and the retired secret is
    // nowhere in the response.
    expect(body.maskedKey).toBe("sk-••••••••");
    expect(JSON.stringify(body)).not.toContain(key.key);
  });

  it("keeps the stable id, the scopes and the usage on the rotated key", async () => {
    const { database, key } = await useRealRepository();
    await database.saveRequestUsage({
      provider: "openai", model: "gpt-test", apiKey: key.key, apiKeyId: key.id,
      usageEventId: "before-rotate", tokens: { prompt_tokens: 40, completion_tokens: 60 }, cost: 0.5, costStatus: "known", costSource: "provider",
    });

    const response = await rotateRoute(request(), paramsFor(key.id));
    const body = await response.json();

    expect(body.id).toBe(key.id);
    expect(body.allowedCombos).toEqual(["combo-a"]);
    expect(body.dailyLimitTokens).toBe(1000);
    expect(body.policy).toEqual({ allowedModels: ["openai/gpt-test"] });
    // Usage stays attached to the stable id, so a rotation buys no fresh
    // allowance.
    expect(body.usage.totalRequests).toBe(1);
    expect(await database.getApiKeyUsageTotals(key.id)).toMatchObject({ totalRequests: 1 });
  });

  it("reads the ancillary metadata before the swap", async () => {
    const { key } = await useRealRepository();

    await rotateRoute(request(), paramsFor(key.id));

    const readOrder = mocks.getApiKeyUsageTotals.mock.invocationCallOrder[0];
    const swapOrder = mocks.rotateApiKey.mock.invocationCallOrder[0];
    expect(readOrder).toBeLessThan(swapOrder);
  });

  it("does not read anything after the swap, so a committed rotation cannot be stranded", async () => {
    const { key } = await useRealRepository();
    // Every ancillary read fails once the swap has happened. A read after the
    // commit would answer 500 and hide the replacement that is already
    // installed.
    mocks.getApiKeyUsageTotals.mockImplementation(async () => {
      if (mocks.rotateApiKey.mock.calls.length > 0) throw new Error("read after the commit");
      return { totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null };
    });

    const response = await rotateRoute(request(), paramsFor(key.id));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.key).toMatch(/^sk-fixturemachine-/);
  });

  it("leaves the previous credential working when an ancillary read rejects", async () => {
    const { database, key } = await useRealRepository();
    mocks.getApiKeyUsageTotals.mockRejectedValue(new Error("usage read failed"));

    const response = await rotateRoute(request(), paramsFor(key.id));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to rotate key" });
    // The swap never ran, so the caller still holds a working credential and
    // the row is untouched.
    expect(mocks.rotateApiKey).not.toHaveBeenCalled();
    expect(await database.validateApiKey(key.key)).toBe(true);
    expect((await database.getApiKeyById(key.id)).key).toBe(key.key);
  });

  it("leaves the previous credential working when the swap itself is refused", async () => {
    const { database, key } = await useRealRepository();
    const other = await database.createApiKey("Other key", MACHINE, [], null, null, { policy: null, isAdmin: false });
    // The generator hands back a secret another key already stores, so the
    // unique index refuses the write.
    mocks.generateApiKeyWithMachine = () => ({ key: other.key, keyId: "duplicat" });

    const response = await rotateRoute(request(), paramsFor(key.id));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to rotate key" });
    expect(await database.validateApiKey(key.key)).toBe(true);
    expect((await database.getApiKeyById(key.id)).key).toBe(key.key);
  });

  it("404s for an unknown key without writing anything", async () => {
    const { adapter } = await useRealRepository();

    const response = await rotateRoute(request(), paramsFor("missing-id"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Key not found" });
    expect(adapter.all(`SELECT id FROM apiKeys`)).toHaveLength(1);
  });

  it("reports a lost race as a conflict and returns no secret", async () => {
    const { database, key } = await useRealRepository();
    mocks.rotateApiKey.mockResolvedValue({ status: "conflict" });

    const response = await rotateRoute(request(), paramsFor(key.id));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/rotated by another request/);
    expect(body.key).toBeUndefined();
    // The loser installed nothing.
    expect((await database.getApiKeyById(key.id)).key).toBe(key.key);
  });

  it("denies an unpermitted caller before anything is read or written", async () => {
    const { key } = await useRealRepository();
    mocks.canManageAccessConfig.mockResolvedValue(false);

    const response = await rotateRoute(request(), paramsFor(key.id));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Rotating an API key requires an operator session" });
    expect(mocks.rotateApiKey).not.toHaveBeenCalled();
    expect(mocks.getApiKeyUsageTotals).not.toHaveBeenCalled();
  });

  it("marks the rotation response as no-store", async () => {
    const { key } = await useRealRepository();

    const response = await rotateRoute(request(), paramsFor(key.id));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("marks the failure responses as no-store too", async () => {
    const { key } = await useRealRepository();
    mocks.getApiKeyUsageTotals.mockRejectedValue(new Error("usage read failed"));

    const response = await rotateRoute(request(), paramsFor(key.id));

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not log the raw failure", async () => {
    const { key } = await useRealRepository();
    const logged = [];
    const record = (...args) => { logged.push(args); };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(record);
    const logSpy = vi.spyOn(console, "log").mockImplementation(record);
    mocks.getApiKeyUsageTotals.mockRejectedValue(new Error("usage read failed for sk-fixturemachine-secret-1a2b3c4d"));

    const response = await rotateRoute(request(), paramsFor(key.id));
    errorSpy.mockRestore();
    logSpy.mockRestore();

    expect(response.status).toBe(500);
    // The database error text is not written down: it can carry the row it
    // touched, and a credential must never reach a log.
    const serialized = logged.flat().map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry instanceof Error) return `${entry.name}: ${entry.message}`;
      try { return JSON.stringify(entry); } catch { return String(entry); }
    }).join(" ");
    expect(serialized).not.toContain("usage read failed");
    expect(serialized).not.toContain("sk-fixturemachine-secret-1a2b3c4d");
  });
});

describe("rotateApiKey — one installed secret per rotation", () => {
  it("installs only one secret when two rotations race", async () => {
    const { repo, database, adapter, key } = await useRealRepository();
    const competing = "sk-fixturemachine-competing-0f0f0f0f";
    const candidate = "sk-fixturemachine-candidate-1e1e1e1e";

    // The key changes underneath the rotation, between its read and its write.
    mocks.generateApiKeyWithMachine = () => {
      adapter.run(`UPDATE apiKeys SET key = ?, machineId = ? WHERE id = ?`, [competing, MACHINE, key.id]);
      return { key: candidate, keyId: "candidat" };
    };

    const outcome = await repo.rotateApiKey(key.id, MACHINE);

    expect(outcome.status).toBe("conflict");
    expect(outcome.key).toBeUndefined();
    // The competing secret is the live one; the losing candidate was never
    // installed.
    expect((await database.getApiKeyById(key.id)).key).toBe(competing);
    expect(await database.validateApiKey(candidate)).toBe(false);
    expect(await database.validateApiKey(competing)).toBe(true);
  });

  it("rolls back and keeps the old credential when the write is refused", async () => {
    const { repo, database, key } = await useRealRepository();
    const other = await database.createApiKey("Other key", MACHINE, [], null, null, { policy: null, isAdmin: false });

    mocks.generateApiKeyWithMachine = () => ({ key: other.key, keyId: "duplicat" });

    await expect(repo.rotateApiKey(key.id, MACHINE)).rejects.toThrow();

    expect(await database.validateApiKey(key.key)).toBe(true);
    expect((await database.getApiKeyById(key.id)).key).toBe(key.key);
  });
});
