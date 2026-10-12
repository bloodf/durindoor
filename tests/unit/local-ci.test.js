import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  selectRiskFloor, validateSelection, testEnvironment, scopedTestArgs,
  validateTestReport, validateReceipt, terminateCommandGroup,
} from "../../scripts/local-ci.mjs";

const base = "a".repeat(40);
const head = "b".repeat(40);
const policySha256 = "c".repeat(64);
const runnerSha256 = "d".repeat(64);
const identity = { base, head, policySha256, runnerSha256 };
const translatorTests = ["translator/bugs-openai-bridge.test.js", "unit/media-routes.test.js"];
const inventory = [...translatorTests, "unit/local-ci.test.js"];
const callers = ["unit/media-routes.test.js", "unit/media-routes-api.test.js", "unit/media-routes-handlers.test.js",
  "unit/native-provider.test.js", "unit/gemini-native-endpoint.test.js", "unit/tool-result-missing-id-3362.test.js",
  "unit/stream-terminal-outcome.test.js", "unit/claude-foreign-server-tool-chatcore.test.js",
  "unit/responses-explicit-stream-route.test.js", "unit/openai-responses-stream-tool-identity.test.js"];
const trustedInventory = [...new Set([...inventory, ...callers])];
const selection = { ...identity, reviewer: "independent-reviewer", tests: translatorTests };
const report = (file) => ({ success: true, testResults: [{ name: file, status: "passed", assertionResults: [{ status: "passed" }] }] });

describe("local CI frozen policy", () => {
  it("keeps unknown, security, dependency, and gate paths on the full checkpoint floor", () => {
    for (const changed of [[], ["new/unknown.js"], ["src/lib/crypto/columnCrypto.js"],
      ["src/app/api/v1/chat/route.js"], ["tests/vitest.config.js"], ["scripts/local-ci.mjs"],
      ["package-lock.json"], ["internal/docs/testing.mdx"], ["internal/docs/agent-workflow.md"],
      ["tests/translator/registerAll.js"], ["open-sse/translator/index.js"], ["docs/a.mdx", "src/lib/db/index.js"]]) {
      expect(selectRiskFloor(changed, inventory).mode).toBe("full");
    }
  });
  it("keeps translator callers and all translator tests mandatory, independent of reviewer selection", () => {
    const floor = selectRiskFloor(["open-sse/translator/request/claude-to-openai.js"], trustedInventory);
    expect(floor.mode).toBe("scoped");
    expect(floor.tests).toEqual([...new Set([...translatorTests, ...callers])].sort());
    expect(() => validateSelection(selection, identity, floor, trustedInventory)).toThrow(/mandatory/);
    expect(validateSelection({ ...selection, tests: floor.tests }, identity, floor, trustedInventory)).toEqual(floor.tests);
    expect(selectRiskFloor(["open-sse/translator/request/claude-to-openai.js"], inventory).mode).toBe("full");
    expect(selectRiskFloor(["tests/translator/removed.test.js"], trustedInventory, ["tests/translator/removed.test.js"]).mode).toBe("full");
  });
  it("requires exact reviewed identities, reviewer, and literal existing non-live test files", () => {
    const floor = { mode: "scoped", tests: translatorTests };
    for (const bad of [{ ...selection, head: base }, { ...selection, policySha256: runnerSha256 },
      { ...selection, runnerSha256: policySha256 }, { ...selection, reviewer: "" },
      { ...selection, tests: [...translatorTests, "../escape.test.js"] },
      { ...selection, tests: [...translatorTests, "unit/*.test.js"] },
      { ...selection, tests: [...translatorTests, "unit/no.test.js"] }]) {
      expect(() => validateSelection(bad, identity, floor, inventory)).toThrow();
    }
  });
  it("uses docs checks only for known documentation paths; website changes require full mode", () => {
    expect(selectRiskFloor(["docs/reference/api.mdx", "internal/docs/architecture.mdx"], inventory)).toEqual({ mode: "scoped", risk: "docs", tests: [] });
    expect(selectRiskFloor(["website/src/app/page.js"], inventory).mode).toBe("full");
    expect(selectRiskFloor(["AGENTS.md"], inventory).mode).toBe("full");
  });
  it("does not forward credentials, loader variables, or real provider opt-ins", () => {
    const env = testEnvironment({ PATH: "/bin", LANG: "C", GH_TOKEN: "publisher", GITHUB_TOKEN: "publisher",
      OPENAI_API_KEY: "provider", TYPESAFE_API_KEY: "provider", RUN_REAL: "1", NODE_OPTIONS: "--import evil",
      LD_PRELOAD: "evil", npm_config_registry: "evil", HTTP_PROXY: "evil" }, { HOME: "/private/home", DATA_DIR: "/private/data" });
    expect(env).toEqual({ PATH: "/bin", LANG: "C", HOME: "/private/home", DATA_DIR: "/private/data", CI: "true" });
  });
  it("forwards explicit selectors directly to Vitest, never the full-suite npm wrapper", () => {
    const args = scopedTestArgs("/private/tests", translatorTests);
    expect(args.slice(0, 4)).toEqual(["/private/tests/node_modules/vitest/vitest.mjs", "run", ...translatorTests]);
    expect(args).toContain("--maxWorkers=2");
    expect(args).toContain("--outputFile=/private/tests/.scoped-results.json");
    expect(args).not.toContain("test:ci");
  });
  it("kills background descendants even when command exits zero", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "gate-group-"));
    const marker = path.join(directory, "survived");
    const descendant = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad'), 500);`;
    const child = spawn(process.execPath, ["-e", `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:'ignore'}).unref();`],
      { detached: true, stdio: "ignore" });
    const code = await new Promise(resolve => child.once("close", resolve));
    expect(code).toBe(0);
    terminateCommandGroup(child.pid);
    await new Promise(resolve => setTimeout(resolve, 700));
    expect(existsSync(marker)).toBe(false);
  });
  it("executes selector argv and allowlisted environment in a real child; failed child never passes", () => {
    const tests = mkdtempSync(path.join(os.tmpdir(), "gate-child-"));
    mkdirSync(path.join(tests, "node_modules/vitest"), { recursive: true });
    const bin = path.join(tests, "node_modules/vitest/vitest.mjs");
    writeFileSync(bin, `import fs from 'node:fs'; import path from 'node:path';
      const selected = process.argv.slice(3).filter(x => !x.startsWith('--'));
      const forbidden = ['GH_TOKEN','GITHUB_TOKEN','OPENAI_API_KEY','TYPESAFE_API_KEY','RUN_REAL','NODE_OPTIONS'];
      if (forbidden.some(k => process.env[k])) process.exit(3);
      fs.writeFileSync('.scoped-results.json', JSON.stringify({success:true,testResults:selected.map(name => ({
        name:path.resolve(name),status:'passed',assertionResults:[{status:'passed'}]}))}));`);
    const env = testEnvironment({ ...process.env, GH_TOKEN: "publisher", OPENAI_API_KEY: "provider", RUN_REAL: "1" },
      { HOME: tests, DATA_DIR: path.join(tests, "data") });
    const started = Date.now();
    const child = spawnSync(process.execPath, scopedTestArgs(tests, translatorTests), { cwd: tests, env, timeout: 10000 });
    expect(child.status).toBe(0);
    expect(validateTestReport(path.join(tests, ".scoped-results.json"), started, child.status, child.signal, tests, translatorTests).tests).toBe(2);
    writeFileSync(bin, "process.exit(1);");
    const failed = spawnSync(process.execPath, scopedTestArgs(tests, translatorTests), { cwd: tests, env, timeout: 10000 });
    expect(() => validateTestReport(path.join(tests, ".scoped-results.json"), started, failed.status, failed.signal, tests, translatorTests)).toThrow();
  });
  it("rejects failed commands, stale reports, zero tests, and incomplete selected suites", () => {
    const tests = mkdtempSync(path.join(os.tmpdir(), "gate-report-"));
    const selected = ["unit/local-ci.test.js"];
    mkdirSync(path.join(tests, "unit"));
    const file = path.join(tests, ".scoped-results.json");
    const started = Date.now();
    writeFileSync(file, JSON.stringify(report(path.join(tests, selected[0]))));
    expect(validateTestReport(file, started, 0, null, tests, selected).tests).toBe(1);
    expect(() => validateTestReport(file, started, 1, null, tests, selected)).toThrow();
    expect(() => validateTestReport(file, started, 0, "SIGTERM", tests, selected)).toThrow();
    expect(() => validateTestReport(file, started, 0, null, tests, [...selected, "unit/missing.test.js"])).toThrow(/selected/);
    utimesSync(file, new Date(0), new Date(0));
    expect(() => validateTestReport(file, started, 0, null, tests, selected)).toThrow(/stale/);
    writeFileSync(file, JSON.stringify({ success: true, testResults: [] }));
    expect(() => validateTestReport(file, started, 0, null, tests, selected)).toThrow(/zero/);
    writeFileSync(file, JSON.stringify({ success: true, testResults: [{ ...report("x").testResults[0], assertionResults: [{ status: "pending" }] }] }));
    expect(() => validateTestReport(file, started, 0, null, tests, selected)).toThrow();
  });
  it("rejects stale receipts, SHA drift, changed toolchain, failed or missing required commands", () => {
    const expected = { ...identity, toolchainSha256: "e".repeat(64), selectionSha256: "f".repeat(64), requiredSteps: ["lint", "vitest-scoped"] };
    const receipt = { ...expected, status: "passed", endedAt: new Date().toISOString(),
      steps: expected.requiredSteps.map(id => ({ id, kind: "command", status: "passed", exitCode: 0, signal: null, logSha256: "1".repeat(64) })),
      reports: [{ sha256: "2".repeat(64), tests: 1 }] };
    expect(validateReceipt(receipt, expected)).toBe(true);
    for (const bad of [{ ...receipt, head: base }, { ...receipt, base: head },
      { ...receipt, policySha256: runnerSha256 }, { ...receipt, runnerSha256: policySha256 },
      { ...receipt, toolchainSha256: policySha256 }, { ...receipt, selectionSha256: policySha256 },
      { ...receipt, endedAt: new Date(0).toISOString() }, { ...receipt, reports: [] },
      { ...receipt, steps: [] }, { ...receipt, steps: [{ ...receipt.steps[0], exitCode: 1 }] }]) {
      expect(() => validateReceipt(bad, expected)).toThrow();
    }
  });
});
