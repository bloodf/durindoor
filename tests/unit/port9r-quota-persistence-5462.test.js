import { afterAll, beforeAll, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const oldDataDir = process.env.DATA_DIR;
let dataDir;
beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-quota-5462-"));
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

it("persists schedules across a database reopen without changing manual disable or model locks", async () => {
  const repo = await import("../../src/lib/db/repos/connectionsRepo.js");
  const created = await repo.createProviderConnection({ provider: "openai", authType: "apikey", name: "quota", apiKey: "synthetic-key", isActive: false });
  const quotaLockout = { status: "quota_exhausted", source: "manual", reactivateAt: null };
  await repo.updateProviderConnection(created.id, { quotaLockout, modelLock_test: "2099-01-01T00:00:00.000Z" });
  global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.resetModules();
  const reopened = await import("../../src/lib/db/repos/connectionsRepo.js");
  const connection = await reopened.getProviderConnectionById(created.id);
  expect(connection.quotaLockout).toEqual(quotaLockout);
  expect(connection.isActive).toBe(false);
  expect(connection.modelLock_test).toBe("2099-01-01T00:00:00.000Z");
  await reopened.updateProviderConnection(created.id, { quotaLockout: null });
  expect((await reopened.getProviderConnectionById(created.id)).quotaLockout).toBeNull();
});
