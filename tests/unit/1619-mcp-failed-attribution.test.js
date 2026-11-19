import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

const original = Object.fromEntries(["DATA_DIR", "DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL"].map((name) => [name, process.env[name]]));
let directory;
let adapter;
let database;
let key;
let gatewayKey;

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-1619-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete process.env.DURINDOOR_PG_URL;
  delete global._dbAdapter;
  database = await import("@/lib/db/index.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  gatewayKey = await database.createGatewayKey("Issue 1619", "mcp-1619-machine");
  key = gatewayKey.key;
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES('mcp-1619-policy-key', ?, 'Policy fixture', 1, '[]', ?)", [key, new Date().toISOString()]);
  await database.createInstance({ id: "mcp-1619-instance", slug: "fixture", title: "Fixture", kind: "custom", transport: "http" });
  await database.setGrants(gatewayKey.id, ["mcp-1619-instance"], [["echo"]]);
}, 60_000);

beforeEach(async () => {
  await database.resetUsageHistory("all");
  adapter.run("DELETE FROM apiKeyUsageTotals");
});

afterAll(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(directory, { recursive: true, force: true });
});

it("keeps failed MCP calls in their gateway-key view without charging key limits or totals", async () => {
  await database.saveRequestUsage({
    provider: "mcp-gateway", model: "fixture__echo", apiKey: key,
    status: "error", tokens: {}, cost: 0, costStatus: "known", costSource: "mcp-gateway",
  });

  expect(adapter.all("SELECT apiKey, status FROM usageHistory")).toEqual([{ apiKey: key, status: "error" }]);
  const stats = await database.getUsageStats("all");
  expect(Object.values(stats.byApiKey)).toEqual([expect.objectContaining({
    apiKeyKey: `mcp-gateway-key:${gatewayKey.id}`,
    keyName: "Issue 1619",
    requests: 1,
  })]);
  expect(JSON.stringify(stats)).not.toContain(key);

  const totals = await database.getApiKeyWindowUsageTotals(key, "2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z");
  expect(totals.day).toEqual({ inputTokens: 0, outputTokens: 0, requests: 0, cost: 0, unknownCostRequests: 0 });
  expect(totals.month).toMatchObject({ requests: 0, cost: 0, unknownCostRequests: 0 });
  expect(await database.getApiKeyUsageTotals("mcp-1619-policy-key")).toMatchObject({ totalRequests: 0, totalTokens: 0, totalCost: 0 });
});
