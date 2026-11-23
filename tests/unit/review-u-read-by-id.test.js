import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiKey = "sk-u-read-by-id-fixture";
const apiKeyId = "u-read-by-id-key";
const day = "2026-11-23T00:00:00.000Z";
let dir;
let previousDataDir;
let db;
let repo;

beforeEach(async () => {
  previousDataDir = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-u-read-by-id-"));
  process.env.DATA_DIR = dir;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete process.env.DURINDOOR_PG_URL;
  delete global._dbAdapter;
  vi.resetModules();
  await import("@/lib/db/index.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  repo = await import("@/lib/db/repos/usageRepo.js");
  db.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)",
    [apiKeyId, apiKey, "usage lookup fixture", day]);
});

afterEach(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch { /* already closed */ }
  delete global._dbAdapter;
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

function insert({ id, key = apiKey, tokens, cost, offset }) {
  db.run(`INSERT INTO usageHistory(timestamp, provider, model, apiKey, apiKeyId, promptTokens,
    completionTokens, cost, status, tokens, meta) VALUES(?, 'fixture', 'model', ?, ?, ?, ?, ?, 'ok', '{}', '{}')`,
  [`2026-11-23T00:0${offset}:00.000Z`, key, id, tokens, 0, cost]);
}

async function totals() {
  return repo.getApiKeyWindowUsageTotals(apiKey, day, "2026-11-01T00:00:00.000Z", apiKeyId);
}

describe("usage lookup by stable API key id", () => {
  it("keeps totals identical for id-backed, legacy raw-key, and mixed rows", async () => {
    insert({ id: apiKeyId, key: "rotated-secret", tokens: 11, cost: 0.25, offset: 1 });
    expect(await totals()).toMatchObject({ day: { inputTokens: 11, requests: 1, cost: 0.25 }, month: { inputTokens: 11, requests: 1, cost: 0.25 } });

    insert({ id: null, tokens: 7, cost: 0.5, offset: 2 });
    expect(await totals()).toMatchObject({ day: { inputTokens: 18, requests: 2, cost: 0.75 }, month: { inputTokens: 18, requests: 2, cost: 0.75 } });

    insert({ id: "another-key-id", tokens: 1000, cost: 10, offset: 3 });
    expect(await totals()).toMatchObject({ day: { inputTokens: 18, requests: 2, cost: 0.75 }, month: { inputTokens: 18, requests: 2, cost: 0.75 } });
  });
});
