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

async function multiKeyConnection(db) {
  return db.createProviderConnection({
    provider: "openai", authType: "apikey", name: "multi", apiKey: "key-a",
    providerSpecificData: { extraApiKeys: ["key-b"] },
  });
}

it("keeps both per-key verdicts from concurrent outcomes on different keys", async () => {
  const db = await import("@/lib/db/index.js");
  const connection = await multiKeyConnection(db);
  const base = Date.now();
  const fpA = credentialFingerprint("key-a");
  const fpB = credentialFingerprint("key-b");
  const failure = await db.recordProviderConnectionFallbackState(connection.id, {
    model: "m", status: 429, reasonCode: "rate_limited", cooldownMs: 60_000, credentialFingerprint: fpA, observedAt: base + 100,
  });
  expect(failure.applied).toBe(true);
  // Key B's success was dispatched earlier; it cannot clear key A's lock but its own verdict lands.
  const success = await db.clearProviderConnectionFallbackState(connection.id, {
    model: "m", credentialFingerprint: fpB, observedAt: base + 50,
  });
  expect(success.applied).toBe(false);
  expect(success.keyHealthApplied).toBe(true);
  const stored = await db.getProviderConnectionById(connection.id);
  expect(stored.credentialHealth[fpA.slice(0, 16)]).toMatchObject({ status: "unavailable", statusCode: 429 });
  expect(stored.credentialHealth[fpB.slice(0, 16)]).toMatchObject({ status: "healthy" });
  expect(Object.keys(stored).some((k) => k.startsWith("modelLock_") && stored[k])).toBe(true);
  expect(JSON.stringify(stored.credentialHealth)).not.toContain(fpA);
});

it("orders same-millisecond per-key outcomes: failure wins, success never overrides it", async () => {
  const db = await import("@/lib/db/index.js");
  const connection = await multiKeyConnection(db);
  const at = Date.now();
  const fpB = credentialFingerprint("key-b");
  const idB = fpB.slice(0, 16);
  await db.clearProviderConnectionFallbackState(connection.id, { model: "m", credentialFingerprint: fpB, observedAt: at });
  expect((await db.getProviderConnectionById(connection.id)).credentialHealth[idB].status).toBe("healthy");
  const failed = await db.recordProviderConnectionFallbackState(connection.id, {
    model: "m", status: 503, cooldownMs: 60_000, credentialFingerprint: fpB, observedAt: at,
  });
  expect(failed.keyHealthApplied).toBe(true);
  expect((await db.getProviderConnectionById(connection.id)).credentialHealth[idB]).toMatchObject({ status: "unavailable", statusCode: 503 });
  const lateSuccess = await db.clearProviderConnectionFallbackState(connection.id, { model: "m", credentialFingerprint: fpB, observedAt: at });
  expect(lateSuccess.keyHealthApplied).toBeUndefined();
  expect((await db.getProviderConnectionById(connection.id)).credentialHealth[idB].status).toBe("unavailable");
});

it("snapshots only stored credentials; derived tokens stay fail-open", async () => {
  const { credentialDispatchSnapshot } = await import("../../src/shared/utils/credentialFingerprint.js");
  const stored = { apiKey: "k", providerSpecificData: { extraApiKeys: ["x"] } };
  expect(credentialDispatchSnapshot({ apiKey: "x", _connection: stored }, 5)).toEqual({ credentialFingerprint: credentialFingerprint("x"), dispatchedAt: 5 });
  expect(credentialDispatchSnapshot({ accessToken: "exchanged", _connection: stored }, 5).credentialFingerprint).toBeNull();
  expect(credentialDispatchSnapshot({ apiKey: "k" }, 5).credentialFingerprint).toBeNull();
});

const HANDLERS = [
  "chat/singleModel", "embeddings", "fetch", "imageEdit", "imageGeneration", "moderations", "music",
  "rerank", "search", "stt", "systemone", "tts", "video", "codexAlphaSearch",
];
it.each(HANDLERS)("%s handler passes a dispatch snapshot to outcome writes", (name) => {
  const handlerPath = path.resolve(__dirname, `../../src/sse/handlers/${name}.js`);
  const pipelinePath = path.resolve(__dirname, "../../src/sse/handlers/media/pipeline.js");
  const handler = fs.readFileSync(handlerPath, "utf8");
  const migrated = ["tts", "stt", "embeddings", "moderations", "rerank", "imageEdit", "imageGeneration"].includes(name);
  if (migrated) {
    expect(handler).toMatch(/runMediaAccounts\s*\(/);
    expect(handler).toMatch(/return\s*\{\s*result,\s*dispatch\b/);
  }
  const source = handler + (migrated ? fs.readFileSync(pipelinePath, "utf8") : "");
  expect(source).toContain("credentialDispatchSnapshot(");
  const calls = [...source.matchAll(/await (markAccountUnavailable|clearAccountError)\(([\s\S]*?)\);/g)]
    .filter((m) => !m[2].includes("Antigravity credential") && !m[2].includes("lastStatus, lastError"));
  expect(calls.length).toBeGreaterThan(0);
  for (const [, , args] of calls) expect(args).toMatch(/\.\.\.dispatch\b|, dispatch$|dispatchedCredential|accountFailureContext/);
});
