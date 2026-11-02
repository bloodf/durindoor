import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { fullTestArgs, testEnvironment, terminateCommandGroup, validateTestReport } from "../../scripts/local-ci.mjs";

it("emits genuine progress, keeps failed JSON evidence and cleans workers after a real test timeout", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-ci-reporters-"));
  const tests = fileURLToPath(new URL("../", import.meta.url));
  const report = path.join(root, "report.json");
  const marker = path.join(root, "cleanup.json");
  const config = path.join(root, "vitest.config.mjs");
  const poolUrl = pathToFileURL(path.join(tests, "utils/trackedWorkers.js")).href;
  for (const name of ["home", "data", "tmp"]) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  fs.writeFileSync(config, 'export default { test: { globals: true, include: ["*.test.js"] } };\n');
  fs.writeFileSync(path.join(root, "progress.test.js"), `
    it("genuine completion marker", () => { expect(1).toBe(1); });
    it("intentional assertion failure", () => { expect(1).toBe(2); });
  `);
  fs.writeFileSync(path.join(root, "cleanup.test.js"), `
    import fs from "node:fs";
    import { createTrackedWorkers } from ${JSON.stringify(poolUrl)};
    const pool = createTrackedWorkers();
    let worker;
    afterEach(async () => {
      await pool.close();
      fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ size: pool.size, threadId: worker?.threadId }));
    });
    it("intentional test timeout", async () => {
      worker = pool.create("setInterval(() => {}, 1000)", { eval: true });
      await new Promise(() => {});
    }, 100);
    it("worker cleanup happened after timeout", () => {
      expect(pool.size).toBe(0);
      expect(worker.threadId).toBe(-1);
    });
  `);
  let child;
  let timer;
  let output = "";
  let genuineProgressBeforeExit = false;
  let expired = false;
  const startedAt = Date.now();
  try {
    child = spawn(process.execPath, [...fullTestArgs(tests, ["progress.test.js", "cleanup.test.js"], report),
      "--root", root, "--config", config], {
      cwd: root, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
      env: testEnvironment(process.env, { HOME: path.join(root, "home"), DATA_DIR: path.join(root, "data"), TMPDIR: path.join(root, "tmp") }),
    });
    const collect = (chunk) => {
      output += chunk.toString();
      if (output.includes("genuine completion marker") && child.exitCode === null) genuineProgressBeforeExit = true;
    };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    timer = setTimeout(() => {
      expired = true;
      if (process.platform === "win32") child.kill("SIGKILL");
      else terminateCommandGroup(child.pid);
    }, 10_000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    expect(expired, output).toBe(false);
    expect(code, output).toBe(1);
    expect(genuineProgressBeforeExit, output).toBe(true);
    const result = JSON.parse(fs.readFileSync(report, "utf8"));
    expect(result.numPassedTests).toBe(2);
    expect(result.numFailedTests).toBe(2);
    expect(JSON.parse(fs.readFileSync(marker, "utf8"))).toEqual({ size: 0, threadId: -1 });
    expect(() => validateTestReport(report, startedAt, code, null, root)).toThrow();
  } finally {
    clearTimeout(timer);
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32") child.kill("SIGKILL");
      else terminateCommandGroup(child.pid);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 12_000);
