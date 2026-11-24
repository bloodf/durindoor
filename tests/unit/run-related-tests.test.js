import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const runner = fileURLToPath(new URL("../../scripts/run-related-tests.mjs", import.meta.url));

function runFixture({ testCount, failFirstBatch = false }) {
  const root = mkdtempSync(join(tmpdir(), "related-runner-test-"));
  try {
    const scripts = join(root, "scripts");
    const pkg = join(root, "tests/node_modules/vitest");
    const calls = join(root, "calls.jsonl");
    const changed = join(root, "changed");
    mkdirSync(scripts);
    mkdirSync(join(pkg, "dist"), { recursive: true });
    copyFileSync(runner, join(scripts, "run-related-tests.mjs"));
    writeFileSync(changed, "open-sse/utils/sseFrames.js\n");
    writeFileSync(join(pkg, "dist/node.js"), `
      import { appendFileSync } from "node:fs";
      export async function createVitest(_mode, options) {
        appendFileSync(process.env.CALLS, JSON.stringify({ related: options.related }) + "\\n");
        return {
          getRelevantTestSpecifications: async () => Array.from({ length: ${testCount} }, (_, index) => ({
            moduleId: process.cwd() + "/unit/test-" + String(index).padStart(2, "0") + ".test.js",
          })),
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
      env: { ...process.env, CALLS: calls, TMPDIR: root },
      encoding: "utf8",
    });
    return {
      root,
      status: result.status,
      stderr: result.stderr,
      calls: readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it("discovers once and runs every related file even after a batch fails", () => {
  const { root, status, calls } = runFixture({ testCount: 51, failFirstBatch: true });
  expect(status).toBe(1);
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
