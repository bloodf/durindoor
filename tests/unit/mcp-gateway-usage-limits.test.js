import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

// #1085: real handler, ledger and limit check. A failed tool call must not use up
// the key's limits, and a tool call is never an unpriced LLM request.
const state = vi.hoisted(() => ({ dispatch: vi.fn(), writes: [] }));
vi.mock("../../src/lib/mcp/gateway/aggregator", () => ({ dispatchToolCall: (...args) => state.dispatch(...args) }));
vi.mock("@/lib/localDb", async () => {
  const database = await import("@/lib/db/index.js");
  return {
    validateGatewayKey: async () => ({ id: "gateway-key" }),
    getGrantsForKeyDetailed: async () => [{ instanceId: "instance-1", toolAllowlist: ["echo"] }],
    getEnabledInstancesByIds: async () => [{ id: "instance-1", slug: "tools" }],
    saveRequestUsage(entry) {
      const write = database.saveRequestUsage(entry);
      state.writes.push(write);
      return write;
    },
  };
});

const KEY = "sk-mcp-limit-fixture";
const RECORD = { key: KEY, policy: { monthlyRequestLimit: 2 } };
const original = Object.fromEntries(["DATA_DIR", "DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL"].map((name) => [name, process.env[name]]));
let directory; let adapter; let database; let handleJsonRpc; let checkApiKeyLimits;

async function call() {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tools__echo", arguments: {} } };
  const request = new Request("http://localhost/api/mcp-gateway", { method: "POST", headers: { authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
  const response = await handleJsonRpc(request, body);
  await Promise.all(state.writes.splice(0));
  return response;
}
const rows = () => adapter.all("SELECT apiKey, status, cost, meta FROM usageHistory ORDER BY id");
const failures = [
  ["a thrown tool error", () => state.dispatch.mockRejectedValue(new Error("upstream down"))],
  ["an isError tool result", () => state.dispatch.mockResolvedValue({ result: { content: [{ type: "text", text: "nope" }], isError: true } })],
];

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-usage-limits-"));
  process.env.DATA_DIR = directory;
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  delete process.env.DURINDOOR_PG_URL;
  delete global._dbAdapter;
  database = await import("@/lib/db/index.js");
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
  adapter.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES('mcp-key', ?, 'MCP limits', 1, '[]', ?)", [KEY, new Date().toISOString()]);
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
  expect(rows().map((row) => [row.apiKey, row.status])).toEqual([[null, "error"], [null, "error"]]);
  expect(await checkApiKeyLimits(RECORD)).toBeNull();
  expect(await database.getApiKeyUsageTotals("mcp-key")).toMatchObject({ totalRequests: 0, unknownCostRequests: 0 });
});

it("successful calls still count toward the key's request limit", async () => {
  state.dispatch.mockResolvedValue({ result: { content: [], isError: false } });
  expect(await checkApiKeyLimits(RECORD)).toBeNull();
  for (let i = 0; i < 2; i++) await call();
  expect(rows().map((row) => [row.apiKey, row.status])).toEqual([[KEY, "ok"], [KEY, "ok"]]);
  expect((await checkApiKeyLimits(RECORD))?.message || "").toContain("monthly requests limit reached");
  expect(await database.getApiKeyUsageTotals("mcp-key")).toMatchObject({ totalRequests: 2 });
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
