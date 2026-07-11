import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCommittedTokenCount } from "../../src/lib/db/helpers/committedTokens.js";

describe("API-key committed token accounting", () => {
  it.each([
    [{ total_tokens: 20, prompt_tokens: 10, completion_tokens: 7, reasoning_tokens: 3 }, 20],
    [{ prompt_tokens: 10, completion_tokens: 7, reasoning_tokens: 3 }, 17],
    [{ prompt_tokens: 10, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 3 } }, 17],
    [{ input_tokens: 5, output_tokens: 4, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 }, 14],
    [{ promptTokenCount: 5, candidatesTokenCount: 4, thoughtsTokenCount: 3 }, 12],
    [{ prompt_tokens: 10, reasoning_tokens: 3 }, 13],
  ])("counts canonical components once for %#", (usage, expected) => {
    expect(getCommittedTokenCount(usage)).toBe(expected);
  });

  it("backfills missing rows once and never overwrites newer durable totals", async () => {
    const previous = process.env.DATA_DIR;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-token-backfill-"));
    process.env.DATA_DIR = tempDir;
    delete global._dbAdapter;
    vi.resetModules();
    try {
      const database = await import("@/lib/db/index.js");
      const { getAdapter } = await import("@/lib/db/driver.js");
      const { backfillApiKeyUsageTotals } = await import("@/lib/db/helpers/apiKeyUsageTotals.js");
      const db = await getAdapter();
      const secret = "sk-deadbeef";
      db.run(
        `INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES('key-1', ?, 'Key', 1, '[]', ?)`,
        [secret, "2026-01-01T00:00:00.000Z"],
      );
      db.run(`DELETE FROM apiKeyUsageTotals WHERE apiKeyId = 'key-1'`);
      db.run(
        `INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status, tokens, meta)
         VALUES(?, 'openai', 'gpt', ?, 10, 7, 0.5, 'ok', ?, '{}')`,
        ["2026-01-02T00:00:00.000Z", secret, JSON.stringify({ prompt_tokens: 10, completion_tokens: 7, reasoning_tokens: 3 })],
      );

      backfillApiKeyUsageTotals(db);
      expect(await database.getApiKeyUsageTotals("key-1")).toMatchObject({ totalTokens: 17, totalCost: 0.5, totalRequests: 1 });
      database.incrementApiKeyUsageSync(db, "key-1", { tokens: 4, cost: 0.25 });
      backfillApiKeyUsageTotals(db);
      expect(await database.getApiKeyUsageTotals("key-1")).toMatchObject({ totalTokens: 21, totalCost: 0.75, totalRequests: 2 });
      backfillApiKeyUsageTotals(db, { overwrite: true });
      expect(await database.getApiKeyUsageTotals("key-1")).toMatchObject({ totalTokens: 17, totalCost: 0.5, totalRequests: 1 });
      expect(db.get(`SELECT key FROM apiKeys WHERE id='key-1'`).key).toBe(secret);
    } finally {
      try { global._dbAdapter?.instance?.close?.(); } catch {}
      delete global._dbAdapter;
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
