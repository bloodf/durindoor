import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let getAdapter;
let countRequestDetailsSince;
let iterateRequestDetailsSince;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-logs-export-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const dbIndex = await import("@/lib/db/index.js");
  await dbIndex.initDb();
  ({ getAdapter } = await import("@/lib/db/driver.js"));
  ({ countRequestDetailsSince, iterateRequestDetailsSince } = await import(
    "@/lib/db/repos/requestDetailsRepo.js"
  ));
  db = await getAdapter();

  // Insert directly rather than through saveRequestDetail's async batch queue,
  // so row counts and ordering are deterministic without waiting on flushes.
  // Timestamps are anchored to the real clock (minus a day) because the route
  // computes `since` from the real Date.now(), not an injectable clock.
  const base = Date.now() - 24 * 3600 * 1000;
  for (let i = 0; i < 1_200; i++) {
    const timestamp = new Date(base + i * 1_000).toISOString();
    db.run(
      `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [`row-${i}`, timestamp, "openai", "gpt-test", "conn-1", "ok", JSON.stringify({ id: `row-${i}`, index: i })]
    );
  }
  // One row well before the export window, to prove `since` filtering.
  db.run(
    `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    ["row-old", "2020-01-01T00:00:00.000Z", "openai", "gpt-test", "conn-1", "ok", JSON.stringify({ id: "row-old" })]
  );
}, 30_000);

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("requestDetails streaming export (DB layer)", () => {
  it("counts only rows at or after `since`, excluding older rows", async () => {
    const total = await countRequestDetailsSince("2025-01-01T00:00:00.000Z");
    expect(total).toBe(1_200);
  });

  it("iterates newest-first across a page boundary without dropping or duplicating rows", async () => {
    const rows = [];
    for await (const row of iterateRequestDetailsSince("2025-01-01T00:00:00.000Z", 1_200)) {
      rows.push(row);
    }
    expect(rows).toHaveLength(1_200);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1_200);
    // newest first
    expect(rows[0].index).toBe(1_199);
    expect(rows[rows.length - 1].index).toBe(0);
  });

  it("caps the generator at `limit` even though more rows are available", async () => {
    const rows = [];
    for await (const row of iterateRequestDetailsSince("2025-01-01T00:00:00.000Z", 750)) {
      rows.push(row);
    }
    expect(rows).toHaveLength(750);
    // still newest-first, so the cap keeps the most recent rows
    expect(rows[0].index).toBe(1_199);
    expect(rows[rows.length - 1].index).toBe(450);
  });
});

describe("GET /api/logs/export (route)", () => {
  it("reports capped:true and totalAvailable when the row cap truncates the export", async () => {
    const route = await import("../../src/app/api/logs/export/route.js");
    const res = await route.GET(new Request("http://localhost/api/logs/export?hours=168&limit=100"));
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.capped).toBe(true);
    expect(body.limit).toBe(100);
    expect(body.totalAvailable).toBe(1_200);
    expect(body.logs).toHaveLength(100);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="durindoor-request-logs-/);
  });

  it("omits capped fields when every matching row fits under the limit", async () => {
    const route = await import("../../src/app/api/logs/export/route.js");
    const res = await route.GET(new Request("http://localhost/api/logs/export?hours=168&limit=50000"));
    const body = JSON.parse(await res.text());
    expect(body.capped).toBeUndefined();
    expect(body.count).toBe(1_200);
    expect(body.logs).toHaveLength(1_200);
  });

  it("clamps an out-of-range limit to the documented maximum", async () => {
    const route = await import("../../src/app/api/logs/export/route.js");
    const res = await route.GET(new Request("http://localhost/api/logs/export?limit=999999"));
    const body = JSON.parse(await res.text());
    expect(body.limit ?? 50_000).toBeLessThanOrEqual(50_000);
  });
});
