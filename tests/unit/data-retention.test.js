import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-data-retention-"));
process.env.DATA_DIR = dataDir;

const { getAdapter } = await import("../../src/lib/db/driver.js");
const { runDataRetention, runDataRetentionIfEnabled, getDataRetentionLastRun, normalizeRetentionDays } =
  await import("../../src/lib/dataRetention/runner.js");
const { updateSettings } = await import("../../src/lib/db/repos/settingsRepo.js");

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-08T12:00:00.000Z");

async function seed() {
  const db = await getAdapter();
  db.run("DELETE FROM usageHistory");
  db.run("DELETE FROM requestDetails");
  const rows = [
    ["old", new Date(NOW - 40 * DAY).toISOString()],
    ["edge", new Date(NOW - 8 * DAY).toISOString()],
    ["fresh", new Date(NOW - 2 * DAY).toISOString()],
  ];
  for (const [tag, timestamp] of rows) {
    db.run(
      "INSERT INTO usageHistory(timestamp, provider, model, connectionId, promptTokens, completionTokens, status) VALUES(?, ?, ?, ?, 1, 1, 'success')",
      [timestamp, "codex", `model-${tag}`, "conn-1"],
    );
    db.run(
      "INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)",
      [`rd-${tag}`, timestamp, "codex", `model-${tag}`, "conn-1", "success", "{}"],
    );
  }
  return db;
}

describe("data retention", () => {
  it("validates the retention window", () => {
    expect(normalizeRetentionDays(7)).toBe(7);
    expect(normalizeRetentionDays("30")).toBe(30);
    expect(normalizeRetentionDays(0)).toBeNull();
    expect(normalizeRetentionDays(1.5)).toBeNull();
    expect(normalizeRetentionDays(4000)).toBeNull();
    expect(normalizeRetentionDays("abc")).toBeNull();
  });

  it("removes only records older than the window and records the run", async () => {
    const db = await seed();
    const result = await runDataRetention({ days: 7, now: NOW, trigger: "manual" });

    expect(result.days).toBe(7);
    expect(result.deleted.usage).toBe(2);
    expect(result.deleted.requestDetails).toBe(2);
    expect(result.errors).toBeUndefined();

    const usage = db.all("SELECT model FROM usageHistory ORDER BY timestamp").map((row) => row.model);
    const details = db.all("SELECT id FROM requestDetails ORDER BY timestamp").map((row) => row.id);
    expect(usage).toEqual(["model-fresh"]);
    expect(details).toEqual(["rd-fresh"]);

    const lastRun = await getDataRetentionLastRun();
    expect(lastRun.days).toBe(7);
    expect(lastRun.trigger).toBe("manual");
    expect(lastRun.deleted.usage).toBe(2);
  });

  it("rejects an invalid window", async () => {
    await expect(runDataRetention({ days: 0, now: NOW })).rejects.toThrow(/Invalid retention days/);
  });

  it("is a no-op while disabled and follows the saved window when enabled", async () => {
    await seed();
    await updateSettings({ dataRetentionEnabled: false, dataRetentionDays: 7 });
    expect(await runDataRetentionIfEnabled({ now: NOW })).toBeNull();

    await updateSettings({ dataRetentionEnabled: true, dataRetentionDays: 30 });
    const result = await runDataRetentionIfEnabled({ now: NOW });
    expect(result.trigger).toBe("scheduled");
    expect(result.days).toBe(30);
    expect(result.deleted.usage).toBe(1);
  });
});
