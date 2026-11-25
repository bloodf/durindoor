import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("OmniRoute b30854f298215fd336ad291e4487ee6d353c706b session token split", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-token-split-"));
  const oldDir = process.env.DATA_DIR;
  let db, list;
  beforeAll(async () => {
    process.env.DATA_DIR = dir;
    db = await (await import("@/lib/db/driver.js")).getAdapter();
    list = (await import("@/lib/db/repos/usageRepo.js")).listKeyUsageSessions;
    db.run("INSERT INTO usageHistory(timestamp, apiKeyId, usageSessionId, promptTokens, completionTokens, cachedTokens, cacheCreationTokens, reasoningTokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["2026-01-01", "a", "s", 100, 20, 30, 10, 5]);
    db.run("INSERT INTO usageHistory(timestamp, apiKeyId, usageSessionId, promptTokens, completionTokens, cachedTokens, cacheCreationTokens, reasoningTokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["2026-01-02", "a", "s", 5, 2, 7, 3, 1]);
    db.run("INSERT INTO usageHistory(timestamp, apiKeyId, usageSessionId, promptTokens) VALUES (?, ?, ?, ?)", ["2026-01-03", "b", "s", 999]);
  });
  afterAll(() => {
    db?.close(); delete global._dbAdapter;
    if (oldDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("normalizes each legacy row, reconciles the split, and keeps key ownership", async () => {
    expect((await list("a"))[0].tokens).toEqual({ input: 115, uncachedInput: 65, cacheRead: 37, cacheCreation: 13, output: 22, reasoning: 6, total: 137 });
  });
});
