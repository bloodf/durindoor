import { afterAll, beforeAll, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const oldDataDir = process.env.DATA_DIR;
let dataDir;
beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-mimo-2576-"));
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

it("clears old MiMo model locks when a session credential changes", async () => {
  const repo = await import("../../src/lib/db/repos/connectionsRepo.js");
  const created = await repo.createProviderConnection({ provider: "xiaomi-mimo", authType: "apikey", name: "MiMo", providerSpecificData: { mimoPassToken: "old-token" } });
  const lock = "2099-01-01T00:00:00.000Z";
  await repo.updateProviderConnection(created.id, { modelLock_test: lock, modelLock___all: lock });
  await repo.updateProviderConnection(created.id, { testStatus: "active", providerSpecificData: { mimoPassToken: "old-token" } });
  expect((await repo.getProviderConnectionById(created.id)).modelLock_test).toBe(lock);
  await repo.updateProviderConnection(created.id, { testStatus: "active", providerSpecificData: { mimoPassToken: "new-token" } });
  const updated = await repo.getProviderConnectionById(created.id);
  expect(updated.modelLock_test).toBeNull();
  expect(updated.modelLock___all).toBeNull();
  expect(updated.providerSpecificData.mimoPassToken).toBe("new-token");
});
