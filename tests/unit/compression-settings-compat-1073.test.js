// Work order #1073 -- port of OmniRoute #15613 (compression engines partial
// write) against the fork's own compression stack and settings store.
//
// The fork configures the compression stack with ONE per-engine map stored in
// the `compressionEngines` settings field:
//   { [engineId]: { enabled, level?, ...engine options } }
// A write that carried only the engine it changed used to REPLACE that map,
// so a toggle on one surface dropped every sibling engine (and every sibling's
// options) the writer had not loaded. Upstream fixed the same loss in its
// compression store; the fork needs the equivalent in its settings store.
//
// Offline only: a temp DATA_DIR, no provider, no network, no dashboard.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let driver;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-compression-engines-1073-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  driver = await import("@/lib/db/driver.js");
  await db.initDb();
});

afterAll(async () => {
  await disposeLoadedRequestDetailsRepo();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

// Start every case from an empty settings row so the cases stay independent
// (the merge keeps stored engines, so a leftover map would leak between them).
beforeEach(async () => {
  const adapter = await driver.getAdapter();
  adapter.run(
    "INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    [JSON.stringify({})],
  );
});

describe("port(omniroute): #1073 - compressionEngines partial writes", () => {
  it("keeps the sibling engines when a write carries one engine", async () => {
    await db.updateSettings({
      compressionEngines: {
        rtk: { enabled: true, level: "standard" },
        caveman: { enabled: true, level: "full" },
      },
    });

    await db.updateSettings({ compressionEngines: { lite: { enabled: true } } });

    const { compressionEngines } = await db.getSettings();
    expect(compressionEngines.rtk).toEqual({ enabled: true, level: "standard" });
    expect(compressionEngines.caveman).toEqual({ enabled: true, level: "full" });
    expect(compressionEngines.lite).toEqual({ enabled: true });
  });

  it("keeps a toggle made on one surface when another surface writes a different engine", async () => {
    await db.updateSettings({ compressionEngines: { rtk: { enabled: true } } });
    // A second surface turns its own engine on.
    await db.updateSettings({ compressionEngines: { headroom: { enabled: true } } });
    // The first surface then flips its engine off.
    await db.updateSettings({ compressionEngines: { rtk: { enabled: false } } });

    const { compressionEngines } = await db.getSettings();
    expect(compressionEngines.rtk.enabled).toBe(false);
    expect(compressionEngines.headroom.enabled).toBe(true);
  });

  it("keeps the stored level and per-engine options when a write only sets enabled", async () => {
    await db.updateSettings({
      compressionEngines: {
        caveman: { enabled: true, level: "ultra" },
        lite: { enabled: true, truncateToolResults: true, maxToolLength: 5000 },
      },
    });

    await db.updateSettings({
      compressionEngines: {
        caveman: { enabled: false },
        lite: { enabled: false },
      },
    });

    const { compressionEngines } = await db.getSettings();
    expect(compressionEngines.caveman).toEqual({ enabled: false, level: "ultra" });
    expect(compressionEngines.lite).toEqual({
      enabled: false,
      truncateToolResults: true,
      maxToolLength: 5000,
    });
  });

  it("stores exactly the written engine on a fresh install (no map is widened)", async () => {
    await db.updateSettings({ compressionEngines: { "session-dedup": { enabled: true } } });

    const { compressionEngines } = await db.getSettings();
    expect(Object.keys(compressionEngines)).toEqual(["session-dedup"]);
  });

  it("keeps the stored map when the incoming value is not a map", async () => {
    await db.updateSettings({ compressionEngines: { caveman: { enabled: true, level: "full" } } });

    await db.updateSettings({ compressionEngines: "not-a-map" });

    const { compressionEngines } = await db.getSettings();
    expect(compressionEngines).toEqual({ caveman: { enabled: true, level: "full" } });
  });

  it("leaves the map untouched when the write carries no engines key", async () => {
    await db.updateSettings({ compressionEngines: { caveman: { enabled: true } } });

    await db.updateSettings({ compressionEnabled: true });

    const settings = await db.getSettings();
    expect(settings.compressionEnabled).toBe(true);
    expect(settings.compressionEngines).toEqual({ caveman: { enabled: true } });
  });

  it("does not turn on an unavailable catalog engine", async () => {
    const { isEngineAvailable } = await import("../../open-sse/services/compression/index.js");
    const { runCompressionSeam } = await import("../../open-sse/handlers/chatCore/compressionHook.js");

    await db.updateSettings({ compressionEngines: { aggressive: { enabled: true } } });

    const { compressionEngines } = await db.getSettings();
    expect(compressionEngines.aggressive).toEqual({ enabled: true });
    // The catalog entry is a metadata-only placeholder in this tree.
    expect(isEngineAvailable("aggressive")).toBe(false);

    const body = {
      messages: [{ role: "user", content: "keep every token of this message intact" }],
    };
    const out = await runCompressionSeam(body, undefined, {
      enabled: true,
      engines: compressionEngines,
    });
    expect(out.body).toEqual(body);
    expect(out.headerValue).toBeNull();
  });
});
