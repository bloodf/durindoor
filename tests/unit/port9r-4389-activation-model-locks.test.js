import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";
const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let sequence = 0;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-4389-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
}, 30000);

afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function lockedConnection() {
  sequence += 1;
  const identity = { provider: `locks-${sequence}`, authType: "apikey", name: "locked", apiKey: "key-one" };
  const { id } = await db.createProviderConnection(identity);
  await db.updateProviderConnection(id, {
    testStatus: "unavailable", modelLock_retired: FUTURE, modelLock___all: FUTURE, modelLock_expired: PAST, modelLock_broken: "not-a-date",
  });
  return { id, identity };
}

const kept = { modelLock_retired: FUTURE, modelLock___all: FUTURE, modelLock_expired: null, modelLock_broken: null };
const cleared = { modelLock_retired: null, modelLock___all: null, modelLock_expired: null, modelLock_broken: null };

describe("upstream #4389 - activation keeps active model locks", () => {
  it("clears only expired or unreadable locks when a check or token refresh marks the row active", async () => {
    const { id } = await lockedConnection();
    await db.updateProviderConnection(id, { testStatus: "active", accessToken: "refreshed" });
    expect(await db.getProviderConnectionById(id)).toMatchObject({ testStatus: "active", backoffLevel: 0, ...kept });
  });

  it("keeps locks when the patch repeats the stored API key", async () => {
    const { id } = await lockedConnection();
    await db.updateProviderConnection(id, { testStatus: "active", apiKey: "key-one" });
    expect(await db.getProviderConnectionById(id)).toMatchObject(kept);
  });

  it("lets an explicit null in the patch clear an active lock", async () => {
    const { id } = await lockedConnection();
    await db.updateProviderConnection(id, { testStatus: "active", modelLock_retired: null });
    expect(await db.getProviderConnectionById(id)).toMatchObject({ modelLock_retired: null, modelLock___all: FUTURE });
  });

  it("clears every lock when the API key is replaced", async () => {
    const { id } = await lockedConnection();
    await db.updateProviderConnection(id, { testStatus: "active", apiKey: "key-two" });
    expect(await db.getProviderConnectionById(id)).toMatchObject(cleared);
  });

  it("clears every lock when the caller declares a credential replacement", async () => {
    const { id } = await lockedConnection();
    await db.updateProviderConnection(id, { testStatus: "active", accessToken: "reconnected" }, { replacesCredential: true });
    expect(await db.getProviderConnectionById(id)).toMatchObject(cleared);
  });

  it("clears every lock when the same credential identity is saved again", async () => {
    const { id, identity } = await lockedConnection();
    await db.createProviderConnection({ ...identity, apiKey: "key-one", testStatus: "active" });
    expect(await db.getProviderConnectionById(id)).toMatchObject(cleared);
  });
});
