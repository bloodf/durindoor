import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const originalTz = process.env.TZ;
let tempDir;
let db;

beforeAll(async () => {
  process.env.TZ = "America/New_York";
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-usage-dst-"));
  process.env.DATA_DIR = tempDir;
  vi.useFakeTimers();
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  vi.useRealTimers();
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("server-local today chart across DST", () => {
  it("uses 23 actual hours on spring-forward day", async () => {
    vi.setSystemTime(new Date("2026-03-08T12:00:00-04:00"));
    const chart = await db.getChartData("today");
    expect(chart).toHaveLength(23);
    expect(new Set(chart.map((point) => point.label)).size).toBe(23);
  });

  it("uses 25 offset-aware hours on fall-back day", async () => {
    vi.setSystemTime(new Date("2026-11-01T12:00:00-05:00"));
    const chart = await db.getChartData("today");
    expect(chart).toHaveLength(25);
    expect(new Set(chart.map((point) => point.label)).size).toBe(25);
  });
});
