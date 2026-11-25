import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

let dir, repo, db;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-identity-"));
  vi.stubEnv("DATA_DIR", dir);
  delete global._dbAdapter;
  vi.resetModules();
  repo = await import("@/lib/db/repos/usageRepo.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
});
afterEach(async () => {
  vi.useRealTimers();
  global._dbAdapter?.instance?.close();
  delete global._dbAdapter;
  await disposeLoadedRequestDetailsRepo();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

it("rebuilds recent-reset last-seen rows with stable key identities", async () => {
  db.run("INSERT INTO apiKeys(id, key, name, createdAt) VALUES (?, ?, ?, ?)", ["key-id", "secret", "Key", "2026-09-19"]);
  for (const timestamp of ["2026-09-20T10:00:00.000Z", "2026-09-20T11:50:00.000Z"]) {
    await repo.saveRequestUsage({ timestamp, apiKey: "secret", apiKeyId: "key-id", provider: "fixture", model: "model", cost: 0, tokens: { prompt_tokens: 1 }, strict: true });
  }
  await repo.resetUsageHistory("1h");
  expect(db.all("SELECT apiKey, lastUsed FROM usageLastSeen")).toEqual([{ apiKey: "key-id", lastUsed: "2026-09-20T10:00:00.000Z" }]);
});

it("labels recent requests by their recorded key id after rotation", async () => {
  db.run("INSERT INTO apiKeys(id, key, name, createdAt) VALUES (?, ?, ?, ?)", ["key-id", "old-secret", "Key", "2026-09-19"]);
  await repo.saveRequestUsage({ timestamp: "2026-09-20T11:00:00.000Z", apiKey: "old-secret", apiKeyId: "key-id", provider: "fixture", model: "model", cost: 0, tokens: { prompt_tokens: 1 }, strict: true });
  db.run("UPDATE apiKeys SET key = ? WHERE id = ?", ["new-secret", "key-id"]);
  const stats = await repo.getUsageStats("all");
  expect(stats.recentRequests[0]).toMatchObject({ apiKeyId: "api-key:key-id", keyName: "Key" });
});
