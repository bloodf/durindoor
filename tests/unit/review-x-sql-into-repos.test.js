import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-repos-"));
const previous = process.env.DATA_DIR;
let db, repo, GET;
beforeAll(async () => {
  process.env.DATA_DIR = dir;
  await (await import("@/lib/db/index.js")).initDb();
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  repo = await import("@/lib/db/repos/reportQueriesRepo.js");
  ({ GET } = await import("@/app/api/usage/combos/route.js"));
});
afterAll(() => {
  if (previous === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

it("keeps the four callers free of SQL statements", () => {
  for (const file of ["src/app/api/usage/combos/route.js", "src/lib/dataRetention/runner.js", "src/lib/apiKeyLimits.js", "src/sse/handlers/video.js"]) {
    expect(fs.readFileSync(path.resolve(process.cwd(), "..", file), "utf8")).not.toMatch(/\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i);
  }
});

it("runs the moved queries and sorts combo names without regard to case", async () => {
  const insert = (id, name) => db.run("INSERT INTO usageHistory(timestamp, comboId, comboName, promptTokens, completionTokens, cost) VALUES(?, ?, ?, ?, ?, ?)", ["2026-01-01T00:00:00.000Z", id, name, 2, 1, 0.5]);
  insert("1", "Zebra"); insert("2", "apple"); insert(null, null);
  const result = await repo.getComboUsageReport({ lower: null, upper: new Date("2027-01-01"), upperExclusive: true });
  expect(result.groups.map((row) => row.comboName)).toEqual(["apple", "Zebra"]);
  expect(Number(result.unattributed.requests)).toBe(1);
  const response = await GET(new Request("http://localhost/api/usage/combos?period=all"));
  expect((await response.json()).rows.map((row) => row.comboName)).toEqual(["apple", "Zebra"]);
  await repo.saveRetentionLastRun({ days: 7 });
  await repo.saveRetentionLastRun({ days: 30 });
  expect(await repo.getRetentionLastRun()).toEqual({ days: 30 });
  db.run("INSERT INTO apiKeys(id, key, name, machineId, createdAt) VALUES(?, ?, ?, ?, ?)", ["key-id", "secret", "name", "machine", "2026-01-01"]);
  expect(repo.findApiKeyIdSync("secret")).toBe("key-id");
  expect(repo.findApiKeyIdSync("missing")).toBeNull();
  await expect(repo.assertVideoBillingEpoch(null)).resolves.toBeUndefined();
});
