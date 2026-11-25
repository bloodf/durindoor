import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let dir, adapter, GET;
const original = process.env.DATA_DIR;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "combo-model-"));
  process.env.DATA_DIR = dir;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  adapter = await import("@/lib/db/driver.js").then((m) => m.getAdapter());
  ({ GET } = await import("@/app/api/usage/combos/route.js"));
});
afterAll(() => {
  if (original === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = original;
  fs.rmSync(dir, { recursive: true, force: true });
});
const report = async (query = "period=all") => (await GET(new Request(`http://localhost/api/usage/combos?${query}`))).json();

describe("combo served model breakdown", () => {
  it("returns an empty breakdown for an empty report", async () => {
    const result = await report();
    expect(result.rows).toEqual([]);
    expect(result.modelBreakdown).toEqual([]);
    expect(result.unattributed.requests).toBe(0);
  });
  it("keeps existing totals and unattributed history while counting recorded models", async () => {
    const insert = (model, comboId, comboName, status, cost, connection = "connection-a") => adapter.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, comboId, comboName, status, promptTokens, completionTokens, cost, tokens) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["2026-09-01T00:00:00.000Z", "provider", model, connection, comboId, comboName, status, 2, 1, cost, "{}"],
    );
    insert("small", "combo-1", "Production", "ok", 1);
    insert("small", "combo-1", "Production", "error", null);
    insert("large", "combo-1", "Production", "ok", 2);
    insert("small", null, null, "ok", 3);
    const before = adapter.all("SELECT * FROM usageHistory ORDER BY id");
    const result = await report();
    expect(result.rows).toEqual([{ comboId: "combo-1", comboName: "Production", connectionId: "connection-a", requests: 3, promptTokens: 6, completionTokens: 3, cost: 3 }]);
    expect(result.modelBreakdown).toEqual([
      { comboId: "combo-1", comboName: "Production", connectionId: "connection-a", provider: "provider", model: "large", requests: 1, share: 33 },
      { comboId: "combo-1", comboName: "Production", connectionId: "connection-a", provider: "provider", model: "small", requests: 2, share: 67 },
    ]);
    expect(result.unattributed).toEqual({ requests: 1, promptTokens: 2, completionTokens: 1, cost: 3 });
    expect(adapter.all("SELECT * FROM usageHistory ORDER BY id")).toEqual(before);
    const empty = await report("period=all&startDate=2020-01-01&endDate=2020-01-01");
    expect(empty.modelBreakdown).toEqual([]);
    expect(empty.rows).toEqual([]);
  });
  it("keeps model shares and row totals on one snapshot when a write intervenes", async () => {
    adapter.run("DELETE FROM usageHistory");
    const insert = (model) => adapter.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, comboId, comboName, tokens) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ["2026-09-01T00:00:00.000Z", "provider", model, "connection-a", "combo-1", "Production", "{}"],
    );
    insert("small");
    insert(null);
    const all = adapter.all.bind(adapter);
    const spy = vi.spyOn(adapter, "all").mockImplementation((sql, params) => {
      const result = all(sql, params);
      if (sql.includes("FROM usageHistory")) {
        spy.mockRestore();
        insert("large");
      }
      return result;
    });
    try {
      const result = await report();
      expect(result.rows[0].requests).toBe(2);
      expect(result.modelBreakdown).toEqual([
        { comboId: "combo-1", comboName: "Production", connectionId: "connection-a", provider: "provider", model: "small", requests: 1, share: 50 },
      ]);
      expect(adapter.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });

});
