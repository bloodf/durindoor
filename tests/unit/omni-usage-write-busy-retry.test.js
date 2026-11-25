import { readUsageDailyRollups } from "@/lib/db/helpers/usageDailyRollups.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({ errors: [], attempts: 0, enabled: false }));
vi.mock("@/lib/db/driver.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getAdapter: async (...args) => {
    const db = await actual.getAdapter(...args);
    if (!fault.enabled) return db;
    return { ...db, driver: "better-sqlite3", transaction: (fn) => {
      fault.attempts++;
      return db.transaction(() => {
        const result = fn();
        const error = fault.errors.shift();
        if (error) throw error;
        return result;
      });
    } };
  } };
});

let dir, previous, db, repo;
const busy = () => Object.assign(new Error("busy"), { code: "SQLITE_BUSY" });
const event = { usageEventId: "retry-event", timestamp: "2026-01-02T03:04:05.000Z", provider: "fixture", model: "fixture", apiKeyId: "key-1", tokens: { prompt_tokens: 2, completion_tokens: 3 }, cost: 0 };

beforeEach(async () => {
  previous = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-retry-"));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  vi.resetModules();
  fault.enabled = false; fault.errors = []; fault.attempts = 0;
  const driver = await import("@/lib/db/driver.js");
  db = await driver.getAdapter();
  db.run("INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES(?, ?, ?, 1, '[]', ?)", ["key-1", "fixture-key", "fixture", event.timestamp]);
  repo = await import("@/lib/db/repos/usageRepo.js");
  fault.enabled = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  fault.enabled = false;
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

it("retries rolled-back contention without duplicating history or counters", async () => {
  fault.errors = [busy()];
  expect(await repo.saveRequestUsage(event)).toBe(true);
  expect(fault.attempts).toBe(2);
  expect(await repo.saveRequestUsage(event)).toBe(true);
  expect(db.get("SELECT COUNT(*) AS n, MIN(timestamp) AS timestamp FROM usageHistory")).toMatchObject({ n: 1, timestamp: event.timestamp });
  expect(db.get("SELECT totalRequests, totalTokens FROM apiKeyUsageTotals WHERE apiKeyId = ?", ["key-1"])).toMatchObject({ totalRequests: 1, totalTokens: 5 });
  expect([...readUsageDailyRollups(db)][0].day.requests).toBe(1);
});

it("stops after bounded contention and preserves best-effort failure", async () => {
  fault.errors = [busy(), busy(), busy(), busy()];
  expect(await repo.saveRequestUsage(event)).toBe(false);
  expect(fault.attempts).toBe(4);
  expect(db.get("SELECT COUNT(*) AS n FROM usageHistory").n).toBe(0);
  expect(db.get("SELECT COUNT(*) AS n FROM apiKeyUsageTotals").n).toBe(0);
});

it("does not retry other errors, strict writes, or unidentified events", async () => {
  for (const [entry, error] of [[event, Object.assign(new Error("other"), { code: "SQLITE_LOCKED" })], [{ ...event, strict: true }, busy()], [{ ...event, usageEventId: undefined }, busy()]]) {
    fault.attempts = 0; fault.errors = [error];
    if (entry.strict) await expect(repo.saveRequestUsage(entry)).rejects.toBe(error);
    else expect(await repo.saveRequestUsage(entry)).toBe(false);
    expect(fault.attempts).toBe(1);
  }
  expect(db.get("SELECT COUNT(*) AS n FROM usageHistory").n).toBe(0);
});
