// Offline checks for scripts/test-postgres-fencing.mjs. No PostgreSQL server
// or container runtime is used: these prove the runner refuses to pass by
// skipping and hands Vitest only an allowlisted environment.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  FENCING_TEST_FILE,
  REQUIRED_FENCING_TESTS,
  assertFencingReport,
  buildFencingRun,
  fencingDatabaseUrl,
} from "../../scripts/test-postgres-fencing.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const runner = path.join(repo, "scripts/test-postgres-fencing.mjs");
const syntheticUrl = "postgres://synthetic:synthetic@127.0.0.1:1/postgres";
const workDirs = [];

function workDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-fencing-runner-test-"));
  workDirs.push(dir);
  return dir;
}

function report(status = "passed", names = REQUIRED_FENCING_TESTS) {
  return {
    success: status === "passed",
    testResults: [{ assertionResults: names.map((fullName) => ({ fullName, status })) }],
  };
}

afterEach(() => {
  for (const dir of workDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("PostgreSQL fencing runner", () => {
  it("requires a postgres URL", () => {
    expect(() => fencingDatabaseUrl({})).toThrow(/DURINDOOR_TEST_PG_URL is required/);
    expect(() => fencingDatabaseUrl({ DURINDOOR_TEST_PG_URL: "" })).toThrow(/is required/);
    expect(() => fencingDatabaseUrl({ DURINDOOR_TEST_PG_URL: "not a url" })).toThrow(/not a valid URL/);
    expect(() => fencingDatabaseUrl({ DURINDOOR_TEST_PG_URL: "mysql://u@h/db" })).toThrow(/postgres/);
    expect(fencingDatabaseUrl({ DURINDOOR_TEST_PG_URL: syntheticUrl })).toBe(syntheticUrl);
  });

  it("runs only the fencing file with an allowlisted environment", () => {
    const dir = workDir();
    const parent = {
      PATH: "/synthetic/bin:/usr/bin",
      HOME: "/home/caller",
      DATA_DIR: "/home/caller/.9router",
      DURINDOOR_TEST_PG_URL: syntheticUrl,
      DOCKER_HOST: "unix:///run/docker.sock",
      DOCKER_CONTEXT: "default",
      DOCKER_CONFIG: "/home/caller/.docker",
      CONTAINER_HOST: "unix:///run/podman/podman.sock",
      DATABASE_URL: "postgres://prod:secret@db.example/prod",
      DURINDOOR_CAPTURE_TEST_PG_URL: "postgres://other@127.0.0.1/other",
      AWS_SECRET_ACCESS_KEY: "synthetic-secret",
      GITHUB_TOKEN: "synthetic-token",
      NODE_OPTIONS: "--require /tmp/evil.cjs",
    };
    const run = buildFencingRun({ env: parent, workDir: dir, root: repo });
    expect(run.command).toBe(process.execPath);
    expect(run.cwd).toBe(path.join(repo, "tests"));
    expect(run.args[0]).toBe(path.join(repo, "tests/node_modules/vitest/vitest.mjs"));
    expect(run.args.slice(1, 3)).toEqual(["run", FENCING_TEST_FILE]);
    expect(run.args.filter((arg) => arg.endsWith(".test.js"))).toEqual([FENCING_TEST_FILE]);
    expect(run.args.some((arg) => /passWithNoTests|--bail|-t$|--testNamePattern|--skip/.test(arg))).toBe(false);
    expect(run.reportFile.startsWith(dir + path.sep)).toBe(true);
    expect(run.env).toEqual({
      PATH: parent.PATH,
      HOME: path.join(dir, "home"),
      DATA_DIR: path.join(dir, "data"),
      TMPDIR: path.join(dir, "tmp"),
      CI: "true",
      NODE_ENV: "test",
      DURINDOOR_TEST_PG_URL: syntheticUrl,
      DURINDOOR_TEST_PG_REQUIRED: "1",
    });
    expect(() => buildFencingRun({ env: { PATH: parent.PATH }, workDir: dir, root: repo })).toThrow(/is required/);
  });

  it("rejects skipped, failed, missing or unsuccessful fencing reports", () => {
    expect(assertFencingReport(report())).toBe(REQUIRED_FENCING_TESTS.length);
    expect(() => assertFencingReport(report("skipped"))).toThrow(/not passed/);
    expect(() => assertFencingReport(report("pending"))).toThrow(/not passed/);
    expect(() => assertFencingReport(report("failed"))).toThrow(/not passed/);
    expect(() => assertFencingReport(report("passed", REQUIRED_FENCING_TESTS.slice(1)))).toThrow(/missing/);
    expect(() => assertFencingReport({ success: true, testResults: [] })).toThrow(/missing/);
    expect(() => assertFencingReport({ ...report(), success: false })).toThrow(/not successful/);
    const extraSkip = report();
    extraSkip.testResults.push({ assertionResults: [{ fullName: "extra", status: "skipped" }] });
    expect(() => assertFencingReport(extraSkip)).toThrow(/extra \[skipped\]/);
  });

  it("exits non-zero without a URL before starting Vitest", () => {
    const child = spawnSync(process.execPath, [runner], {
      env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 30_000,
    });
    expect(child.status).toBe(1);
    expect(child.stderr).toMatch(/DURINDOOR_TEST_PG_URL is required/);
  });

  it("fails suite collection in required mode when the URL is absent", () => {
    const dir = workDir();
    const run = buildFencingRun({ env: { PATH: process.env.PATH, DURINDOOR_TEST_PG_URL: syntheticUrl }, workDir: dir, root: repo });
    const { DURINDOOR_TEST_PG_URL: _omitted, ...env } = run.env;
    for (const sub of [env.HOME, env.DATA_DIR, env.TMPDIR]) fs.mkdirSync(sub, { recursive: true });
    const child = spawnSync(run.command, run.args, { cwd: run.cwd, env, encoding: "utf8", timeout: 90_000 });
    expect(child.status).toBe(1);
    expect(`${child.stdout}${child.stderr}`).toMatch(/refusing to skip PostgreSQL fencing coverage/);
    const result = JSON.parse(fs.readFileSync(run.reportFile, "utf8"));
    expect(result.success).toBe(false);
    expect(result.testResults.flatMap((suite) => suite.assertionResults)
      .filter((test) => test.status === "passed" || test.status === "skipped")).toEqual([]);
  }, 120_000);

  it("fails rather than skips when the supplied cluster is unreachable", () => {
    const child = spawnSync(process.execPath, [runner], {
      env: { PATH: process.env.PATH, DURINDOOR_TEST_PG_URL: syntheticUrl }, encoding: "utf8", timeout: 120_000,
    });
    expect(child.status).toBe(1);
    expect(child.stderr).toMatch(/PostgreSQL fencing failed: PostgreSQL fencing tests not passed/);
    expect(child.stderr).not.toMatch(/synthetic:synthetic/);
  }, 150_000);
});
