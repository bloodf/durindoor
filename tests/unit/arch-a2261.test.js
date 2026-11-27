import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createPostgresAdapter } from "@/lib/db/adapters/pgAdapter.js";
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

it("serializes concurrent transactions so a rollback cannot remove committed writes", async () => {
  const committed = [];
  let pending = [];
  const client = {
    async connect() {},
    async end() {},
    async query(sql, params) {
      if (sql === "BEGIN") pending = [];
      else if (sql === "COMMIT") committed.push(...pending);
      else if (sql === "ROLLBACK") pending = [];
      else if (sql.startsWith("INSERT")) pending.push(params[0]);
      return { rows: [], rowCount: 0 };
    },
  };
  const adapter = await createPostgresAdapter({ url: "postgres://u@h/db", clientFactory: () => client });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const drop = adapter.transaction(async () => {
    await adapter.run("INSERT INTO t(v) VALUES(?)", ["drop"]);
    started();
    await gate;
    throw new Error("rollback");
  });
  await entered;
  const keep = adapter.transaction(() => adapter.run("INSERT INTO t(v) VALUES(?)", ["keep"]));
  release();
  const results = await Promise.allSettled([drop, keep]);
  expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
  expect(committed).toEqual(["keep"]);
  await adapter.close();
});

it("logs a failed connection name lookup once and returns account stats", async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "usage-a2261-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  delete global._dbAdapter;
  vi.resetModules();
  vi.doMock("@/lib/db/repos/connectionsRepo.js", async (importOriginal) => ({
    ...await importOriginal(),
    getProviderConnections: vi.fn().mockRejectedValue(new Error("lookup failed")),
  }));
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  const repo = await import("@/lib/db/repos/usageRepo.js");
  await repo.saveRequestUsage({ timestamp: new Date().toISOString(), provider: "fixture", model: "model", connectionId: "account-123", tokens: { prompt_tokens: 2, completion_tokens: 3 }, status: "ok" });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const stats = await repo.getUsageStats("all");
  expect(Object.values(stats.byAccount)).toEqual(expect.arrayContaining([expect.objectContaining({ connectionId: "account-123", requests: 1 })]));
  expect(warn.mock.calls.filter(([message]) => message === "[usageRepo] stats connection lookup failed"))
    .toEqual([["[usageRepo] stats connection lookup failed", "Error"]]);
});
