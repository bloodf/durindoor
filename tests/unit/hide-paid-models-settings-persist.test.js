import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// #6495 / F-4 — settings persistence. The `hidePaidModels` toggle must survive
// a real API round-trip against the real repository: PATCH /api/settings flips
// it, GET /api/settings reads the same value back from the persisted sqlite
// row. Uses an isolated temp DATA_DIR + initDb so the exercise proves actual
// persistence, not a mock echo. Only NextResponse + side-effect modules are
// mocked; `@/lib/localDb` is the real adapter bound to the temp DB.

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-hide-paid-settings-"));
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

describe("settings API hidePaidModels persistence (real repo round-trip)", () => {
  it("PATCH hidePaidModels:true then GET returns true from the persisted row", async () => {
    const patchRes = await settingsRoute.PATCH({
      json: async () => ({ hidePaidModels: true }),
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.hidePaidModels).toBe(true);

    // Fresh GET reads the persisted sqlite row, not the PATCH echo.
    const getRes = await settingsRoute.GET();
    expect(getRes.status).toBe(200);
    expect(getRes.body.hidePaidModels).toBe(true);
  });
});
