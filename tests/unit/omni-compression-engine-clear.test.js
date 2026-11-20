import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn(), resetComboScoring: vi.fn() }));
vi.mock("@/shared/services/quotaAutoPing", () => ({ runQuotaAutoPingTick: vi.fn() }));

const originalDataDir = process.env.DATA_DIR;
let tempDir, db, driver, route;
const initial = { lite: { enabled: true, maxToolLength: 5000 }, rtk: { enabled: true, level: "standard" } };
const patch = (compressionEngines) => route.PATCH({ json: async () => ({ compressionEngines }) });

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "compression-clear-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  driver = await import("@/lib/db/driver.js");
  await db.initDb();
  route = await import("../../src/app/api/settings/route.js");
});
afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});
beforeEach(async () => {
  (await driver.getAdapter()).run("INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data", [JSON.stringify({ compressionEngines: initial, theme: "dark", requireLogin: true })]);
});

describe("compression engine clear", () => {
  it("persists a clear, preserves siblings and allows re-enabling", async () => {
    expect((await patch({ lite: null })).status).toBe(200);
    expect((await route.GET()).body).toMatchObject({ compressionEngines: { rtk: initial.rtk }, theme: "dark" });
    expect((await db.getSettings()).compressionEngines).toEqual({ rtk: initial.rtk });
    expect((await patch({ lite: { enabled: true } })).status).toBe(200);
    expect((await db.getSettings()).compressionEngines).toEqual({ rtk: initial.rtk, lite: { enabled: true } });
  });
  it("merges fields, retains explicit null properties, and treats an empty map as a no-op", async () => {
    expect((await patch({ lite: { maxToolLength: null }, rtk: null })).status).toBe(200);
    expect((await db.getSettings()).compressionEngines).toEqual({ lite: { enabled: true, maxToolLength: null } });
    expect((await patch({})).status).toBe(200);
    expect((await db.getSettings()).compressionEngines).toEqual({ lite: { enabled: true, maxToolLength: null } });
  });
  it.each([null, [], "bad", 1, { lite: [] }, { lite: false }, { lite: "bad" }])("rejects invalid map or entry %j without writing", async (value) => {
    expect((await patch(value)).status).toBe(400);
    expect((await db.getSettings()).compressionEngines).toEqual(initial);
  });
  it("preserves settings authorization while clearing an engine", async () => {
    const response = await route.PATCH({ json: async () => ({ compressionEngines: { lite: null }, requireLogin: false }) });
    expect(response.status).toBe(200);
    const settings = await db.getSettings();
    expect(settings.compressionEngines).toEqual({ rtk: initial.rtk });
    expect(settings.requireLogin).toBe(true);
  });
  it("applies the same clear inside the password epoch transaction", async () => {
    await db.updateSettingsWithPasswordEpoch({ compressionEngines: { rtk: null, lite: { maxToolLength: null } } }, "initial");
    expect((await db.getSettings()).compressionEngines).toEqual({ lite: { enabled: true, maxToolLength: null } });
  });
});
