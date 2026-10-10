import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let directory;
let adapters;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "billing-initialization-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  delete global._dbAdapter;
  vi.resetModules();
  adapters = [];
});
afterEach(async () => {
  await global._dbAdapter?.instance?.close();
  for (const adapter of adapters) await adapter.close();
  delete global._dbAdapter;
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

async function open(file) {
  const { openSqliteAdapter } = await import("../../src/lib/db/driver.js");
  const { runMigrationOnce } = await import("../../src/lib/db/migrate.js");
  const adapter = await openSqliteAdapter(file);
  adapters.push(adapter);
  await runMigrationOnce(adapter);
  return adapter;
}
const completeness = (db) => db.get("SELECT value FROM kv WHERE scope = 'billing' AND key = 'receiptsVersion'")?.value ?? null;

it("initializes exclusive creation before writes, rotates restore epochs, and never re-stamps completeness", async () => {
  const { getAdapter } = await import("../../src/lib/db/driver.js");
  const database = await import("../../src/lib/db/index.js");
  const db = await getAdapter();
  expect(completeness(db)).toBe("1");
  const restored = await database.importDb({ apiKeys: [{ id: "key", key: "sk-initialization" }], usageEventReceiptsVersion: 1, usageEventReceipts: [] });
  expect(restored.billingEpoch).toEqual(expect.any(String));
  const event = { apiKey: "sk-initialization", usageEventId: "first", tokens: { prompt_tokens: 2 }, cost: 0.5, strict: true };
  await expect(database.saveRequestUsage({ ...event, billingEpoch: null })).rejects.toThrow();
  const rejected = await database.exportDb();
  expect(rejected.usageEventReceipts).toEqual(restored.usageEventReceipts);
  expect(rejected.apiKeyUsageTotals).toEqual(restored.apiKeyUsageTotals);
  await database.saveRequestUsage({ ...event, billingEpoch: restored.billingEpoch });
  const snapshot = await database.exportDb();
  expect(snapshot.billingCutoverVersion).toBe(1);
  expect(snapshot.usageEventReceiptsVersion).toBeNull();
  expect(snapshot.apiKeyUsageTotals).toEqual([expect.objectContaining({ apiKeyId: "key", totalTokens: 2, totalCost: 0.5, totalRequests: 1 })]);
  expect(snapshot.usageEventReceipts).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/)]);
  const restoredAgain = await database.importDb(snapshot);
  expect(restoredAgain.billingEpoch).not.toBe(snapshot.billingEpoch);
  const exported = await database.exportDb();
  expect(exported.billingCutoverVersion).toBe(1);
  expect(exported.usageEventReceiptsVersion).toBeNull();
  expect(exported.usageEventReceipts).toEqual(snapshot.usageEventReceipts);
  expect(exported.apiKeyUsageTotals).toEqual(snapshot.apiKeyUsageTotals);
  const { billingEpoch, billingCutoverVersion, usageEventReceiptsVersion, usageEventReceipts, ...legacy } = snapshot;
  const cutover = await database.importDb(legacy);
  expect(cutover.billingEpoch).toEqual(expect.any(String));
  expect(cutover.usageEventReceiptsVersion).toBeNull();
  const next = await database.importDb(cutover);
  expect(next.billingEpoch).not.toBe(cutover.billingEpoch);
  await db.close();
  delete global._dbAdapter;
  vi.resetModules();
  const reopened = await import("../../src/lib/db/driver.js");
  expect(completeness(await reopened.getAdapter())).toBeNull();
});

it("creates private missing parents and preserves fresh database provenance", async () => {
  const parent = path.join(directory, "nested", "db");
  const file = path.join(parent, "data.sqlite");
  expect(completeness(await open(file))).toBe("1");
  if (process.platform !== "win32") {
    expect(fs.statSync(parent).mode & 0o777).toBe(0o700);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  }
});

it("preserves fresh initialization after an absent settings probe", async () => {
  const { readPostgresUrlFromSettings } = await import("../../src/lib/db/secrets.js");
  const parent = path.join(directory, "db");
  expect(await readPostgresUrlFromSettings()).toBeNull();
  expect(fs.existsSync(parent)).toBe(false);
  expect(completeness(await open(path.join(parent, "data.sqlite")))).toBe("1");
});

it.each(["empty-file", "empty-meta", "legacy-table"])("does not promote an existing %s", async (kind) => {
  const file = path.join(directory, "existing.sqlite");
  fs.writeFileSync(file, "");
  if (kind !== "empty-file") {
    const { createBetterSqliteAdapter } = await import("../../src/lib/db/adapters/betterSqliteAdapter.js");
    const seed = createBetterSqliteAdapter(file);
    seed.exec(kind === "empty-meta" ? "CREATE TABLE _meta(key TEXT PRIMARY KEY, value TEXT)" : "CREATE TABLE legacy(id INTEGER)");
    seed.close();
  }
  expect(completeness(await open(file))).toBeNull();
});

it("does not promote a new SQLite file with legacy JSON provenance", async () => {
  fs.writeFileSync(path.join(directory, "db.json"), "{}");
  expect(completeness(await open(path.join(directory, "legacy.sqlite")))).toBeNull();
});

it("does not reuse creation evidence after a later opener initializes the file", async () => {
  const { openSqliteAdapter } = await import("../../src/lib/db/driver.js");
  const { runMigrationOnce } = await import("../../src/lib/db/migrate.js");
  const file = path.join(directory, "racing.sqlite");
  const creator = await openSqliteAdapter(file);
  adapters.push(creator);
  const follower = await open(file);
  expect(completeness(follower)).toBeNull();
  await runMigrationOnce(creator);
  expect(completeness(creator)).toBeNull();
});
