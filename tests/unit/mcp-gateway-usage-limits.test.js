import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

// #1085: real handler, ledger and limit check. A failed tool call must not use up
// the key's limits, and a tool call is never an unpriced LLM request. #1619:
// failures must keep their originating key in history and the by-key view.
const state = vi.hoisted(() => ({ dispatch: vi.fn(), writes: [] }));
vi.mock("../../src/lib/mcp/gateway/aggregator", () => ({ dispatchToolCall: (...args) => state.dispatch(...args) }));
vi.mock("@/lib/localDb", async () => {
  const database = await import("@/lib/db/index.js");
  return {
    ...database,
    saveRequestUsage(entry) {
      const write = database.saveRequestUsage(entry);
      state.writes.push(write);
      return write;
    },
  };
});

let KEY; let gatewayKey;
const RECORD = { key: null, policy: { monthlyRequestLimit: 2 } };
const original = Object.fromEntries(["DATA_DIR", "DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL"].map((name) => [name, process.env[name]]));
let directory; let adapter; let database; let handleJsonRpc; let checkApiKeyLimits;

async function call(key = KEY) {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tools__echo", arguments: {} } };
  const request = new Request("http://localhost/api/mcp-gateway", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  const response = await handleJsonRpc(request, body);
  await Promise.all(state.writes.splice(0));
  return response;
}
const rows = () => adapter.all("SELECT apiKey, status, cost, meta FROM usageHistory ORDER BY id");
const failures = [
  ["a thrown tool error", () => state.dispatch.mockRejectedValue(new Error("upstream down"))],
  ["an isError tool result", () => state.dispatch.mockResolvedValue({ result: { content: [{ type: "text", text: "nope" }], isError: true } })],
  ["a coded tool error", () => state.dispatch.mockRejectedValue(Object.assign(new Error("denied"), { code: -32602 }))],
];

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-usage-limits-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete process.env.DURINDOOR_PG_URL;
  delete global._dbAdapter;
  database = await import("@/lib/db/index.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  gatewayKey = await database.createGatewayKey("MCP limits", "mcp-fixture-machine");
  KEY = gatewayKey.key;
  RECORD.key = KEY;
  await database.createInstance({ id: "instance-1", slug: "tools", title: "Fixture tools", kind: "custom", transport: "http" });
  await database.setGrants(gatewayKey.id, ["instance-1"], [["echo"]]);
  // Deliberately share this secret with a separate API-key policy fixture so
  // these checks exercise actual counters. MCP identity must use the gateway's
  // configured name and ID, never this policy fixture's distinct name and ID.
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES('mcp-key', ?, 'Policy counter fixture', 1, '[]', ?)", [KEY, new Date().toISOString()]);
  ({ handleJsonRpc } = await import("../../src/lib/mcp/gateway/handler.js"));
  ({ checkApiKeyLimits } = await import("@/lib/apiKeyLimits.js"));
}, 60_000);

beforeEach(async () => {
  state.dispatch.mockReset();
  await database.resetUsageHistory("all");
  adapter.run("DELETE FROM apiKeyUsageTotals");
});

afterAll(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  for (const [name, value] of Object.entries(original)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  fs.rmSync(directory, { recursive: true, force: true });
});

it.each(failures)("%s keeps its error row but uses none of the key's limits", async (_name, arrange) => {
  arrange();
  for (let i = 0; i < 2; i++) await call();
  expect(rows().map((row) => [row.apiKey, row.status])).toEqual([[KEY, "error"], [KEY, "error"]]);
  expect(await checkApiKeyLimits(RECORD)).toBeNull();
  expect(await database.getApiKeyUsageTotals("mcp-key")).toMatchObject({ totalRequests: 0, totalTokens: 0, totalCost: 0, unknownCostRequests: 0 });
  const window = await database.getApiKeyWindowUsageTotals(KEY, new Date(0).toISOString(), new Date(0).toISOString());
  expect(window.day).toMatchObject({ requests: 0, cost: 0, unknownCostRequests: 0 });
  expect(window.month).toMatchObject({ requests: 0, cost: 0, unknownCostRequests: 0 });
  // Cover both daily rollups and the direct history path used for today's view.
  for (const period of ["all", "today"]) {
    const stats = await database.getUsageStats(period);
    expect(stats.totalRequests).toBe(2);
    expect(Object.values(stats.byApiKey)).toEqual([expect.objectContaining({
      apiKeyKey: `mcp-gateway-key:${gatewayKey.id}`, keyName: "MCP limits", apiKeyMasked: "***", requests: 2,
    })]);
    expect(JSON.stringify(stats)).not.toContain(KEY);
    expect(Object.values(stats.byAccount)).toEqual([expect.objectContaining({ requests: 2 })]);
  }
});

it("successful calls still count toward the key's request limit", async () => {
  state.dispatch.mockResolvedValue({ result: { content: [], isError: false } });
  expect(await checkApiKeyLimits(RECORD)).toBeNull();
  for (let i = 0; i < 2; i++) await call();
  expect(rows().map((row) => [row.apiKey, row.status])).toEqual([[KEY, "ok"], [KEY, "ok"]]);
  expect((await checkApiKeyLimits(RECORD))?.message || "").toContain("monthly requests limit reached");
  expect(await database.getApiKeyUsageTotals("mcp-key")).toMatchObject({ totalRequests: 2 });
});

it("counts only successful calls for a key with mixed results", async () => {
  state.dispatch.mockRejectedValue(new Error("upstream down"));
  await call();
  state.dispatch.mockResolvedValue({ result: { content: [], isError: false } });
  await call();
  expect(await checkApiKeyLimits(RECORD)).toBeNull();
  expect(await database.getApiKeyUsageTotals("mcp-key")).toMatchObject({ totalRequests: 1 });
  await call();
  expect((await checkApiKeyLimits(RECORD))?.message || "").toContain("monthly requests limit reached");
  const stats = await database.getUsageStats("all");
  expect(Object.values(stats.byApiKey)).toEqual([expect.objectContaining({ apiKeyKey: `mcp-gateway-key:${gatewayKey.id}`, requests: 3 })]);
});

it.each(failures)("%s identifies a real gateway-only key through auth and grants", async (_name, arrange) => {
  const gateway = await database.createGatewayKey("Gateway only", "mcp-fixture-machine");
  await database.setGrants(gateway.id, ["instance-1"], [["echo"]]);
  expect(adapter.get("SELECT id FROM apiKeys WHERE key = ?", [gateway.key])).toBeUndefined();
  arrange();
  const response = await call(gateway.key);
  expect(response.status).toBe(200);
  expect(state.dispatch).toHaveBeenCalledWith(
    [expect.objectContaining({ id: "instance-1", slug: "tools" })],
    [{ instanceId: "instance-1", slug: "tools", toolAllowlist: ["echo"] }],
    "tools__echo", {},
  );
  expect(rows()).toEqual([expect.objectContaining({ apiKey: gateway.key, status: "error" })]);
  for (const period of ["all", "today", "24h"]) {
    const stats = await database.getUsageStats(period);
    expect(Object.values(stats.byApiKey)).toEqual([expect.objectContaining({
      apiKeyKey: `mcp-gateway-key:${gateway.id}`, keyName: "Gateway only", requests: 1, apiKeyMasked: "***",
    })]);
    expect(stats.totalRequests).toBe(1);
    expect(JSON.stringify(stats)).not.toContain(gateway.key);
  }
  await database.setGrants(gateway.id, []);
  state.dispatch.mockClear();
  expect((await call(gateway.key)).body.error.code).toBe(-32602);
  expect(state.dispatch).not.toHaveBeenCalled();
  expect(rows()).toHaveLength(1);
});

it("separates gateway and API identities when both the raw key and row ID collide", async () => {
  const gateway = await database.createGatewayKey("Gateway collision", "mcp-fixture-machine");
  await database.setGrants(gateway.id, ["instance-1"], [["echo"]]);
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, 'API collision', 1, '[]', ?)", [gateway.id, gateway.key, new Date().toISOString()]);
  state.dispatch.mockRejectedValue(new Error("upstream down"));
  await call(gateway.key);
  await database.saveRequestUsage({ apiKey: gateway.key, provider: "fixture", model: "tools__echo", tokens: {}, cost: 0, strict: true });
  for (const period of ["all", "today", "24h"]) {
    const stats = await database.getUsageStats(period);
    const byKey = Object.values(stats.byApiKey);
    expect(byKey).toHaveLength(2);
    expect(byKey).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiKeyKey: `mcp-gateway-key:${gateway.id}`, keyName: "Gateway collision", requests: 1 }),
      expect.objectContaining({ apiKeyKey: `api-key:${gateway.id}`, keyName: "API collision", requests: 1 }),
    ]));
    expect(JSON.stringify(stats)).not.toContain(gateway.key);
  }
});

it("preserves the salted HMAC identity after a gateway-only key is deleted", async () => {
  const gateway = await database.createGatewayKey("Deleted gateway", "mcp-fixture-machine");
  await database.setGrants(gateway.id, ["instance-1"], [["echo"]]);
  state.dispatch.mockRejectedValue(new Error("upstream down"));
  await call(gateway.key);
  await database.deleteGatewayKey(gateway.id);
  for (const period of ["all", "today", "24h"]) {
    const stats = await database.getUsageStats(period);
    const [entry] = Object.values(stats.byApiKey);
    expect(entry.apiKeyKey).toMatch(/^api-key:hmac-sha256:[a-f0-9]{64}$/);
    expect(entry).toMatchObject({ keyName: "Deleted API key 1", apiKeyMasked: "***", requests: 1 });
    expect(JSON.stringify(stats)).not.toContain(gateway.key);
  }
});

it.each([
  ["same", "before"], ["different", "before"],
  ["same", "after"], ["different", "after"],
])("keeps deleted MCP history opaque with a %s ordinary row ID imported %s deletion", async (rowId, imported) => {
  const now = new Date(2026, 10, 5, 12, 0, 0);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  try {
    const gateway = await database.createGatewayKey("Gateway collision", "mcp-fixture-machine");
    await database.setGrants(gateway.id, ["instance-1"], [["echo"]]);
    const ordinaryId = rowId === "same" ? gateway.id : `ordinary-${gateway.id}`;
    const importOrdinary = () => adapter.run(
      "INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, 'Surviving API key', 1, '[]', ?)",
      [ordinaryId, gateway.key, now.toISOString()],
    );
    if (imported === "before") importOrdinary();
    state.dispatch.mockRejectedValue(new Error("upstream down"));
    expect((await call(gateway.key)).status).toBe(200);
    expect(state.dispatch).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "instance-1", slug: "tools" })],
      [{ instanceId: "instance-1", slug: "tools", toolAllowlist: ["echo"] }],
      "tools__echo", {},
    );
    expect(Object.values((await database.getUsageStats("all")).byApiKey)).toEqual([
      expect.objectContaining({ apiKeyKey: `mcp-gateway-key:${gateway.id}`, keyName: "Gateway collision", lastUsed: now.toISOString() }),
    ]);
    await database.deleteGatewayKey(gateway.id);
    const [deleted] = Object.values((await database.getUsageStats("all")).byApiKey);
    expect(deleted.apiKeyKey).toMatch(/^api-key:hmac-sha256:[a-f0-9]{64}$/);
    if (imported === "after") importOrdinary();
    const ordinaryLastUsed = new Date(now.getTime() - 60_000).toISOString();
    await database.saveRequestUsage({ timestamp: ordinaryLastUsed, apiKey: gateway.key, provider: "fixture", model: "tools__echo", tokens: {}, cost: 0, strict: true });
    const assertView = (stats) => {
      const json = JSON.stringify(stats);
      const entries = Object.values(JSON.parse(json).byApiKey);
      expect(entries).toHaveLength(2);
      expect(entries.find((entry) => entry.rawProvider === "mcp-gateway")).toMatchObject({
        apiKeyKey: deleted.apiKeyKey, keyName: "Deleted API key 1", apiKeyMasked: "***", requests: 1, lastUsed: now.toISOString(),
      });
      expect(entries.find((entry) => entry.rawProvider === "fixture")).toMatchObject({
        apiKeyKey: `api-key:${ordinaryId}`, keyName: "Surviving API key", apiKeyMasked: "***", requests: 1, lastUsed: ordinaryLastUsed,
      });
      expect(json).not.toContain(gateway.key);
    };
    for (const period of ["all", "today", "24h"]) assertView(await database.getUsageStats(period));
    expect(adapter.get("SELECT key FROM apiKeys WHERE id = ?", [ordinaryId]).key).toBe(gateway.key);
    // Retained daily data supplies counts; the interior-day last-seen summary
    // must supply exact timestamps after raw history is no longer available.
    adapter.run("DELETE FROM usageHistory");
    vi.setSystemTime(new Date(now.getTime() + 2 * 86_400_000));
    assertView(await database.getUsageStats("all"));
  } finally {
    vi.useRealTimers();
  }
});

it("keeps concurrent failed MCP usage out of a colliding key's token rate limit after gateway deletion", async () => {
  const gateway = await database.createGatewayKey("Concurrent gateway", "mcp-fixture-machine");
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, 'Concurrent API', 1, '[]', ?)", [gateway.id, gateway.key, new Date().toISOString()]);
  const record = { key: gateway.key, policy: { tpmLimit: 2 } };
  await Promise.all(Array.from({ length: 3 }, () => database.saveRequestUsage({
    provider: "mcp-gateway", status: "error", apiKey: gateway.key, model: "tools__echo",
    tokens: { prompt_tokens: 5 }, cost: 0, strict: true,
  })));
  await database.deleteGatewayKey(gateway.id);
  expect(await checkApiKeyLimits(record)).toBeNull();
  expect(await database.getApiKeyUsageTotals(gateway.id)).toMatchObject({ totalRequests: 0, totalTokens: 0 });
  const [history] = Object.values((await database.getUsageStats("today")).byApiKey);
  expect(history).toMatchObject({ keyName: "Deleted API key 1", requests: 3 });
  expect(history.apiKeyKey).toMatch(/^api-key:hmac-sha256:[a-f0-9]{64}$/);
  await database.saveRequestUsage({ provider: "fixture", status: "error", apiKey: gateway.key, model: "ordinary", tokens: { prompt_tokens: 2 }, cost: 0, strict: true });
  expect((await checkApiKeyLimits(record)).message).toMatch(/2\/2 tokens\/minute/);
  expect(await database.getApiKeyUsageTotals(gateway.id)).toMatchObject({ totalRequests: 1, totalTokens: 2 });
});

it.each([[{}, 0], [{ prompt_tokens: 5 }, null]])("excludes failed MCP ledger usage %j/%s from lifetime and windows", async (tokens, cost) => {
  await database.saveRequestUsage({ provider: "mcp-gateway", status: "error", apiKey: KEY, model: "tools__echo", tokens, cost, strict: true });
  expect(await database.getApiKeyUsageTotals("mcp-key")).toMatchObject({ totalRequests: 0, totalTokens: 0, totalCost: 0, unknownCostRequests: 0 });
  const window = await database.getApiKeyWindowUsageTotals(KEY, new Date(0).toISOString(), new Date(0).toISOString());
  expect(window.day).toEqual({ inputTokens: 0, outputTokens: 0, requests: 0, cost: 0, unknownCostRequests: 0 });
  expect(window.month).toEqual(window.day);
  expect(rows()).toEqual([expect.objectContaining({ apiKey: KEY, status: "error" })]);
});

it.each([
  ["another provider's error", "fixture", "error"],
  ["a NULL provider error", null, "error"],
  ["a NULL MCP status", "mcp-gateway", null],
  ["NULL provider and status", null, null],
])("preserves counting and unknown costs for %s", async (_name, provider, status) => {
  await database.saveRequestUsage({ provider, status, apiKey: KEY, model: "historical", tokens: { prompt_tokens: 3, completion_tokens: 2 }, cost: null, strict: true });
  // The writer defaults missing statuses to ok; retain the historical NULL
  // shape explicitly so SQL three-valued logic is exercised by the window scan.
  adapter.run("UPDATE usageHistory SET status = ?", [status]);
  expect(await database.getApiKeyUsageTotals("mcp-key")).toMatchObject({ totalRequests: 1, totalTokens: 5, totalCost: 0, unknownCostRequests: 1 });
  const window = await database.getApiKeyWindowUsageTotals(KEY, new Date(0).toISOString(), new Date(0).toISOString());
  for (const period of [window.day, window.month]) {
    expect(period).toEqual({ requests: 1, inputTokens: 3, outputTokens: 2, cost: 0, unknownCostRequests: 1 });
  }
});

it.each(["missing", "overwrite", "legacy"])("keeps failed calls out of the %s lifetime rebuild", async (mode) => {
  state.dispatch.mockRejectedValue(new Error("upstream down"));
  await call();
  // Imported history already has attribution, independently of the handler fix.
  adapter.run("UPDATE usageHistory SET apiKey = ?", [KEY]);
  const at = new Date().toISOString();
  // Non-MCP errors and incomplete historical attribution must still count.
  for (const [provider, status] of [["mcp-gateway", "ok"], ["fixture", "error"], [null, "error"], ["mcp-gateway", null], [null, null]]) {
    adapter.run("INSERT INTO usageHistory(timestamp, apiKey, provider, status, promptTokens, completionTokens, cost, tokens) VALUES(?, ?, ?, ?, 3, 2, 0.25, ?)",
      [at, KEY, provider, status, JSON.stringify({ prompt_tokens: 3, completion_tokens: 2 })]);
  }
  if (mode === "missing") adapter.run("DELETE FROM apiKeyUsageTotals");
  else adapter.run("INSERT INTO apiKeyUsageTotals(apiKeyId, totalRequests) VALUES('mcp-key', 99)");
  if (mode === "legacy") {
    const { ensureAndBackfillApiKeyUsageTotals } = await import("@/lib/db/migrations/apiKeyUsageTotalsBackfill.js");
    ensureAndBackfillApiKeyUsageTotals(adapter);
  } else {
    const { backfillApiKeyUsageTotals } = await import("@/lib/db/helpers/apiKeyUsageTotals.js");
    backfillApiKeyUsageTotals(adapter, { overwrite: mode === "overwrite" });
  }
  expect(await database.getApiKeyUsageTotals("mcp-key")).toMatchObject({ totalRequests: 5, totalTokens: 25, totalCost: 1.25 });
  expect(adapter.get("SELECT key FROM apiKeys WHERE id = 'mcp-key'").key).toBe(KEY);
  expect(rows()).toHaveLength(6);
});

it.each([
  ["success", () => state.dispatch.mockResolvedValue({ result: { content: [], isError: false } })],
  ...failures,
])("%s is a zero-cost tool call, not an unknown-cost request", async (_name, arrange) => {
  arrange();
  await call();
  const [row] = rows();
  expect(row.cost).toBe(0);
  expect(JSON.parse(row.meta)).toMatchObject({ costStatus: "known", costSource: "mcp-gateway" });
  expect(await database.getUsageStats("all")).toMatchObject({ totalRequests: 1, unknownCostRequests: 0 });
  expect(await database.getApiKeyUsageTotals("mcp-key")).toMatchObject({ unknownCostRequests: 0 });
});
