import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as actualFs from "node:fs/promises";
import { access, appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const fsMocks = vi.hoisted(() => ({
  appendFile: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn()
}));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    promises: {
      ...original.promises,
      appendFile: fsMocks.appendFile,
      readFile: fsMocks.readFile,
      stat: fsMocks.stat
    }
  };
});

vi.mock("node:net", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    createConnection: ({ host }) => {
      const socket = new EventEmitter();
      socket.destroy = () => {};
      queueMicrotask(() => host === "fake-upstream"
        ? socket.emit("connect")
        : socket.emit("error", Object.assign(new Error("blocked by unit test"), { code: "ENETUNREACH" })));
      return socket;
    }
  };
});

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
let qaRuntime;
let qaRunDir;

beforeEach(() => {
  qaRuntime = undefined;
  qaRunDir = undefined;
  fsMocks.appendFile.mockImplementation((...args) => actualFs.appendFile(...args));
  fsMocks.readFile.mockImplementation((...args) => actualFs.readFile(...args));
  fsMocks.stat.mockImplementation((...args) => actualFs.stat(...args));
});

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
  if (qaRuntime) await qaRuntime.stop();
  if (qaRunDir) await rm(qaRunDir, { recursive: true, force: true });
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function startStorybookRuntime(workerId) {
  qaRunDir = path.join(RUNS_ROOT, `unit-audit-${workerId}-${Date.now()}`);
  await setValidAuthority();
  const storybookIndex = path.join(ROOT, "storybook-static/index.html");
  fsMocks.stat.mockImplementation((file, ...args) =>
    path.resolve(String(file)) === storybookIndex ? Promise.resolve({ isFile: () => true }) : actualFs.stat(file, ...args));
  fsMocks.readFile.mockImplementation((file, ...args) =>
    path.resolve(String(file)) === storybookIndex ? Promise.resolve(Buffer.from("<!doctype html>")) : actualFs.readFile(file, ...args));
  qaRuntime = await startQa({ runDir: qaRunDir, workerId, mode: "storybook" });
  return qaRuntime;
}

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

describe("contained QA network audit", () => {
  it("waits for an overlapping audit append before checking every completed event", async () => {
    const runtime = await startStorybookRuntime("partial-append");
    const auditPath = path.join(qaRunDir, "audit.jsonl");
    const originalAppendFile = fsMocks.appendFile.getMockImplementation();
    const readFile = fsMocks.readFile.getMockImplementation();
    let releaseAppend;
    let reportPartial;
    let reportReadCaptured;
    const appendReleased = new Promise((resolve) => { releaseAppend = resolve; });
    const partialWritten = new Promise((resolve) => { reportPartial = resolve; });
    const readCaptured = new Promise((resolve) => { reportReadCaptured = resolve; });

    fsMocks.readFile.mockImplementation(async (file, ...args) => {
      if (path.resolve(String(file)) !== auditPath) return readFile(file, ...args);
      const snapshot = await readFile(file, ...args);
      reportReadCaptured();
      return snapshot;
    });

    fsMocks.appendFile.mockImplementation(async (file, data, options) => {
      if (path.resolve(String(file)) !== auditPath || !String(data).includes("allow-runtime-origin")) {
        return originalAppendFile(file, data, options);
      }
      const midpoint = Math.floor(String(data).length / 2);
      await originalAppendFile(file, String(data).slice(0, midpoint), options);
      reportPartial();
      await appendReleased;
      await originalAppendFile(file, String(data).slice(midpoint), options);
    });

    const record = runtime.recordBrowserRequest({
      kind: "control",
      label: "allow-runtime-origin",
      ok: true,
      detail: { url: runtime.baseUrl }
    });
    await partialWritten;
    const audit = runtime.assertNoExternalEffects();
    await Promise.race([
      readCaptured,
      new Promise((resolve) => setTimeout(resolve, 25))
    ]);
    releaseAppend();

    await expect(Promise.all([record, audit])).resolves.toHaveLength(2);
    const events = (await actualFs.readFile(auditPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    expect(events.some((event) => event.label === "allow-runtime-origin")).toBe(true);
  });

  it("preserves a failed audit append as a fail-closed assertion", async () => {
    const runtime = await startStorybookRuntime("failed-append");
    // Already-complete probes would pass if a later failed write were forgotten.
    await runtime.recordBrowserRequest({
      kind: "control",
      label: "allow-runtime-origin",
      ok: true,
      detail: { url: runtime.baseUrl }
    });
    await runtime.assertNoExternalEffects();
    const originalAppendFile = fsMocks.appendFile.getMockImplementation();
    const writeFailure = new Error("audit append failed");
    fsMocks.appendFile.mockImplementation((file, data, options) =>
      String(data).includes("allow-runtime-origin")
        ? Promise.reject(writeFailure)
        : originalAppendFile(file, data, options));

    await expect(runtime.recordBrowserRequest({
      kind: "control",
      label: "allow-runtime-origin",
      ok: true,
      detail: { url: runtime.baseUrl }
    })).rejects.toBe(writeFailure);
    await expect(runtime.assertNoExternalEffects()).rejects.toBe(writeFailure);
    await expect(runtime.stop()).rejects.toBe(writeFailure);
    qaRuntime = undefined;
  });

  it("fails closed for an observed external network event", async () => {
    const runtime = await startStorybookRuntime("external-event");
    await runtime.recordBrowserRequest({
      kind: "network",
      label: "observed-external",
      ok: true,
      detail: { url: "https://example.invalid/resource" }
    });

    await expect(runtime.assertNoExternalEffects()).rejects.toThrow("external=1");
  });
  it("fails closed for a never-completed audit record", async () => {
    await startStorybookRuntime("unterminated-record");
    await appendFile(path.join(qaRunDir, "audit.jsonl"), "{\"kind\":");

    await expect(qaRuntime.assertNoExternalEffects()).rejects.toBeInstanceOf(SyntaxError);
  });

  it("fails closed for a newline-terminated malformed audit record", async () => {
    await startStorybookRuntime("malformed-record");
    await appendFile(path.join(qaRunDir, "audit.jsonl"), "not-json}\n");

    await expect(qaRuntime.assertNoExternalEffects()).rejects.toBeInstanceOf(SyntaxError);
  });
});
