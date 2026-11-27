import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const runner = fileURLToPath(new URL("../../scripts/run-related-tests.mjs", import.meta.url));

function runFixture({
  testCount,
  failFirstBatch = false,
  changedFiles = ["open-sse/utils/sseFrames.js"],
  discoveryError = false,
}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "related-runner-test-")));
  try {
    const scripts = join(root, "scripts");
    const pkg = join(root, "tests/node_modules/vitest");
    const calls = join(root, "calls.jsonl");
    const maxConcurrency = join(root, "max-concurrency");
    const changed = join(root, "changed");
    mkdirSync(scripts);
    mkdirSync(join(pkg, "dist"), { recursive: true });
    copyFileSync(runner, join(scripts, "run-related-tests.mjs"));
    writeFileSync(changed, changedFiles.map((file) => `${file}\n`).join(""));
    writeFileSync(join(pkg, "dist/node.js"), `
      import { appendFileSync } from "node:fs";
      export async function createVitest(_mode, options) {
        appendFileSync(process.env.CALLS, JSON.stringify({ related: options.related }) + "\\n");
        const specifications = {
          active: 0,
          maxActive: 0,
          async getTestDependencies() {
            this.active++;
            this.maxActive = Math.max(this.maxActive, this.active);
            await new Promise((resolve) => setTimeout(resolve, 2));
            this.active--;
            return new Set();
          },
        };
        return {
          specifications,
          getRelevantTestSpecifications: async function() {
            if (${discoveryError}) throw new Error("simulated discovery failure");
            await Promise.all(Array.from({ length: ${testCount} }, () => this.specifications.getTestDependencies({})));
            appendFileSync(process.env.MAX_CONCURRENCY, String(this.specifications.maxActive));
            return Array.from({ length: ${testCount} }, (_, index) => ({
            moduleId: process.cwd() + "/unit/test-" + String(index).padStart(2, "0") + ".test.js",
            }));
          },
          close: async () => {},
        };
      }
    `);
    writeFileSync(join(pkg, "vitest.mjs"), `
      import { appendFileSync } from "node:fs";
      const args = process.argv.slice(2);
      const files = args.slice(args.indexOf("--no-cache") + 1);
      appendFileSync(process.env.CALLS, JSON.stringify(files) + "\\n");
      if (${failFirstBatch} && files[0].endsWith("test-00.test.js")) process.exitCode = 1;
    `);
    const result = spawnSync(process.execPath, [join(scripts, "run-related-tests.mjs"), changed], {
      cwd: root,
      env: { ...process.env, CALLS: calls, MAX_CONCURRENCY: maxConcurrency, TMPDIR: root },
      encoding: "utf8",
    });
    return {
      root,
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
      calls: readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse),
      maxActive: discoveryError ? 0 : Number(readFileSync(maxConcurrency, "utf8")),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it("limits related dependency discovery and runs every file after a batch fails", () => {
  const { root, status, calls, maxActive } = runFixture({ testCount: 51, failFirstBatch: true });
  expect(status).toBe(1);
  expect(maxActive).toBe(8);
  expect(calls[0]).toEqual({ related: [join(root, "open-sse/utils/sseFrames.js")] });
  expect(calls.slice(1).map((batch) => batch.length)).toEqual([50, 1]);
  expect(calls.slice(1).flat()).toEqual(Array.from({ length: 51 }, (_, index) =>
    join(root, "tests/unit", `test-${String(index).padStart(2, "0")}.test.js`)));
});

it("fails an empty related-file selection", () => {
  const { status, stderr, calls } = runFixture({ testCount: 0 });
  expect(status).toBe(1);
  expect(stderr).toContain("Vitest selected zero related test files");
  expect(calls).toHaveLength(1);
});

const browserOnly = ["website/tests/docs.spec.mjs", "website/tests/sitemap-inventory.mjs"];

it("passes an empty selection when every changed file is a browser test under website/tests", () => {
  const { root, status, stdout, calls } = runFixture({ testCount: 0, changedFiles: browserOnly });
  expect(status).toBe(0);
  expect(stdout).toContain("browser suite covers");
  expect(calls).toEqual([{ related: browserOnly.map((file) => join(root, file)) }]);
});

it.each([
  ["mixed browser and app files", [...browserOnly, "open-sse/utils/sseFrames.js"]],
  ["website source outside website/tests", ["website/src/app/page.js"]],
  ["a sibling directory sharing the prefix", ["website/tests-extra/helper.mjs"]],
  ["a path escaping website/tests", ["website/tests/../src/app/page.js"]],
  ["the website/tests directory itself", ["website/tests"]],
])("fails an empty selection for %s", (_label, changedFiles) => {
  const { status, stderr, calls } = runFixture({ testCount: 0, changedFiles });
  expect(status).toBe(1);
  expect(stderr).toContain("Vitest selected zero related test files");
  expect(calls).toHaveLength(1);
});

it("fails a browser-only change when related-test discovery errors", () => {
  const { status, stderr, calls } = runFixture({ testCount: 0, changedFiles: browserOnly, discoveryError: true });
  expect(status).toBe(1);
  expect(stderr).toContain("simulated discovery failure");
  expect(calls).toHaveLength(1);
});

it("runs and fails selected tests for a browser-only change", () => {
  const { status, calls } = runFixture({ testCount: 2, changedFiles: browserOnly, failFirstBatch: true });
  expect(status).toBe(1);
  expect(calls.slice(1).map((batch) => batch.length)).toEqual([2]);
});
