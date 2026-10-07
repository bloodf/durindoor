import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir;
let env;
let saved;
beforeEach(async () => {
  saved = { ...process.env };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-startup-"));
  process.env.DATA_DIR = dir;
  for (const key of ["DURINDOOR_DATABASE_ENGINE", "DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) delete process.env[key];
  vi.resetModules();
  env = await import("@/lib/db/databaseEnvFile.js");
});
afterEach(() => {
  process.env = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("managed database startup file", () => {
  it("reads only database keys, ignores comments, and tolerates missing files", () => {
    expect(env.readDatabaseEnvFile()).toEqual({});
    fs.writeFileSync(env.databaseEnvFilePath(), "# private config\nOTHER=ignored\nDURINDOOR_PG_URL=postgresql://u:p@host/db?x=a=b\nDURINDOOR_DATABASE_ENGINE=postgres\n");
    expect(env.readDatabaseEnvFile()).toEqual({ DURINDOOR_DATABASE_ENGINE: "postgres", DURINDOOR_PG_URL: "postgresql://u:p@host/db?x=a=b" });
  });

  it("overrides process values, preserves original provenance, and applies only at startup", () => {
    process.env.DURINDOOR_PG_URL = "postgresql://old:original@env/db";
    process.env.UNRELATED = "untouched";
    env.writeDatabaseEnvFile({ DURINDOOR_PG_URL: "postgresql://new:secret@file/db" });
    env.applyDatabaseEnvFile();
    env.applyDatabaseEnvFile();
    expect(process.env.DURINDOOR_PG_URL).toBe("postgresql://new:secret@file/db");
    expect(JSON.parse(process.env.DURINDOOR_DATABASE_ENV_SOURCE_JSON).DURINDOOR_PG_URL).toEqual({ source: "file", processValue: "postgresql://old:original@env/db" });
    expect(env.describeDatabaseEnv().keys.DURINDOOR_PG_URL).toEqual({ source: "file", hasFileValue: true, hasProcessValue: true });
    expect(JSON.stringify(env.describeDatabaseStartup())).not.toContain("secret");
    env.writeDatabaseEnvFile({ DURINDOOR_PG_URL: "postgresql://pending:next@pending/db" });
    env.applyDatabaseEnvFile();
    expect(process.env.DURINDOOR_PG_URL).toBe("postgresql://new:secret@file/db");
    expect(env.describeDatabaseStartup().effective.host).toBe("pending");
    expect(process.env.UNRELATED).toBe("untouched");
  });

  it("merges partial writes with owner-only permissions and removes null keys", () => {
    env.writeDatabaseEnvFile({ DURINDOOR_DATABASE_ENGINE: "postgres", DURINDOOR_PG_URL: "postgresql://u:p@h/db" });
    env.writeDatabaseEnvFile({ DURINDOOR_PG_SSLMODE: "require" });
    expect(fs.statSync(env.databaseEnvFilePath()).mode & 0o777).toBe(0o600);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    env.writeDatabaseEnvFile({ DURINDOOR_PG_URL: null });
    expect(env.readDatabaseEnvFile()).toEqual({ DURINDOOR_DATABASE_ENGINE: "postgres", DURINDOOR_PG_SSLMODE: "require" });
    expect(fs.readdirSync(dir)).toEqual(["durindoor-database.env"]);
  });

  it("selects managed SQLite despite inherited PostgreSQL variables", () => {
    process.env.DURINDOOR_PG_URL = "postgresql://u:p@env/db";
    process.env.DURINDOOR_PG_SSLMODE = "require";
    env.writeDatabaseEnvFile({ DURINDOOR_DATABASE_ENGINE: "sqlite" });
    env.applyDatabaseEnvFile();
    expect(process.env.DURINDOOR_DATABASE_ENGINE).toBe("sqlite");
    expect(Object.hasOwn(process.env, "DURINDOOR_PG_URL")).toBe(false);
    expect(Object.hasOwn(process.env, "DURINDOOR_PG_SSLMODE")).toBe(false);
    fs.rmSync(env.databaseEnvFilePath());
    expect(env.describeDatabaseStartup().effective.host).toBe("env");
    expect(env.describeDatabaseEnv().keys.DURINDOOR_PG_URL.source).toBe("process");
  });

  it("rejects newline injection without altering the existing file", () => {
    env.writeDatabaseEnvFile({ DURINDOOR_DATABASE_ENGINE: "sqlite" });
    expect(() => env.writeDatabaseEnvFile({ DURINDOOR_PG_URL: "host\nOTHER=bad" })).toThrow("Invalid database environment value");
    expect(env.readDatabaseEnvFile()).toEqual({ DURINDOOR_DATABASE_ENGINE: "sqlite" });
  });

  it.each(["sqlite", "postgres"])("keeps running %s selectors unchanged across module reloads and applies staged values only on restart", async (runningEngine) => {
    process.env.DURINDOOR_DATABASE_ENGINE = runningEngine;
    if (runningEngine === "postgres") {
      process.env.DURINDOOR_PG_URL = "postgresql://operator:original@db.example.com/live";
      process.env.DURINDOOR_PG_SSLMODE = "require";
    }
    env.applyDatabaseEnvFile();
    const sourceSnapshot = process.env.DURINDOOR_DATABASE_ENV_SOURCE_JSON;
    const pending = runningEngine === "postgres"
      ? { DURINDOOR_DATABASE_ENGINE: "sqlite", DURINDOOR_PG_URL: null, DURINDOOR_PG_SSLMODE: null }
      : { DURINDOOR_DATABASE_ENGINE: "postgres", DURINDOOR_PG_URL: "postgresql://operator:pending@pending.example.com/next", DURINDOOR_PG_SSLMODE: "verify-full" };
    env.writeDatabaseEnvFile(pending);
    vi.resetModules();
    const reloaded = await import("@/lib/db/databaseEnvFile.js");
    reloaded.applyDatabaseEnvFile();
    expect(process.env.DURINDOOR_DATABASE_ENGINE).toBe(runningEngine);
    expect(process.env.DURINDOOR_PG_URL).toBe(runningEngine === "postgres" ? "postgresql://operator:original@db.example.com/live" : undefined);
    expect(process.env.DURINDOOR_PG_SSLMODE).toBe(runningEngine === "postgres" ? "require" : undefined);
    expect(process.env.DURINDOOR_DATABASE_ENV_SOURCE_JSON).toBe(sourceSnapshot);
    delete process.env.DURINDOOR_DATABASE_ENV_SOURCE_JSON;
    vi.resetModules();
    const restarted = await import("@/lib/db/databaseEnvFile.js");
    restarted.applyDatabaseEnvFile();
    expect(process.env.DURINDOOR_DATABASE_ENGINE).toBe(pending.DURINDOOR_DATABASE_ENGINE);
    expect(process.env.DURINDOOR_PG_URL).toBe(pending.DURINDOOR_PG_URL ?? undefined);
    expect(process.env.DURINDOOR_PG_SSLMODE).toBe(pending.DURINDOOR_PG_SSLMODE ?? undefined);
  });

  it("prefills a target without changing the stored engine selection and honors explicit overrides", () => {
    const url = "postgresql://operator:private@db.example.com/target";
    expect(env.describeDatabaseStartup(url, "sqlite").effective).toMatchObject({ engine: "sqlite", host: "db.example.com", database: "target", user: "operator" });
    expect(env.describeDatabaseStartup(url, "postgres").effective.engine).toBe("postgres");
    process.env.DURINDOOR_PG_URL = url;
    expect(env.describeDatabaseStartup(undefined, "sqlite").effective.engine).toBe("sqlite");
    process.env.DURINDOOR_DATABASE_ENGINE = "postgres";
    expect(env.describeDatabaseStartup(url, "sqlite").effective.engine).toBe("postgres");
    env.writeDatabaseEnvFile({ DURINDOOR_DATABASE_ENGINE: "sqlite" });
    expect(env.describeDatabaseStartup(url, "postgres").effective.engine).toBe("sqlite");
    expect(JSON.stringify(env.describeDatabaseStartup(url, "sqlite"))).not.toContain("private");
  });
});
