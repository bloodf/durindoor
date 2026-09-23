import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let limits;
let policyHelper;
let policyInput;

async function insertUsage(apiKey, { tokens = 0, output = 0, cost = 0, timestamp = new Date().toISOString() } = {}) {
  const adapter = await db.getAdapter();
  adapter.run(
    `INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status) VALUES(?, 'openai', 'gpt-test', ?, ?, ?, ?, 'ok')`,
    [timestamp, apiKey, tokens, output, cost]
  );
  // Same signal saveRequestUsage emits: drops the cached window totals.
  db.statsEmitter.emit("apiKeyUsage", apiKey);
}

async function keyWithPolicy(name, policy, extra = {}) {
  const created = await db.createApiKey(name, "machine-1", [], extra.dailyLimitTokens ?? null, null, { policy });
  return db.getApiKeyByKey(created.key);
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-api-key-limits-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  vi.resetModules();
  const dbIndex = await import("@/lib/db/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  db = { ...dbIndex, getAdapter };
  limits = await import("@/lib/apiKeyLimits.js");
  policyHelper = await import("@/lib/db/helpers/apiKeyPolicy.js");
  policyInput = await import("@/shared/utils/apiKeyPolicyManagement.js");
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  delete global._dbAdapter;
  delete global._apiKeyLimitState;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("API key limit policy fields", () => {
  it("drops empty and zero limits and rejects malformed ones", () => {
    const normalized = policyHelper.normalizeApiKeyPolicy({ rpmLimit: "10", monthlyBudget: "2.5", monthlyTokenLimit: 0, dailyInputTokenLimit: "" });
    expect(normalized).toEqual({ rpmLimit: 10, monthlyBudget: 2.5 });
    expect(() => policyHelper.normalizeApiKeyPolicy({ rpmLimit: 1.5 })).toThrow(/rpmLimit must be a non-negative integer/);
    expect(() => policyHelper.normalizeApiKeyPolicy({ monthlyBudget: -1 })).toThrow(/monthlyBudget/);
    expect(() => policyHelper.normalizeApiKeyPolicy({ monthlyRequestLimit: "abc" })).toThrow(/monthlyRequestLimit/);
  });

  it("patches limits from top-level request fields without touching the rest of the policy", async () => {
    const key = await keyWithPolicy("patch", { allowedModels: [], maxTokens: 500, modelAccess: { mode: "deny", patterns: ["openai/*"] } });
    const input = await policyInput.resolveApiKeyPolicyInput({ rpmLimit: 5, monthlyBudget: 3 });
    const updated = await db.updateApiKey(key.id, { policyPatch: input.patch });
    expect(updated.policy).toMatchObject({ maxTokens: 500, rpmLimit: 5, monthlyBudget: 3, modelAccess: { mode: "deny", patterns: ["openai/*"] } });

    const cleared = await db.updateApiKey(key.id, { policyPatch: (await policyInput.resolveApiKeyPolicyInput({ rpmLimit: null })).patch });
    expect(cleared.policy.rpmLimit).toBeUndefined();
    expect(cleared.policy.monthlyBudget).toBe(3);
  });
});

describe("API key windowed limits", () => {
  it("allows keys without limits", async () => {
    expect(await limits.checkApiKeyLimits(null)).toBeNull();
    const key = await keyWithPolicy("unlimited", null);
    for (let i = 0; i < 20; i++) expect(await limits.checkApiKeyLimits(key)).toBeNull();
  });

  it("enforces requests per minute with a 429 and Retry-After", async () => {
    const key = await keyWithPolicy("rpm", { rpmLimit: 3 });
    for (let i = 0; i < 3; i++) expect(await limits.enforceApiKeyLimits(null, key)).toBeNull();

    const res = await limits.enforceApiKeyLimits(null, key);
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect((await res.json()).error.message).toMatch(/3 requests\/minute/);
  });

  it("checks and counts one request once, however many models it resolves", async () => {
    const key = await keyWithPolicy("rpm-once", { rpmLimit: 1 });
    const request = new Request("http://localhost/v1/chat/completions");
    expect(await limits.enforceApiKeyLimits(request, key)).toBeNull();
    // Combo members and vision reroutes re-enter with the same Request.
    expect(await limits.enforceApiKeyLimits(request, key)).toBeNull();
    const next = await limits.enforceApiKeyLimits(new Request("http://localhost/v1/chat/completions"), key);
    expect(next.status).toBe(429);
  });

  it("enforces tokens per minute from recorded usage", async () => {
    const key = await keyWithPolicy("tpm", { tpmLimit: 1000 });
    await db.saveRequestUsage({ provider: "openai", model: "gpt-test", apiKey: key.key, tokens: { prompt_tokens: 600, completion_tokens: 300 } });
    expect(await limits.checkApiKeyLimits(key)).toBeNull();

    await db.saveRequestUsage({ provider: "openai", model: "gpt-test", apiKey: key.key, tokens: { prompt_tokens: 100 } });
    const blocked = await limits.checkApiKeyLimits(key);
    expect(blocked.message).toMatch(/1,000\/1,000 tokens\/minute/);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfter).toBeLessThanOrEqual(60);

    const status = await limits.getApiKeyLimitStatus(key);
    expect(status.tpm).toEqual({ used: 1000, limit: 1000 });
    // A minute later the window is empty again.
    expect(await limits.checkApiKeyLimits(key, new Date(Date.now() + 61_000))).toBeNull();
  });

  it("enforces the monthly budget", async () => {
    const key = await keyWithPolicy("budget", { monthlyBudget: 2 });
    await insertUsage(key.key, { cost: 1.5 });
    expect(await limits.checkApiKeyLimits(key)).toBeNull();
    await insertUsage(key.key, { cost: 0.5 });
    expect((await limits.checkApiKeyLimits(key)).message).toMatch(/monthly budget limit reached/);
  });

  it("enforces daily input and monthly output token limits and ignores older days", async () => {
    const key = await keyWithPolicy("in-out", { dailyInputTokenLimit: 100, monthlyOutputTokenLimit: 50 });
    const twoMonthsAgo = new Date(Date.now() - 62 * 24 * 3600 * 1000).toISOString();
    await insertUsage(key.key, { tokens: 5000, output: 5000, timestamp: twoMonthsAgo });
    await insertUsage(key.key, { tokens: 60, output: 49 });
    expect(await limits.checkApiKeyLimits(key)).toBeNull();

    await insertUsage(key.key, { output: 1 });
    expect((await limits.checkApiKeyLimits(key)).message).toMatch(/monthly output tokens limit/);

    await insertUsage(key.key, { tokens: 40 });
    const inputOnly = { ...key, policy: { dailyInputTokenLimit: 100 } };
    const blocked = await limits.checkApiKeyLimits(inputOnly);
    expect(blocked.message).toMatch(/daily input tokens limit/);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("enforces the monthly request limit", async () => {
    const key = await keyWithPolicy("requests", { monthlyRequestLimit: 2 });
    await insertUsage(key.key);
    expect(await limits.checkApiKeyLimits(key)).toBeNull();
    await insertUsage(key.key);
    expect((await limits.checkApiKeyLimits(key)).message).toMatch(/monthly requests limit/);
  });

  it("reports usage against limits for the dashboard, including the daily token column", async () => {
    const key = await keyWithPolicy("status", { rpmLimit: 10, monthlyBudget: 3 }, { dailyLimitTokens: 500 });
    await insertUsage(key.key, { tokens: 120, cost: 0.25 });
    await limits.checkApiKeyLimits(key);

    const status = await limits.getApiKeyLimitStatus(key);
    const byField = Object.fromEntries(status.limits.map((l) => [l.field, l]));
    expect(status.rpm).toEqual({ used: 1, limit: 10 });
    expect(byField.dailyLimitTokens).toMatchObject({ used: 120, limit: 500, always: true });
    expect(byField.monthlyBudget.used).toBeCloseTo(0.25);
    expect(byField.monthlyBudget).toMatchObject({ limit: 3, money: true });
    expect(byField.monthlyInputTokenLimit).toMatchObject({ used: 120, limit: null, always: false });
    expect(status.today.requests).toBe(1);
  });

  it("leaves the daily total to the existing dailyLimitTokens check", async () => {
    const key = await keyWithPolicy("daily-column", null, { dailyLimitTokens: 10 });
    await insertUsage(key.key, { tokens: 50 });
    expect(await limits.checkApiKeyLimits(key)).toBeNull();
  });
});

describe("GET /api/keys/usage", () => {
  it("returns every key, or one key with ?apiKeyId", async () => {
    const { GET } = await import("../../src/app/api/keys/usage/route.js");
    const key = await keyWithPolicy("route", { tpmLimit: 50 });

    const all = await (await GET(new Request("http://localhost/api/keys/usage"))).json();
    expect(all.usage[key.id].tpm).toEqual({ used: 0, limit: 50 });

    const one = await (await GET(new Request(`http://localhost/api/keys/usage?apiKeyId=${key.id}`))).json();
    expect(Object.keys(one.usage)).toEqual([key.id]);

    expect((await GET(new Request("http://localhost/api/keys/usage?apiKeyId=missing"))).status).toBe(404);
  });
});
