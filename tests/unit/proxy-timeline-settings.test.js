import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => ({ body, status: init.status || 200 }),
  },
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
}));
vi.mock("@/shared/services/quotaAutoPing", () => ({ runQuotaAutoPingTick: vi.fn() }));

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let settingsRoute;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-proxy-timeline-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  settingsRoute = await import("../../src/app/api/settings/route.js");
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("settings API proxy timeline keys (real repo round-trip)", () => {
  it("defaults enableProxyTimeline to false and proxyTimelineRetentionDays to 1", async () => {
    const getRes = await settingsRoute.GET();
    expect(getRes.status).toBe(200);
    expect(getRes.body.enableProxyTimeline).toBe(false);
    expect(getRes.body.proxyTimelineRetentionDays).toBe(1);
  });

  it("PATCH enableProxyTimeline:true and proxyTimelineRetentionDays:7 persists and reads back", async () => {
    const patchRes = await settingsRoute.PATCH({
      json: async () => ({ enableProxyTimeline: true, proxyTimelineRetentionDays: 7 }),
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.enableProxyTimeline).toBe(true);
    expect(patchRes.body.proxyTimelineRetentionDays).toBe(7);

    const getRes = await settingsRoute.GET();
    expect(getRes.status).toBe(200);
    expect(getRes.body.enableProxyTimeline).toBe(true);
    expect(getRes.body.proxyTimelineRetentionDays).toBe(7);
  });

  it("keeps canonical observability setting when a legacy update is submitted", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [JSON.stringify({ enableObservability: true, enableObservability2: false })],
    );
    const { getSettings, getSettingsSync, updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
    await updateSettings({ enableObservability2: false });

    for (const settings of [await getSettings(), getSettingsSync(), (await settingsRoute.GET()).body]) {
      expect(settings.enableObservability).toBe(true);
      expect(settings).not.toHaveProperty("enableObservability2");
    }
    expect(JSON.parse(db.get(`SELECT data FROM settings WHERE id = 1`).data)).not.toHaveProperty("enableObservability2");
  });

  it("rejects proxyTimelineRetentionDays outside the allowed set with 400", async () => {
    const patchRes = await settingsRoute.PATCH({
      json: async () => ({ proxyTimelineRetentionDays: 2 }),
    });
    expect(patchRes.status).toBe(400);
  });

  it("rejects a non-boolean enableProxyTimeline with 400", async () => {
    const patchRes = await settingsRoute.PATCH({
      json: async () => ({ enableProxyTimeline: "yes" }),
    });
    expect(patchRes.status).toBe(400);
  });
});
