import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { MAX_ATTRIBUTION_VALUES, usageAttributionFromHeaders } from "../../src/lib/usageAttribution.js";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/sse/services/auth.js", () => ({ resolveClientApiKey: authMock }));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-1131-"));
process.env.DATA_DIR = dir;
let db, repo, route;
beforeAll(async () => {
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  repo = await import("@/lib/db/repos/usageRepo.js");
  route = await import("../../src/app/api/v1/me/sessions/route.js");
  db.run("INSERT INTO apiKeys(id, key, createdAt) VALUES (?, ?, ?), (?, ?, ?)", ["a", "secret-a", "2026-01-01", "b", "secret-b", "2026-01-01"]);
});
afterAll(() => { global._dbAdapter?.instance?.close(); delete global._dbAdapter; fs.rmSync(dir, { recursive: true, force: true }); });
const save = (key, sessionId, projectId, tokens = 3) => repo.saveRequestUsage({ apiKeyId: key, apiKey: `secret-${key}`, provider: "test", model: "test", tokens: { prompt_tokens: tokens, completion_tokens: 0 }, cost: 0, usageAttribution: { sessionId, projectId }, strict: true });
const req = (query = "") => new Request(`http://localhost/v1/me/sessions${query}`);

it("validates header values and rejects duplicate values", () => {
  expect(usageAttributionFromHeaders(new Headers({ "x-durindoor-session-id": "s-1", "x-durindoor-project-id": "team/project" }))).toEqual({ sessionId: "s-1", projectId: "team/project" });
  const headers = new Headers(); headers.append("x-durindoor-session-id", "one"); headers.append("x-durindoor-session-id", "two"); headers.set("x-durindoor-project-id", "x".repeat(129));
  expect(usageAttributionFromHeaders(headers)).toEqual({ sessionId: null, projectId: null });
  expect(usageAttributionFromHeaders(new Headers({ "x-durindoor-session-id": "a b" })).sessionId).toBeNull();
});
it("returns only the authenticated key's usage even when labels match", async () => {
  await save("a", "shared", "project", 3); await save("b", "shared", "project", 8);
  authMock.mockResolvedValue({ auth: { ok: true, stored: true, apiKeyId: "a" } });
  let response = await route.GET(req("?keyId=b"));
  expect(response.status).toBe(200);
  expect((await response.json()).sessions).toMatchObject([{ sessionId: "shared", projectId: "project", requests: 1, promptTokens: 3 }]);
  authMock.mockResolvedValue({ auth: { ok: true, stored: true, apiKeyId: "b" } });
  expect((await (await route.GET(req())).json()).sessions).toMatchObject([{ sessionId: "shared", promptTokens: 8 }]);
  for (const auth of [{ ok: true, stored: false, operator: true }, { ok: false }]) { authMock.mockResolvedValue({ auth }); response = await route.GET(req()); expect(response.status).toBe(401); }
});
it("bounds report limits", async () => {
  authMock.mockResolvedValue({ auth: { ok: true, stored: true, apiKeyId: "a" } });
  for (const query of ["?limit=0", "?limit=101", "?limit=1&limit=2", "?limit=1.5"]) expect((await route.GET(req(query))).status).toBe(400);
  expect((await route.GET(req("?limit=1"))).status).toBe(200);
});
it("caps labels per key without dropping usage and permits existing values", async () => {
  for (let i = 0; i < MAX_ATTRIBUTION_VALUES - 1; i++) db.run("INSERT INTO usageHistory(timestamp, apiKeyId, usageSessionId, usageProjectId) VALUES (?, ?, ?, ?)", ["2026-01-01T00:00:00.000Z", "a", `session-${i}`, `project-${i}`]);
  await save("a", "overflow", "overflow-project"); await save("a", "shared", "project");
  expect(db.all("SELECT usageSessionId, usageProjectId FROM usageHistory WHERE apiKeyId = ? ORDER BY id DESC LIMIT 2", ["a"])).toEqual([{ usageSessionId: "shared", usageProjectId: "project" }, { usageSessionId: null, usageProjectId: null }]);
  await save("b", "overflow", "overflow-project");
  expect(db.get("SELECT usageSessionId FROM usageHistory WHERE apiKeyId = ? ORDER BY id DESC LIMIT 1", ["b"]).usageSessionId).toBe("overflow");
  await save("b", "bad value", "x".repeat(129));
  expect(db.get("SELECT usageSessionId, usageProjectId FROM usageHistory WHERE apiKeyId = ? ORDER BY id DESC LIMIT 1", ["b"])).toEqual({ usageSessionId: null, usageProjectId: null });
});
it("authenticates real stored credentials before selecting their report", async () => {
  const { resolveClientApiKey } = await vi.importActual("@/sse/services/auth.js");
  authMock.mockImplementation(resolveClientApiKey);
  const response = await route.GET(new Request("http://localhost/v1/me/sessions?keyId=b", { headers: { authorization: "Bearer secret-a" } }));
  expect(response.status).toBe(200);
  const { sessions } = await response.json();
  expect(sessions.find((row) => row.sessionId === "shared").promptTokens).toBe(6);
  const denied = await route.GET(new Request("http://localhost/v1/me/sessions", { headers: { authorization: "Bearer invalid" } }));
  expect(denied.status).toBe(401);
});
it("adds nullable attribution columns to old history idempotently", async () => {
  const { createBetterSqliteAdapter } = await import("@/lib/db/adapters/betterSqliteAdapter.js");
  const migration = (await import("@/lib/db/migrations/031-usage-session-attribution.js")).default;
  const legacy = createBetterSqliteAdapter(path.join(dir, "legacy.sqlite"));
  try {
    legacy.exec("CREATE TABLE usageHistory (id INTEGER PRIMARY KEY, apiKeyId TEXT, timestamp TEXT)");
    legacy.run("INSERT INTO usageHistory(apiKeyId, timestamp) VALUES (?, ?)", ["a", "2026-01-01"]);
    migration.up(legacy); migration.up(legacy);
    expect(legacy.get("SELECT usageSessionId, usageProjectId FROM usageHistory")).toEqual({ usageSessionId: null, usageProjectId: null });
    expect(legacy.all("PRAGMA index_list(usageHistory)").map((row) => row.name)).toEqual(expect.arrayContaining(["idx_uh_key_session", "idx_uh_key_project"]));
  } finally { legacy.close(); }
});
it("includes project-only attribution in the authenticated report", async () => {
  await save("b", null, "project-only", 5);
  expect((await repo.listKeyUsageSessions("b")).find((row) => row.projectId === "project-only"))
    .toMatchObject({ sessionId: null, promptTokens: 5 });
});
