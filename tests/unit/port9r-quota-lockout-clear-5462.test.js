import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const oldDataDir = process.env.DATA_DIR;
let dataDir;

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-quota-clear-5462-"));
  process.env.DATA_DIR = dataDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterAll(() => {
  global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (oldDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = oldDataDir;
});

describe("upstream PR #5462: clearAccountError quota lockout cleanup", () => {
  it("clears an expired quotaLockout on request success", async () => {
    const repo = await import("../../src/lib/db/repos/connectionsRepo.js");
    const created = await repo.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "Expired Lockout",
      apiKey: "sk-test-expired-5462",
    });
    await repo.updateProviderConnection(created.id, {
      testStatus: "unavailable",
      quotaLockout: {
        status: "quota_exhausted",
        source: "auto",
        message: "Provider quota exhausted",
        detectedAt: "2020-01-01T00:00:00.000Z",
        reactivateAt: "2020-01-02T00:00:00.000Z",
      },
    });

    const now = Date.parse("2026-11-26T12:00:00.000Z");
    const cleared = await repo.clearProviderConnectionFallbackState(created.id, {
      model: "gpt-5",
      observedAt: now,
    }, { now });

    expect(cleared?.applied).toBe(true);
    expect(cleared.connection.quotaLockout).toBeNull();
    expect(cleared.connection.testStatus).toBe("active");

    const persisted = await repo.getProviderConnectionById(created.id);
    expect(persisted.quotaLockout).toBeNull();
    expect(persisted.testStatus).toBe("active");
  });

  it("preserves an active indefinite or future quotaLockout and does not flip testStatus to active", async () => {
    const repo = await import("../../src/lib/db/repos/connectionsRepo.js");
    const indefinite = await repo.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "Indefinite Manual Lock",
      apiKey: "sk-test-indefinite-5462",
    });
    await repo.updateProviderConnection(indefinite.id, {
      testStatus: "unavailable",
      quotaLockout: {
        status: "quota_exhausted",
        source: "manual",
        message: "Manually scheduled",
        detectedAt: "2026-11-26T10:00:00.000Z",
        reactivateAt: null,
      },
    });
    const future = await repo.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "Future Auto Lock",
      apiKey: "sk-test-future-5462",
    });
    await repo.updateProviderConnection(future.id, {
      testStatus: "unavailable",
      quotaLockout: {
        status: "quota_exhausted",
        source: "auto",
        message: "Provider quota exhausted",
        detectedAt: "2026-11-26T10:00:00.000Z",
        reactivateAt: "2099-01-01T00:00:00.000Z",
      },
    });

    const now = Date.parse("2026-11-26T12:00:00.000Z");
    await repo.clearProviderConnectionFallbackState(indefinite.id, { model: "gpt-5", observedAt: now }, { now });
    await repo.clearProviderConnectionFallbackState(future.id, { model: "gpt-5", observedAt: now }, { now });

    const persistedIndefinite = await repo.getProviderConnectionById(indefinite.id);
    expect(persistedIndefinite.quotaLockout).toMatchObject({ status: "quota_exhausted", source: "manual", reactivateAt: null });
    expect(persistedIndefinite.testStatus).toBe("unavailable");

    const persistedFuture = await repo.getProviderConnectionById(future.id);
    expect(persistedFuture.quotaLockout).toMatchObject({ status: "quota_exhausted", source: "auto", reactivateAt: "2099-01-01T00:00:00.000Z" });
    expect(persistedFuture.testStatus).toBe("unavailable");
  });
});
