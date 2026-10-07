import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), probe: vi.fn() }));
vi.mock("@/app/api/settings/database/route", () => ({ requireDatabaseDualAuth: mocks.auth }));
vi.mock("@/lib/db/cutover", () => ({ testConnection: mocks.probe }));
vi.mock("@/lib/db/driver", () => ({ getActiveEngine: () => "sqlite" }));
let dir;
let saved;
let route;
let env;
const request = (body = {}, query = "") => new Request(`http://localhost/api/settings/database/startup-env${query}`, { method: "POST", headers: { "content-type": "application/json", "x-9r-password": "dashboard" }, body: JSON.stringify(body) });
const candidate = { engine: "postgres", host: "db.example.com", port: 5432, database: "my database", user: "user%40@tenant", password: "p%40@ss:/?#", sslmode: "require" };

beforeEach(async () => {
  saved = { ...process.env };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-startup-api-"));
  process.env.DATA_DIR = dir;
  for (const key of ["DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) delete process.env[key];
  vi.resetModules();
  mocks.auth.mockReset().mockResolvedValue(true);
  mocks.probe.mockReset().mockResolvedValue({ ok: true, latencyMs: 4, serverVersion: "PostgreSQL 17" });
  route = await import("@/app/api/settings/database/startup-env/route.js");
  env = await import("@/lib/db/databaseEnvFile.js");
});
afterEach(() => { process.env = saved; fs.rmSync(dir, { recursive: true, force: true }); });

describe("startup database credentials", () => {
  it("rejects both mutations without dual-factor auth", async () => {
    mocks.auth.mockResolvedValue(false);
    expect((await route.POST(request(candidate))).status).toBe(401);
    expect((await route.DELETE(request())).status).toBe(401);
    expect(fs.existsSync(env.databaseEnvFilePath())).toBe(false);
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it("probes and writes encoded credentials while returning only safe fields", async () => {
    const response = await route.POST(request(candidate));
    expect(response.status).toBe(200);
    const stored = env.readDatabaseEnvFile();
    const url = new URL(stored.DURINDOOR_PG_URL);
    expect(decodeURIComponent(url.username)).toBe(candidate.user);
    expect(decodeURIComponent(url.password)).toBe(candidate.password);
    expect(decodeURIComponent(url.pathname.slice(1))).toBe(candidate.database);
    expect(mocks.probe).toHaveBeenCalledWith({ url: stored.DURINDOOR_PG_URL, sslmode: "require" });
    const body = await response.json();
    expect(body.restartRequired).toBe(true);
    expect(body.startupEnv.effective).toMatchObject({ host: candidate.host, user: candidate.user, database: candidate.database });
    expect(JSON.stringify(body)).not.toContain(candidate.password);
    expect(JSON.stringify(body)).not.toContain("postgresql://");
  });

  it("keeps stored password when omitted and supports explicit empty password", async () => {
    await route.POST(request(candidate));
    const { password: _password, ...draft } = candidate;
    void _password;
    await route.POST(request({ ...draft, host: "another.example.com" }));
    expect(decodeURIComponent(new URL(env.readDatabaseEnvFile().DURINDOOR_PG_URL).password)).toBe(candidate.password);
    await route.POST(request({ ...draft, password: "" }));
    expect(new URL(env.readDatabaseEnvFile().DURINDOOR_PG_URL).password).toBe("");
  });

  it("rejects failed or thrown probes without writing or exposing driver secrets", async () => {
    mocks.probe.mockResolvedValue({ ok: false, error: `bad ${candidate.password}` });
    const response = await route.POST(request(candidate));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(candidate.password);
    expect(fs.existsSync(env.databaseEnvFilePath())).toBe(false);
    mocks.probe.mockRejectedValue(new Error(candidate.password));
    expect((await route.POST(request(candidate))).status).toBe(400);
  });

  it("tests without saving and rejects invalid connection fields", async () => {
    const response = await route.POST(request(candidate, "?test=1"));
    expect(response.status).toBe(200);
    expect(fs.existsSync(env.databaseEnvFilePath())).toBe(false);
    for (const partial of [{ port: 0 }, { host: "host/path" }, { sslmode: "invalid" }, { user: "" }]) {
      expect((await route.POST(request({ ...candidate, ...partial }))).status).toBe(400);
    }
  });

  it("SQLite clears PG keys and remove restores inherited provenance without mutating runtime", async () => {
    process.env.DURINDOOR_PG_URL = "postgresql://env:original@environment/db";
    await route.POST(request(candidate));
    const response = await route.POST(request({ engine: "sqlite" }));
    expect(response.status).toBe(200);
    expect(env.readDatabaseEnvFile()).toEqual({ DURINDOOR_DATABASE_ENGINE: "sqlite" });
    expect(process.env.DURINDOOR_PG_URL).toContain("environment");
    const removed = await route.DELETE(request());
    expect(removed.status).toBe(200);
    const body = await removed.json();
    expect(body.startupEnv.exists).toBe(false);
    expect(body.startupEnv.keys.DURINDOOR_PG_URL.source).toBe("process");
    expect(body.restartRequired).toBe(true);
  });
});
