import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date(2026, 6, 10, 12, 0, 0, 0);
let originalDataDir;
let tempDir;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-usage-stats-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe.each(["today", "24h"])("%s usage stats token fallback", (period) => {
  it("counts alternate JSON fields, normalized columns, and ordinary OpenAI usage", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { getUsageStats } = await import("@/lib/db/repos/usageRepo.js");
    const db = await getAdapter();
    const insert = (timestamp, model, promptTokens, completionTokens, tokens) => db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES(?, 'openai', ?, ?, ?, 0, 'ok', ?, '{}')`,
      [timestamp, model, promptTokens, completionTokens, JSON.stringify(tokens)],
    );

    insert(NOW.toISOString(), "alternate", 123, 45, { input_tokens: 123, output_tokens: 45 });
    insert(new Date(NOW.getTime() - 60_000).toISOString(), "normalized", 67, 8, {});
    insert(new Date(NOW.getTime() - 120_000).toISOString(), "ordinary", 11, 3, {
      prompt_tokens: 11,
      completion_tokens: 3,
    });

    const stats = await getUsageStats(period);

    expect(stats).toMatchObject({
      totalRequests: 3,
      totalPromptTokens: 201,
      totalCompletionTokens: 56,
    });
    expect(stats.byProvider.openai).toMatchObject({
      requests: 3,
      promptTokens: 201,
      completionTokens: 56,
    });
  });
});
