import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { credentialFingerprint } from "../../src/shared/utils/credentialFingerprint.js";

let dir;
let oldHome;
let oldDataDir;
beforeEach(() => {
  oldHome = process.env.HOME;
  oldDataDir = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-credential-health-"));
  process.env.HOME = dir;
  process.env.DATA_DIR = path.join(dir, "data");
  delete global._dbAdapter;
  vi.resetModules();
});
afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

it("rejects old outcomes after a credential replacement", async () => {
  const db = await import("@/lib/db/index.js");
  const connection = await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "test", apiKey: "old-secret" });
  const oldFingerprint = credentialFingerprint("old-secret");
  await db.updateProviderConnection(connection.id, { apiKey: "new-secret" });
  const observedAt = Date.now();
  const failure = await db.recordProviderConnectionFallbackState(connection.id, {
    model: "test-model", status: 401, cooldownMs: 1000, credentialFingerprint: oldFingerprint, observedAt,
  });
  expect(failure.applied).toBe(false);
  const success = await db.clearProviderConnectionFallbackState(connection.id, {
    model: "test-model", credentialFingerprint: oldFingerprint, observedAt,
  });
  expect(success.applied).toBe(false);
  const stored = await db.getProviderConnectionById(connection.id);
  expect(stored.apiKey).toBe("new-secret");
  expect(JSON.stringify(stored)).not.toContain(oldFingerprint);
});
