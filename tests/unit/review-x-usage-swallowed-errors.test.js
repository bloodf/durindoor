import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

let directory, db;
afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  db?.close();
  delete global._dbAdapter;
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/db/repos/connectionsRepo.js");
  vi.unstubAllEnvs();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

it("returns account stats and logs safely when the connection lookup fails", async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "usage-fallback-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  delete global._dbAdapter;
  vi.resetModules();
  vi.doMock("@/lib/db/repos/connectionsRepo.js", async (importOriginal) => ({
    ...await importOriginal(),
    getProviderConnections: vi.fn().mockRejectedValue(new Error("secret fixture")),
  }));
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  const repo = await import("@/lib/db/repos/usageRepo.js");
  await repo.saveRequestUsage({ timestamp: new Date().toISOString(), provider: "fixture", model: "model", connectionId: "account-123", tokens: { prompt_tokens: 2, completion_tokens: 3 }, status: "ok" });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const stats = await repo.getUsageStats("all");
  expect(stats.totalRequests).toBe(1);
  expect(Object.values(stats.byAccount)).toEqual(expect.arrayContaining([expect.objectContaining({ connectionId: "account-123", requests: 1 })]));
  expect(warn).toHaveBeenCalledWith("[usageRepo] stats connection lookup failed", "Error");
  expect(JSON.stringify(warn.mock.calls)).not.toContain("secret fixture");
});

it("does not silently swallow bare catches in either repository", () => {
  for (const file of ["usageRepo.js", "proxyTimelineRepo.js"]) {
    const source = fs.readFileSync(new URL(`../../src/lib/db/repos/${file}`, import.meta.url), "utf8");
    expect(source).not.toMatch(/catch\s*\{/);
    expect(source).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*\}/);
  }
});
