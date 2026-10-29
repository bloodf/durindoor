import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), settings: vi.fn(), activeEngine: vi.fn(), secret: vi.fn(), probe: vi.fn() }));
vi.mock("@/app/api/settings/database/route", () => ({ requireDatabaseDualAuth: mocks.auth }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: mocks.settings, getSettingsSync: vi.fn(), updateSettings: vi.fn() }));
vi.mock("@/lib/db/driver", () => ({ getActiveEngine: mocks.activeEngine }));
vi.mock("@/lib/db/secrets", () => ({ resolvePostgresSecret: mocks.secret }));
vi.mock("@/lib/db/dialects/postgres/snapshot", () => ({ listSnapshots: () => [] }));
vi.mock("@/lib/db/cutover", () => ({ testConnection: mocks.probe }));
let directory;
let savedEnv;
let env;
let route;
let startup;
const url = "postgresql://operator:private-password@db.example.com/database";
const runtimeKeys = ["DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"];
const request = () => new Request("http://localhost/api/settings/database/engine", { headers: { "x-9r-password": "dashboard" } });

beforeEach(async () => {
  savedEnv = { ...process.env };
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "dd-engine-status-"));
  process.env.DATA_DIR = directory;
  for (const key of runtimeKeys) delete process.env[key];
  vi.resetModules();
  mocks.auth.mockReset().mockResolvedValue(true);
  mocks.settings.mockReset();
  mocks.activeEngine.mockReset();
  mocks.secret.mockReset().mockResolvedValue(null);
  mocks.probe.mockReset().mockResolvedValue({ ok: true, latencyMs: 2, serverVersion: "PostgreSQL 17" });
  env = await import("@/lib/db/databaseEnvFile.js");
  route = await import("@/app/api/settings/database/engine/route.js");
  startup = await import("@/app/api/settings/database/startup-env/route.js");
});
afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(directory, { recursive: true, force: true });
});

function boot(mode) {
  let activeEngine = "sqlite";
  let databaseEngine = "postgres";
  let databaseEngineError = null;
  if (mode === "environment-postgres") {
    process.env.DURINDOOR_PG_URL = url;
    activeEngine = "postgres";
    databaseEngine = "sqlite";
    mocks.secret.mockResolvedValue(url);
  } else if (mode === "managed-sqlite") {
    process.env.DURINDOOR_DATABASE_ENGINE = "postgres";
    process.env.DURINDOOR_PG_URL = url;
    env.writeDatabaseEnvFile({ DURINDOOR_DATABASE_ENGINE: "sqlite" });
  } else if (mode === "healthy-legacy-postgres") {
    activeEngine = "postgres";
    mocks.secret.mockResolvedValue(url);
  } else {
    databaseEngineError = "PG boot failed: connection refused";
  }
  env.applyDatabaseEnvFile();
  mocks.activeEngine.mockReturnValue(activeEngine);
  mocks.settings.mockResolvedValue({ databaseEngine, databaseEngineError, databasePgVersion: 18, databasePgFeatures: {} });
  return activeEngine;
}

async function status() {
  const response = await route.GET(request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(JSON.stringify(body)).not.toContain("private-password");
  expect(JSON.stringify(body)).not.toContain("postgresql://");
  return body;
}

describe("running database fallback status", () => {
  it.each([
    ["environment-postgres", false],
    ["managed-sqlite", false],
    ["healthy-legacy-postgres", false],
    ["legacy-fallback", true],
  ])("reports the real runtime state for %s instead of treating every settings mismatch as fallback", async (mode, expectedFallback) => {
    const activeEngine = boot(mode);
    const body = await status();
    expect(body.activeEngine).toBe(activeEngine);
    expect(body.servingFallback).toBe(expectedFallback);
    if (mode === "environment-postgres") {
      expect(body.databaseEngine).toBe("sqlite");
      expect(body.startupEnv.effective.engine).toBe("postgres");
      expect(body.startupEnv.keys.DURINDOOR_PG_URL.source).toBe("process");
    }
    if (mode === "managed-sqlite") {
      expect(body.databaseEngine).toBe("postgres");
      expect(body.startupEnv.effective.engine).toBe("sqlite");
      expect(Object.hasOwn(process.env, "DURINDOOR_PG_URL")).toBe(false);
    }
  });

  it.each([
    ["environment-postgres", "sqlite", false],
    ["managed-sqlite", "postgres", false],
    ["legacy-fallback", "postgres", true],
  ])("staging %s startup as %s does not switch or reinterpret the running adapter", async (mode, pendingEngine, expectedFallback) => {
    const activeEngine = boot(mode);
    const running = Object.fromEntries(runtimeKeys.map((key) => [key, process.env[key]]));
    const candidate = { engine: pendingEngine, host: "pending.example.com", port: "5432", database: "pending", user: "operator", password: "private-password", sslmode: "require" };
    const response = await startup.POST(new Request("http://localhost/api/settings/database/startup-env", { method: "POST", headers: { "content-type": "application/json", "x-9r-password": "dashboard" }, body: JSON.stringify(candidate) }));
    expect(response.status).toBe(200);
    expect((await response.json()).restartRequired).toBe(true);
    const body = await status();
    expect(body.activeEngine).toBe(activeEngine);
    expect(body.servingFallback).toBe(expectedFallback);
    expect(body.startupEnv.effective.engine).toBe(pendingEngine);
    expect(Object.fromEntries(runtimeKeys.map((key) => [key, process.env[key]]))).toEqual(running);
  });
});
