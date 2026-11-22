import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

// #2268: dailyLimitTokens was enforced only by the chat/native admission. The
// shared admission (enforceApiKeyModelPolicy -> enforceApiKeyLimits) now
// applies the same cap to every billable route.
const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let policy;
let limits;

async function insertUsage(apiKey, tokens) {
  const adapter = await db.getAdapter();
  adapter.run(
    `INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status) VALUES(?, 'openai', 'gpt-test', ?, ?, 0, 0, 'ok')`,
    [new Date().toISOString(), apiKey, tokens]
  );
  db.statsEmitter.emit("apiKeyUsage", apiKey);
}

async function makeKey(name, dailyLimitTokens, policyValue = null) {
  const created = await db.createApiKey(name, "machine-1", [], dailyLimitTokens, null, policyValue ? { policy: policyValue } : {});
  return db.getApiKeyByKey(created.key);
}

const request = () => new Request("http://localhost/v1/embeddings");

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-daily-cap-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  const dbIndex = await import("@/lib/db/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  db = { ...dbIndex, getAdapter };
  policy = await import("@/sse/services/apiKeyPolicy.js");
  limits = await import("@/lib/apiKeyLimits.js");
});

afterAll(async () => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("dailyLimitTokens in shared admission", () => {
  const models = [
    "openai/text-embedding-3-small", "openai/dall-e-3", "openai/tts-1", "openai/whisper-1", "cohere/rerank-v3",
    "openai/omni-moderation-latest", "suno/music", "runway/video", "tavily/search", "firecrawl/fetch", "gemini/gemini-tts",
  ];

  it.each(models)("returns 429 for %s once the cap is reached", async (model) => {
    const key = await makeKey(`cap-${model}`, 100);
    await insertUsage(key.key, 100);
    const response = await policy.enforceApiKeyModelPolicy(request(), model, key.key);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await response.json()).error.message).toMatch(/daily token limit exceeded \(100\/100 tokens\)/);
  });

  it("allows requests below the cap and keys without a cap", async () => {
    const capped = await makeKey("below", 100);
    await insertUsage(capped.key, 99);
    expect(await policy.enforceApiKeyModelPolicy(request(), "openai/tts-1", capped.key)).toBeNull();
    const open = await makeKey("open", null);
    await insertUsage(open.key, 1_000_000);
    expect(await policy.enforceApiKeyModelPolicy(request(), "openai/tts-1", open.key)).toBeNull();
  });

  it("does not apply the cap to polling checks that skip limits", async () => {
    const key = await makeKey("poll", 10);
    await insertUsage(key.key, 10);
    expect(await policy.enforceApiKeyModelPolicy(request(), "suno/music", key.key, { limits: false })).toBeNull();
  });

  it("checks a batch row by the admitted key id", async () => {
    const key = await makeKey("batch", 5);
    await insertUsage(key.key, 5);
    const response = await limits.enforceApiKeyLimits(request(), { id: key.id, key: key.key, dailyLimitTokens: 5, policy: {} });
    expect(response.status).toBe(429);
  });

  it("does not count a rejected or repeated check toward RPM on the same request", async () => {
    const key = await makeKey("rpm", 100, { rpmLimit: 2 });
    const req = request();
    expect(await limits.enforceApiKeyLimits(req, key)).toBeNull();
    expect(await limits.enforceApiKeyLimits(req, key)).toBeNull();
    expect(await limits.enforceApiKeyLimits(req, key)).toBeNull();
    expect((await limits.getApiKeyLimitStatus(key)).rpm.used).toBe(1);
  });
});
