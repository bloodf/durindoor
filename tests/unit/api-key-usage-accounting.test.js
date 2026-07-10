// Chat usage and the lifetime policy counter must commit atomically. Replayed
// duplicate usage records must not increment the policy counter twice.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
let originalDataDir;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-policy-usage-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("API-key lifetime usage accounting", () => {
  it("increments once with each newly inserted chat usage record", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const secret = "sk-deadbeef";
    db.run(
      `INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)`,
      ["key-1", secret, "Policy key", "2026-01-01T00:00:00.000Z"],
    );
    const entry = {
      timestamp: "2026-01-02T00:00:00.000Z",
      provider: "openai",
      model: "gpt-test",
      apiKey: secret,
      tokens: { prompt_tokens: 11, completion_tokens: 7 },
      status: "ok",
    };

    await database.saveRequestUsage({ ...entry });
    await database.saveRequestUsage({ ...entry });
    await database.saveRequestUsage({
      ...entry,
      timestamp: "2026-01-02T00:00:01.000Z",
      tokens: { prompt_tokens: 2, completion_tokens: 3 },
    });

    expect(await database.getApiKeyUsageTotals("key-1")).toMatchObject({
      totalTokens: 23,
      totalCost: 0,
      totalRequests: 2,
    });
    expect(db.get(`SELECT COUNT(*) AS count FROM usageHistory WHERE apiKey = ?`, [secret]).count).toBe(2);
    expect(db.get(`SELECT key FROM apiKeys WHERE id = 'key-1'`).key).toBe(secret);
  });
});
