import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUNS_ROOT = path.join(ROOT, "qa/runs");
const RUNTIME = path.join(ROOT, "tests/e2e/runtime.mjs");
const { AUTHORITY_KIND, startQa } = await import(pathToFileURL(RUNTIME).href);
const ENV_KEYS = [
  "DURIN_QA_HARDENED",
  "DURIN_QA_AUTHORITY_MANIFEST",
  "DURIN_QA_DB_HOST",
  "DATABASE_URL",
  "DOCKER_HOST"
];

let tempDir;
let originalEnv;

function expectMissing(file) {
  return expect(access(file)).rejects.toMatchObject({ code: "ENOENT" });
}

async function setValidAuthority() {
  const manifestPath = path.join(tempDir, "authority.json");
  await writeFile(manifestPath, JSON.stringify({
    kind: AUTHORITY_KIND,
    version: 1,
    createdAt: new Date().toISOString()
  }));
  process.env.DURIN_QA_HARDENED = "1";
  process.env.DURIN_QA_AUTHORITY_MANIFEST = manifestPath;
  return manifestPath;
}

beforeEach(async () => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  tempDir = await mkdtemp(path.join(os.tmpdir(), "durindoor-ui-qa-unit-"));
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  await rm(tempDir, { recursive: true, force: true });
});

describe("contained QA runtime guard rails", () => {
  it("refuses an unsafe launcher before creating its requested run directory", async () => {
    const runDir = path.join(RUNS_ROOT, `unit-unsafe-${Date.now()}`);

    await expect(startQa({ runDir, workerId: 1, mode: "app" })).rejects.toThrow(
      "refuses to run outside hardened QA container"
    );
    await expectMissing(runDir);
  });

  it("refuses host authority configuration before reading probes or starting processes", async () => {
    const runDir = path.join(RUNS_ROOT, `unit-host-config-${Date.now()}`);
    await setValidAuthority();
    process.env.DOCKER_HOST = "unix:///var/run/docker.sock";

    await expect(startQa({ runDir, workerId: 2, mode: "app" })).rejects.toThrow(
      "refuses host database or Docker configuration"
    );
    await expectMissing(runDir);
  });

  it("rejects an invalid authority marker before creating runtime artifacts", async () => {
    const runDir = path.join(RUNS_ROOT, `unit-bad-authority-${Date.now()}`);
    const manifestPath = path.join(tempDir, "authority.json");
    await writeFile(manifestPath, JSON.stringify({ kind: "wrong", version: 1, createdAt: "now" }));
    process.env.DURIN_QA_HARDENED = "1";
    process.env.DURIN_QA_AUTHORITY_MANIFEST = manifestPath;

    await expect(startQa({ runDir, workerId: 3, mode: "app" })).rejects.toThrow("authority manifest invalid");
    await expectMissing(runDir);
  });

  it("rejects unsupported modes before allocating run artifacts or probing network", async () => {
    const runDir = path.join(RUNS_ROOT, `unit-mode-${Date.now()}`);
    await setValidAuthority();

    await expect(startQa({ runDir, workerId: 4, mode: "unknown" })).rejects.toThrow("mode must be app or storybook");
    await expectMissing(runDir);
  });

  it("refuses run paths outside qa/runs before allocating artifacts or probing network", async () => {
    const runDir = path.join(tempDir, "escape");
    await setValidAuthority();

    await expect(startQa({ runDir, workerId: 5, mode: "app" })).rejects.toThrow("run directory escapes qa/runs");
    await expectMissing(runDir);
  });
});
