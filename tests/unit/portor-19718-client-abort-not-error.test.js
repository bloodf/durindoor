import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

let dir;
let oldDir;

beforeEach(() => {
  oldDir = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "portor-19718-"));
  process.env.DATA_DIR = dir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (oldDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = oldDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("OmniRoute #19718 - a client disconnect is not a provider error", () => {
  it("counts a cancelled row as a request but not as an error", async () => {
    await import("@/lib/db/index.js");
    const db = await (await import("@/lib/db/driver.js")).getAdapter();
    const { getMonitoringUsage } = await import("@/lib/db/repos/monitoringUsageRepo.js");
    const timestamp = new Date(Date.now() - 60_000).toISOString();
    for (const status of ["success", "cancelled", "cancelled", "error"]) {
      db.run(`INSERT INTO usageHistory(timestamp, provider, model, status, tokens) VALUES (?, 'openai', 'model', ?, '{}')`,
        [timestamp, status]);
    }

    const since = "2000-01-01T00:00:00.000Z";
    const usage = await getMonitoringUsage({ activityStart: since, healthStart: since });

    expect(usage.health).toMatchObject([{ id: "openai", requests: 4, errors: 1, successRate: 75 }]);
    expect(usage.successRate).toBe(75);
  });
});
