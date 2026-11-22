import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let temp;
afterEach(() => { if (temp) rmSync(temp, { recursive: true, force: true }); });

it.skipIf(process.platform === "win32")("saves SQLite and tray runtime dependencies", () => {
  temp = mkdtempSync(path.join(tmpdir(), "durindoor-runtime-test-"));
  const bin = path.join(temp, "bin");
  const log = path.join(temp, "npm.log");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "npm"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_NPM_LOG"\n', { mode: 0o755 });
  const sqlite = path.resolve("../cli/hooks/sqliteRuntime.js");
  const tray = path.resolve("../cli/hooks/trayRuntime.js");
  const script = `require(${JSON.stringify(sqlite)}).ensureSqliteRuntime({ silent: true, installBetterSqlite: true }); require(${JSON.stringify(tray)}).ensureTrayRuntime({ silent: true });`;
  const result = spawnSync(process.execPath, ["-e", script], {
    env: { ...process.env, DATA_DIR: temp, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TEST_NPM_LOG: log }, encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  const calls = readFileSync(log, "utf8").trim().split("\n");
  for (const pkg of ["better-sqlite3@", "systray2@"]) {
    const call = calls.find((line) => line.includes(pkg));
    expect(call).toContain("--save-exact");
    expect(call).not.toContain("--no-save");
  }
});
