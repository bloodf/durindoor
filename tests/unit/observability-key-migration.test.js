import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-obs-mig-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("enableObservability2 migration", () => {
  it("copies enableObservability2 only when enableObservability is absent", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [JSON.stringify({ enableObservability2: false })],
    );
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    expect(settings.enableObservability).toBe(false);
    expect(JSON.parse(db.get(`SELECT data FROM settings WHERE id = 1`).data)).not.toHaveProperty("enableObservability2");
    expect(settings).not.toHaveProperty("enableObservability2");
  });

  it("keeps enableObservability when both keys exist", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [JSON.stringify({ enableObservability: true, enableObservability2: false })],
    );
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    expect(settings.enableObservability).toBe(true);
    expect(settings).not.toHaveProperty("enableObservability2");
    expect(JSON.parse(db.get(`SELECT data FROM settings WHERE id = 1`).data)).not.toHaveProperty("enableObservability2");
  });

  it("updateSettings strips a legacy key supplied directly in updates", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const { updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const result = await updateSettings({ enableObservability2: false });
    expect(result.enableObservability).toBe(true);
    expect(result).not.toHaveProperty("enableObservability2");
    expect(JSON.parse(db.get(`SELECT data FROM settings WHERE id = 1`).data)).not.toHaveProperty("enableObservability2");
  });

  it("keeps stored canonical value when updates supply enableObservability2", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [JSON.stringify({ enableObservability: true, enableObservability2: false })],
    );
    const { getSettings, getSettingsSync, updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
    await updateSettings({ enableObservability2: false });

    for (const settings of [await getSettings(), getSettingsSync()]) {
      expect(settings.enableObservability).toBe(true);
      expect(settings).not.toHaveProperty("enableObservability2");
    }
    expect(JSON.parse(db.get(`SELECT data FROM settings WHERE id = 1`).data)).not.toHaveProperty("enableObservability2");
  });

  it("getSettingsSync migrates and persists a legacy-only observability key", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [JSON.stringify({ enableObservability2: false })],
    );
    const { getSettingsSync } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = getSettingsSync();

    expect(settings.enableObservability).toBe(false);
    expect(settings).not.toHaveProperty("enableObservability2");
    expect(JSON.parse(db.get(`SELECT data FROM settings WHERE id = 1`).data)).not.toHaveProperty("enableObservability2");
  });

  it("updateSettingsWithPasswordEpoch strips a legacy key supplied in updates", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const { updateSettingsWithPasswordEpoch } = await import("@/lib/db/repos/settingsRepo.js");
    const result = await updateSettingsWithPasswordEpoch({ enableObservability2: false }, "initial");

    expect(result.enableObservability).toBe(true);
    expect(result).not.toHaveProperty("enableObservability2");
    expect(JSON.parse(db.get(`SELECT data FROM settings WHERE id = 1`).data)).not.toHaveProperty("enableObservability2");
  });

  it("does not capture request details when OBSERVABILITY_ENABLED is false", async () => {
    const originalObservabilityEnabled = process.env.OBSERVABILITY_ENABLED;
    process.env.OBSERVABILITY_ENABLED = "false";
    try {
      vi.resetModules();
      const { getSettings, updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
      expect((await getSettings()).enableObservability).toBe(true);
      await updateSettings({ observabilityBatchSize: 1, observabilityFlushIntervalMs: 10 });

      const repo = await import("@/lib/db/repos/requestDetailsRepo.js");
      const { getAdapter } = await import("@/lib/db/driver.js");
      await repo.saveRequestDetail({ id: "env-disabled", provider: "test", model: "test" });
      await new Promise((r) => setImmediate(r));
      const db = await getAdapter();
      expect(db.get(`SELECT COUNT(*) as c FROM requestDetails`).c).toBe(0);
    } finally {
      if (originalObservabilityEnabled === undefined) delete process.env.OBSERVABILITY_ENABLED;
      else process.env.OBSERVABILITY_ENABLED = originalObservabilityEnabled;
    }
  });
});
