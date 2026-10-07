import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), probe: vi.fn() }));
vi.mock("@/app/api/settings/database/route", () => ({ requireDatabaseDualAuth: mocks.auth }));
vi.mock("@/lib/db/cutover", () => ({ testConnection: mocks.probe }));
let dir;
let savedEnv;
let savedAdapter;
let adapter;
let route;
let secrets;
let engine;
const target = { host: "db.example.com", port: "5432", database: "target database", user: "operator%40@tenant", password: "private%40:/?#", sslmode: "disable", persist: true };
const request = (body) => new Request("http://localhost/api/settings/database/test", { method: "POST", headers: { "content-type": "application/json", "x-9r-password": "dashboard" }, body: JSON.stringify(body) });

beforeEach(async () => {
  savedEnv = { ...process.env };
  savedAdapter = global._dbAdapter;
  delete global._dbAdapter;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-target-"));
  process.env.DATA_DIR = dir;
  for (const key of ["DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) delete process.env[key];
  vi.resetModules();
  mocks.auth.mockReset().mockResolvedValue(true);
  mocks.probe.mockReset().mockResolvedValue({ ok: true, latencyMs: 2, serverVersion: "PostgreSQL 17" });
  const driver = await import("@/lib/db/driver.js");
  adapter = await driver.getAdapter();
  route = await import("@/app/api/settings/database/test/route.js");
  secrets = await import("@/lib/db/secrets.js");
  engine = await import("@/app/api/settings/database/engine/route.js");
});
afterEach(async () => {
  await adapter?.close?.();
  global._dbAdapter = savedAdapter;
  process.env = savedEnv;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("SQLite PostgreSQL cutover target", () => {
  it("persists a tested target encrypted without selecting PostgreSQL startup or requiring a restart", async () => {
    const response = await route.POST(request(target));
    expect(response.status).toBe(200);
    const publicBody = await response.json();
    expect(publicBody.ok).toBe(true);
    expect(JSON.stringify(publicBody)).not.toContain(target.password);
    const url = new URL(await secrets.resolvePostgresSecret());
    expect(decodeURIComponent(url.password)).toBe(target.password);
    expect(decodeURIComponent(url.username)).toBe(target.user);
    expect(url.searchParams.get("sslmode")).toBe("disable");
    const row = await adapter.get("SELECT data FROM settings WHERE id = 1");
    const stored = JSON.parse(row.data);
    expect(stored.postgresUrl.v).toBe(1);
    expect(JSON.stringify(stored)).not.toContain(target.password);
    expect(stored.databaseEngine).not.toBe("postgres");
    expect(fs.existsSync(path.join(dir, "durindoor-database.env"))).toBe(false);
    const statusResponse = await engine.GET(new Request("http://localhost/api/settings/database/engine", { headers: { "x-9r-password": "dashboard" } }));
    expect(statusResponse.status).toBe(200);
    const status = await statusResponse.json();
    expect(status.activeEngine).toBe("sqlite");
    expect(status.startupEnv.effective).toMatchObject({ engine: "sqlite", host: target.host, user: target.user, database: target.database });
    expect(JSON.stringify(status)).not.toContain(target.password);
    expect(JSON.stringify(status)).not.toContain("postgresql://");
  });

  it("keeps a previous target intact on a rejected probe and redacts returned driver errors", async () => {
    await route.POST(request(target));
    const original = await secrets.resolvePostgresSecret();
    mocks.probe.mockResolvedValue({ ok: false, error: `Connection failed: ${target.password}` });
    const response = await route.POST(request({ ...target, host: "unreachable.example.com" }));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(target.password);
    expect(await secrets.resolvePostgresSecret()).toBe(original);
  });

  it("does not persist a probe-only request and retains the legacy URL API", async () => {
    const response = await route.POST(request({ url: "postgresql://operator:private@db.example.com/target", sslmode: "require", persist: false }));
    expect(response.status).toBe(200);
    expect(await secrets.readPostgresUrlFromSettings()).toBeNull();
  });

  it("rejects unauthorized or malformed targets without probing or persisting", async () => {
    mocks.auth.mockResolvedValue(false);
    expect((await route.POST(request(target))).status).toBe(401);
    mocks.auth.mockResolvedValue(true);
    expect((await route.POST(request({ ...target, host: "host/path" }))).status).toBe(400);
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(await secrets.readPostgresUrlFromSettings()).toBeNull();
  });
});
