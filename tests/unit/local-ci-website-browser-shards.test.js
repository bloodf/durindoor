import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  WEBSITE_BROWSER_SHARD_COUNT,
  websiteBrowserAvailable,
  requiredWebsiteCoverageStep,
  requiresWebsiteBuild,
  collectWebsiteBrowserInventory,
  extractPlaywrightTests,
  selectWebsiteBrowserShards,
  testEnvironment,
  validateWebsiteBrowserShardReport,
  verifyWebsiteBrowserCoverage,
  websiteBrowserInventoryCommand,
  websiteBrowserShardCommands,
} from "../../scripts/local-ci.mjs";

function makeSpec(file, title, { id = `${file}-${title}`, ok = true, status = "expected", results = [{ status: "passed" }], projectId = "" } = {}) {
  return {
    title,
    file,
    id,
    ok,
    tests: [{ projectId, projectName: projectId, status, expectedStatus: "passed", results }],
  };
}

function makeReport({ suites = [], errors = [], testMatch = ["docs.spec.mjs", "marketing.spec.mjs", "public-verification.spec.mjs"], stats } = {}) {
  const flatSpecs = [];
  const collect = (list) => {
    for (const suite of list) {
      for (const spec of suite.specs || []) flatSpecs.push(...(spec.tests || []));
      collect(suite.suites || []);
    }
  };
  collect(suites);
  const computedStats = stats ?? {
    expected: flatSpecs.filter((test) => test.status === "expected").length,
    skipped: flatSpecs.filter((test) => test.status === "skipped").length,
    unexpected: flatSpecs.filter((test) => test.status === "unexpected").length,
    flaky: flatSpecs.filter((test) => test.status === "flaky").length,
  };
  return {
    config: { projects: [{ testMatch }] },
    suites,
    errors,
    stats: computedStats,
  };
}

describe("local CI website Playwright sharding", () => {
  it("fails required coverage without a browser and rejects invalid explicit paths offline", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gate-no-browser-"));
    try {
      const browser = path.join(dir, "chromium");
      expect(websiteBrowserAvailable(browser)).toBe(false);
      expect(websiteBrowserAvailable(dir)).toBe(false);
      writeFileSync(browser, "#!/bin/sh\nexit 0\n", { mode: 0o600 });
      expect(websiteBrowserAvailable(browser)).toBe(false);
      chmodSync(browser, 0o700);
      expect(websiteBrowserAvailable(browser)).toBe(true);
      // Merely finding a browser or passing a build is insufficient evidence.
      expect(requiredWebsiteCoverageStep(true, undefined, [
        { id: "website-build", status: "passed" },
        { id: "website-browser-suites", status: "skipped" },
      ])).toMatchObject({ status: "failed", job: "website-build" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("requires verified executed coverage for both single and multiple shards", () => {
    const steps = [{ id: "verify-website-browser-reports", status: "passed" }];
    for (const shards of [1, 8]) {
      expect(requiredWebsiteCoverageStep(true, { totalTests: 12, shards }, steps).status).toBe("passed");
      expect(requiredWebsiteCoverageStep(true, { totalTests: 0, shards }, steps).status).toBe("failed");
      expect(requiredWebsiteCoverageStep(true, { totalTests: 12, shards }, []).status).toBe("failed");
    }
    expect(requiredWebsiteCoverageStep(true, undefined, steps).status).toBe("failed");
  });

  it("preserves conditional auto skips while requiring coverage for changed website inputs", () => {
    const conditional = requiresWebsiteBuild(["tests/unit/local-ci.test.js"]);
    expect(conditional).toBe(false);
    expect(requiredWebsiteCoverageStep(conditional, undefined, [])).toBeNull();
    expect(requiredWebsiteCoverageStep(requiresWebsiteBuild(["website/app/page.js"]), undefined, []).status).toBe("failed");
  });

  it("extracts the complete configured inventory and rejects empty or missing configured suites", () => {
    const listReport = makeReport({
      suites: [
        {
          title: "docs.spec.mjs",
          file: "docs.spec.mjs",
          specs: [makeSpec("docs.spec.mjs", "docs route 200", { status: "skipped", results: [] })],
        },
        {
          title: "marketing.spec.mjs",
          file: "marketing.spec.mjs",
          specs: [makeSpec("marketing.spec.mjs", "home theme", { status: "skipped", results: [] })],
          suites: [
            {
              title: "published pages",
              file: "marketing.spec.mjs",
              specs: [makeSpec("marketing.spec.mjs", "1440px batch 1", { status: "skipped", results: [] })],
            },
          ],
        },
        {
          title: "public-verification.spec.mjs",
          file: "public-verification.spec.mjs",
          specs: [],
          suites: [
            {
              title: "all public pages",
              file: "public-verification.spec.mjs",
              specs: [makeSpec("public-verification.spec.mjs", "1280px batch 1", { status: "skipped", results: [] })],
            },
          ],
        },
      ],
    });

    const inventory = collectWebsiteBrowserInventory(listReport);
    expect(inventory.files).toEqual(["docs.spec.mjs", "marketing.spec.mjs", "public-verification.spec.mjs"]);
    expect(inventory.tests).toHaveLength(4);
    expect(inventory.tests.map((entry) => entry.title)).toContain("published pages › 1440px batch 1");

    expect(() => collectWebsiteBrowserInventory(makeReport({ suites: [] }))).toThrow(/empty/);
    expect(() => collectWebsiteBrowserInventory(makeReport({
      suites: listReport.suites.slice(0, 2),
      testMatch: ["docs.spec.mjs", "marketing.spec.mjs", "public-verification.spec.mjs"],
    }))).toThrow(/public-verification\.spec\.mjs/);
    expect(() => extractPlaywrightTests(makeReport({ suites: listReport.suites, errors: [{ message: "boom" }] }))).toThrow(/error/);
  });

  it("selects deterministic shards capped by inventory size and rejects empty or invalid inputs", () => {
    const smallInventory = Array.from({ length: 3 }, (_, i) => ({ key: `k${i}`, file: "docs.spec.mjs" }));
    expect(selectWebsiteBrowserShards(smallInventory)).toEqual([
      { index: 1, total: 3, shard: "1/3", id: "website-browser-shard-1" },
      { index: 2, total: 3, shard: "2/3", id: "website-browser-shard-2" },
      { index: 3, total: 3, shard: "3/3", id: "website-browser-shard-3" },
    ]);

    const largeInventory = Array.from({ length: 102 }, (_, i) => ({ key: `k${i}`, file: "marketing.spec.mjs" }));
    const selected = selectWebsiteBrowserShards(largeInventory);
    expect(selected).toHaveLength(WEBSITE_BROWSER_SHARD_COUNT);
    expect(selected.map((entry) => entry.shard)).toEqual(
      Array.from({ length: WEBSITE_BROWSER_SHARD_COUNT }, (_, i) => `${i + 1}/${WEBSITE_BROWSER_SHARD_COUNT}`),
    );
    expect(selectWebsiteBrowserShards(largeInventory)).toEqual(selected);

    expect(() => selectWebsiteBrowserShards([])).toThrow(/empty/);
    expect(() => selectWebsiteBrowserShards(smallInventory, 0)).toThrow(/invalid/);
    expect(() => selectWebsiteBrowserShards(smallInventory, 1.5)).toThrow(/invalid/);
  });

  it("constructs isolated, private Playwright discovery and shard commands using pinned tooling", () => {
    const web = "/private/out/src/website";
    const browser = "/opt/chromium/chrome";
    const outputRoot = "/private/out/tmp/website-browser-output";
    const reportRoot = "/private/out/website-browser-reports";

    const inv = websiteBrowserInventoryCommand(web, browser, path.join(reportRoot, "inventory.json"));
    expect(inv).toEqual([
      "website-browser-inventory",
      "node",
      [path.join(web, "node_modules/@playwright/test/cli.js"), "test", "--list", "--reporter=json"],
      {
        cwd: web,
        env: {
          WEBSITE_CHROMIUM_EXECUTABLE: browser,
          PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(reportRoot, "inventory.json"),
        },
      },
    ]);

    const shards = selectWebsiteBrowserShards(Array.from({ length: 4 }, (_, i) => ({ key: `t${i}` })), 4);
    const commands = websiteBrowserShardCommands(web, shards, { browser, outputRoot, reportRoot });
    expect(commands).toHaveLength(4);
    for (let i = 0; i < commands.length; i++) {
      const [id, cmd, args, opts] = commands[i];
      expect(id).toBe(`website-browser-shard-${i + 1}`);
      expect(cmd).toBe("node");
      expect(args).toEqual([
        path.join(web, "node_modules/@playwright/test/cli.js"),
        "test",
        `--shard=${i + 1}/4`,
        "--reporter=list,json",
        `--output=${path.join(outputRoot, `shard-${i + 1}`)}`,
      ]);
      expect(opts.cwd).toBe(web);
      expect(opts.env).toEqual({
        WEBSITE_CHROMIUM_EXECUTABLE: browser,
        PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(reportRoot, `shard-${i + 1}.json`),
        WEBSITE_VERIFY_SCREENSHOTS: path.join(outputRoot, `shard-${i + 1}-verify-screenshots`),
        WEBSITE_REVIEW_SCREENSHOTS: path.join(outputRoot, `shard-${i + 1}-review-screenshots`),
      });
      expect(args).not.toContain("--pass-with-no-tests");
      expect(JSON.stringify([args, opts])).not.toMatch(/\/tmp\/omc-docs|\/tmp\/durindoor-|durindoor\.vercel\.app|reuseExistingServer/);
    }

    expect(() => websiteBrowserInventoryCommand("relative/website", browser, "/abs/inv.json")).toThrow(/absolute/);
    expect(() => websiteBrowserShardCommands(web, [], { browser, outputRoot, reportRoot })).toThrow(/empty/);
    expect(() => websiteBrowserShardCommands(web, [{ index: 1, total: 2, shard: "1/2", id: "website-browser-shard-1" }], { browser, outputRoot, reportRoot })).toThrow(/invalid/);
    expect(() => websiteBrowserShardCommands(web, shards, { browser: "chrome", outputRoot, reportRoot })).toThrow(/absolute/);
  });

  it("rejects failed shards, stale reports, zero-test shards, skipped/unexpected tests, duplicates, and incomplete unions", () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "gate-web-shards-")));
    try {
      const specA = makeSpec("docs.spec.mjs", "route check");
      const specB = makeSpec("marketing.spec.mjs", "home check");
      const specC = makeSpec("public-verification.spec.mjs", "audit check");
      const inventory = collectWebsiteBrowserInventory(makeReport({
        suites: [
          { title: "docs.spec.mjs", file: "docs.spec.mjs", specs: [{ ...specA, tests: [{ ...specA.tests[0], status: "skipped", results: [] }] }] },
          { title: "marketing.spec.mjs", file: "marketing.spec.mjs", specs: [{ ...specB, tests: [{ ...specB.tests[0], status: "skipped", results: [] }] }] },
          { title: "public-verification.spec.mjs", file: "public-verification.spec.mjs", specs: [{ ...specC, tests: [{ ...specC.tests[0], status: "skipped", results: [] }] }] },
        ],
      })).tests;

      const started = Date.now();
      const shard1File = path.join(dir, "shard-1.json");
      const shard2File = path.join(dir, "shard-2.json");
      writeFileSync(shard1File, JSON.stringify(makeReport({
        suites: [
          { title: "docs.spec.mjs", file: "docs.spec.mjs", specs: [specA] },
          { title: "marketing.spec.mjs", file: "marketing.spec.mjs", specs: [specB] },
        ],
      })));
      writeFileSync(shard2File, JSON.stringify(makeReport({
        suites: [{ title: "public-verification.spec.mjs", file: "public-verification.spec.mjs", specs: [specC] }],
      })));

      const r1 = validateWebsiteBrowserShardReport(shard1File, started, 0, null);
      const r2 = validateWebsiteBrowserShardReport(shard2File, started, 0, null);
      expect(r1.tests).toBe(2);
      expect(r2.tests).toBe(1);
      expect(verifyWebsiteBrowserCoverage(inventory, [r1, r2])).toEqual({
        totalTests: 3,
        shards: 2,
        files: ["docs.spec.mjs", "marketing.spec.mjs", "public-verification.spec.mjs"],
      });

      // Failed exit code or signal
      expect(() => validateWebsiteBrowserShardReport(shard1File, started, 1, null)).toThrow(/status 1/);
      expect(() => validateWebsiteBrowserShardReport(shard1File, started, 0, "SIGKILL")).toThrow(/SIGKILL/);

      // Stale report
      utimesSync(shard1File, new Date(0), new Date(0));
      expect(() => validateWebsiteBrowserShardReport(shard1File, started, 0, null)).toThrow(/stale/);

      // Zero tests in a shard
      const emptyFile = path.join(dir, "empty.json");
      writeFileSync(emptyFile, JSON.stringify(makeReport({ suites: [] })));
      expect(() => validateWebsiteBrowserShardReport(emptyFile, started, 0, null)).toThrow(/zero/);

      // Skipped / unexpected / flaky test in a shard
      const skippedFile = path.join(dir, "skipped.json");
      writeFileSync(skippedFile, JSON.stringify(makeReport({
        suites: [{ title: "docs.spec.mjs", file: "docs.spec.mjs", specs: [makeSpec("docs.spec.mjs", "route check", { status: "skipped", results: [] })] }],
      })));
      expect(() => validateWebsiteBrowserShardReport(skippedFile, started, 0, null)).toThrow(/skipped/);

      const failedFile = path.join(dir, "failed.json");
      writeFileSync(failedFile, JSON.stringify(makeReport({
        suites: [{ title: "docs.spec.mjs", file: "docs.spec.mjs", specs: [makeSpec("docs.spec.mjs", "route check", { ok: false, status: "unexpected" })] }],
      })));
      expect(() => validateWebsiteBrowserShardReport(failedFile, started, 0, null)).toThrow(/unexpected/);

      // Incomplete union, duplicate execution across shards, and unexpected extra test
      expect(() => verifyWebsiteBrowserCoverage(inventory, [r1])).toThrow(/omitted 1/);
      expect(() => verifyWebsiteBrowserCoverage(inventory, [r1, r1])).toThrow(/duplicate/);
      const extraSpec = makeSpec("docs.spec.mjs", "unplanned test");
      const extraFile = path.join(dir, "extra.json");
      writeFileSync(extraFile, JSON.stringify(makeReport({
        suites: [
          { title: "public-verification.spec.mjs", file: "public-verification.spec.mjs", specs: [specC] },
          { title: "docs.spec.mjs", file: "docs.spec.mjs", specs: [extraSpec] },
        ],
      })));
      const rExtra = validateWebsiteBrowserShardReport(extraFile, started, 0, null);
      expect(() => verifyWebsiteBrowserCoverage(inventory, [r1, rExtra])).toThrow(/unexpected/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("executes discovery and shard commands in isolated child processes with private output and allowlisted env", () => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "gate-web-child-")));
    try {
      const web = path.join(root, "src", "website");
      const tmp = path.join(root, "tmp");
      const home = path.join(root, "home");
      const data = path.join(root, "data");
      const outputRoot = path.join(tmp, "website-browser-output");
      const reportRoot = path.join(root, "website-browser-reports");
      const fakeBrowser = path.join(root, "fake-chromium");
      for (const dir of [web, tmp, home, data, outputRoot, reportRoot, path.join(web, "node_modules/@playwright/test")]) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      chmodSync(tmp, 0o700);
      writeFileSync(fakeBrowser, "");

      const cli = path.join(web, "node_modules/@playwright/test/cli.js");
      writeFileSync(cli, `
        import fs from "node:fs";
        import path from "node:path";
        const forbidden = ["GH_TOKEN", "GITHUB_TOKEN", "OPENAI_API_KEY", "RUN_REAL", "NODE_OPTIONS"];
        if (forbidden.some((k) => process.env[k])) process.exit(3);
        if ((fs.statSync(process.env.TMPDIR).mode & 0o777) !== 0o700) process.exit(4);
        const args = process.argv.slice(2);
        const all = [
          { file: "docs.spec.mjs", title: "docs 1", id: "d1" },
          { file: "marketing.spec.mjs", title: "marketing 1", id: "m1" },
          { file: "public-verification.spec.mjs", title: "public 1", id: "p1" },
        ];
        const reportFile = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
        if (!reportFile) process.exit(5);
        if (args.includes("--list")) {
          const suites = all.map((t) => ({
            title: t.file, file: t.file,
            specs: [{ title: t.title, file: t.file, id: t.id, ok: true, tests: [{ projectId: "", projectName: "", status: "skipped", expectedStatus: "passed", results: [] }] }],
          }));
          fs.writeFileSync(reportFile, JSON.stringify({
            config: { projects: [{ testMatch: all.map((t) => t.file) }] },
            suites, errors: [], stats: { expected: 0, skipped: all.length, unexpected: 0, flaky: 0 },
          }));
          process.exit(0);
        }
        const shardArg = args.find((a) => a.startsWith("--shard="));
        const outArg = args.find((a) => a.startsWith("--output="));
        if (!shardArg || !outArg) process.exit(6);
        if (!process.env.WEBSITE_VERIFY_SCREENSHOTS?.startsWith(process.env.TMPDIR)) process.exit(7);
        if (!process.env.WEBSITE_REVIEW_SCREENSHOTS?.startsWith(process.env.TMPDIR)) process.exit(8);
        if (!outArg.slice("--output=".length).startsWith(process.env.TMPDIR)) process.exit(9);
        const [cur, tot] = shardArg.slice("--shard=".length).split("/").map(Number);
        const picked = all.filter((_, idx) => idx % tot === cur - 1);
        const suites = picked.map((t) => ({
          title: t.file, file: t.file,
          specs: [{ title: t.title, file: t.file, id: t.id, ok: true, tests: [{ projectId: "", projectName: "", status: "expected", expectedStatus: "passed", results: [{ status: "passed" }] }] }],
        }));
        fs.writeFileSync(reportFile, JSON.stringify({
          config: { projects: [{ testMatch: all.map((t) => t.file) }] },
          suites, errors: [], stats: { expected: picked.length, skipped: 0, unexpected: 0, flaky: 0 },
        }));
      `);

      const baseEnv = testEnvironment(
        { ...process.env, GH_TOKEN: "secret", OPENAI_API_KEY: "secret", RUN_REAL: "1", NODE_OPTIONS: "--evil" },
        { HOME: home, DATA_DIR: data, TMPDIR: tmp },
      );

      const invFile = path.join(reportRoot, "inventory.json");
      const [, , invArgs, invOpts] = websiteBrowserInventoryCommand(web, fakeBrowser, invFile);
      const invRes = spawnSync(process.execPath, invArgs, { cwd: invOpts.cwd, env: { ...baseEnv, ...invOpts.env }, timeout: 10_000 });
      expect(invRes.status).toBe(0);

      const discovered = collectWebsiteBrowserInventory(JSON.parse(readFileSync(invFile, "utf8")));
      const shards = selectWebsiteBrowserShards(discovered.tests);
      expect(shards).toHaveLength(3);

      const shardCommands = websiteBrowserShardCommands(web, shards, { browser: fakeBrowser, outputRoot, reportRoot });
      const results = [];
      for (const [, , args, opts] of shardCommands) {
        const started = Date.now();
        const res = spawnSync(process.execPath, args, { cwd: opts.cwd, env: { ...baseEnv, ...opts.env }, timeout: 10_000 });
        expect(res.status).toBe(0);
        results.push(validateWebsiteBrowserShardReport(opts.reportFile, started, res.status, res.signal));
      }
      expect(verifyWebsiteBrowserCoverage(discovered.tests, results)).toEqual({
        totalTests: 3,
        shards: 3,
        files: ["docs.spec.mjs", "marketing.spec.mjs", "public-verification.spec.mjs"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
