import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Related-test discovery for changes made only of website/tests browser files.
// The exemption must fail closed for anything that is not a real browser file.
const runner = fileURLToPath(new URL("../../scripts/run-related-tests.mjs", import.meta.url));
const realTimeout = execFileSync("sh", ["-c", "command -v timeout"], { encoding: "utf8" }).trim();

const browserOnly = ["website/tests/docs.spec.mjs", "website/tests/sitemap-inventory.mjs"];
const defaultTree = {
  "website/tests/docs.spec.mjs": "",
  "website/tests/sitemap-inventory.mjs": "",
  "website/src/app/page.js": "",
  "open-sse/utils/sseFrames.js": "",
};

// discovery: "ok" | "error" | "config" | "crash" | "signal" | "hang"
// batch: "ok" | "failFirst" | "signal" | "hang"
function runFixture({
  testCount = 0,
  changed = browserOnly.map((file) => `${file}\n`).join(""),
  tree = defaultTree,
  symlinks = {},
  discovery = "ok",
  batch = "ok",
  shortTimeout = false,
}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "related-browser-test-")));
  try {
    const scripts = join(root, "scripts");
    const pkg = join(root, "tests/node_modules/vitest");
    const bin = join(root, "bin");
    const calls = join(root, "calls.jsonl");
    const changedList = join(root, "changed");
    for (const dir of [scripts, bin, join(pkg, "dist"), join(root, "tests/unit")]) mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(tree)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), content);
    }
    for (const [link, target] of Object.entries(symlinks)) {
      mkdirSync(dirname(join(root, link)), { recursive: true });
      symlinkSync(target, join(root, link));
    }
    copyFileSync(runner, join(scripts, "run-related-tests.mjs"));
    writeFileSync(changedList, typeof changed === "function" ? changed(root) : changed);
    writeFileSync(join(pkg, "dist/node.js"), `
      import { appendFileSync } from "node:fs";
      const mode = ${JSON.stringify(discovery)};
      export async function createVitest(_mode, options) {
        appendFileSync(process.env.CALLS, JSON.stringify({ related: options.related }) + "\\n");
        if (mode === "config") throw new Error("simulated invalid vitest config");
        return {
          specifications: { getTestDependencies: async () => new Set() },
          async getRelevantTestSpecifications() {
            if (mode === "error") throw new Error("simulated discovery failure");
            if (mode === "crash") process.exit(3);
            if (mode === "signal") process.kill(process.pid, "SIGKILL");
            if (mode === "hang") await new Promise(() => setInterval(() => {}, 1000));
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
      const mode = ${JSON.stringify(batch)};
      const args = process.argv.slice(2);
      const files = args.slice(args.indexOf("--no-cache") + 1);
      appendFileSync(process.env.CALLS, JSON.stringify(files) + "\\n");
      const first = files[0].endsWith("test-00.test.js");
      if (mode === "failFirst" && first) process.exitCode = 1;
      if (mode === "signal" && first) process.kill(process.pid, "SIGKILL");
      if (mode === "hang" && first) setInterval(() => {}, 1000);
    `);
    // Shrink the runner's real 295s ceiling so timeout paths finish quickly.
    // The real coreutils timeout still enforces it.
    if (shortTimeout) {
      writeFileSync(join(bin, "timeout"), `#!/bin/sh\nshift 3\nexec ${realTimeout} -k 1s 1s "$@"\n`);
      chmodSync(join(bin, "timeout"), 0o755);
    }
    const result = spawnSync(process.execPath, [join(scripts, "run-related-tests.mjs"), changedList], {
      cwd: root,
      env: { ...process.env, CALLS: calls, TMPDIR: root, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    return {
      root,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      calls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse) : [],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectRejected(result) {
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Vitest selected zero related test files");
  expect(result.stdout).not.toContain("browser suite covers");
  expect(result.calls).toHaveLength(1);
}

describe("browser-only exemption", () => {
  it("passes an empty selection when every changed file is a real browser test under website/tests", () => {
    const { root, status, stdout, calls } = runFixture({});
    expect(status).toBe(0);
    expect(stdout).toContain("browser suite covers");
    expect(calls).toEqual([{ related: browserOnly.map((file) => join(root, file)) }]);
  });

  it("accepts a CRLF changed-file list", () => {
    const { status, stdout } = runFixture({ changed: browserOnly.map((file) => `${file}\r\n`).join("") });
    expect(status).toBe(0);
    expect(stdout).toContain("browser suite covers");
  });

  it("accepts a symlink that stays inside website/tests", () => {
    const { status } = runFixture({
      changed: "website/tests/alias.spec.mjs\n",
      symlinks: { "website/tests/alias.spec.mjs": "docs.spec.mjs" },
    });
    expect(status).toBe(0);
  });
});

describe("browser-only exemption rejects", () => {
  it.each([
    ["mixed browser and app files", [...browserOnly, "open-sse/utils/sseFrames.js"]],
    ["website source outside website/tests", ["website/src/app/page.js"]],
    ["a sibling directory sharing the prefix", ["website/tests-extra/helper.mjs"]],
    ["a parent segment escaping website/tests", ["website/tests/../src/app/page.js"]],
    ["a parent segment returning into website/tests", ["website/tests/../tests/docs.spec.mjs"]],
    ["a dot segment", ["website/tests/./docs.spec.mjs"]],
    ["an empty segment", ["website/tests//docs.spec.mjs"]],
    ["the website/tests directory itself", ["website/tests"]],
    ["the website/tests directory with a trailing slash", ["website/tests/"]],
    ["a Windows drive path", ["C:/website/tests/docs.spec.mjs"]],
    ["backslash separators", ["website\\tests\\docs.spec.mjs"]],
    ["a backslash inside website/tests", ["website/tests/..\\..\\src\\app\\page.js"]],
    ["a leading space", [" website/tests/docs.spec.mjs"]],
    ["a trailing space", ["website/tests/docs.spec.mjs "]],
    ["a trailing tab", ["website/tests/docs.spec.mjs\t"]],
    ["a whitespace-only line", ["   "]],
    ["an uppercase directory", ["Website/Tests/docs.spec.mjs"]],
    ["a case variant of the tests directory", ["website/Tests/docs.spec.mjs"]],
    ["a deleted browser file", ["website/tests/removed.spec.mjs"]],
  ])("%s", (_label, paths) => {
    const result = runFixture({ changed: paths.map((file) => `${file}\n`).join("") });
    expectRejected(result);
  });

  it("an absolute path naming a real browser file", () => {
    expectRejected(runFixture({ changed: (root) => `${join(root, "website/tests/docs.spec.mjs")}\n` }));
  });

  it("a stray carriage return that CRLF splitting leaves behind", () => {
    expectRejected(runFixture({ changed: "website/tests/docs.spec.mjs\r\r\n" }));
  });

  it("a file symlink escaping website/tests", () => {
    expectRejected(runFixture({
      changed: "website/tests/escape.spec.mjs\n",
      symlinks: { "website/tests/escape.spec.mjs": "../src/app/page.js" },
    }));
  });

  it("a directory symlink escaping website/tests", () => {
    expectRejected(runFixture({
      changed: "website/tests/linked/page.js\n",
      symlinks: { "website/tests/linked": "../src/app" },
    }));
  });

  it("a symlink pointing back at the website/tests directory", () => {
    expectRejected(runFixture({
      changed: "website/tests/self\n",
      symlinks: { "website/tests/self": "." },
    }));
  });

  it("a dangling symlink", () => {
    expectRejected(runFixture({
      changed: "website/tests/dangling.spec.mjs\n",
      symlinks: { "website/tests/dangling.spec.mjs": "missing.spec.mjs" },
    }));
  });

  it("website/tests itself being a symlink to another directory", () => {
    expectRejected(runFixture({
      changed: "website/tests/page.js\n",
      tree: { "website/src/app/page.js": "" },
      symlinks: { "website/tests": "src/app" },
    }));
  });
});

describe("browser-only changes still fail on", () => {
  it("an empty changed-file list", () => {
    const { status, stderr, calls } = runFixture({ changed: "" });
    expect(status).toBe(1);
    expect(stderr).toContain("Changed-file list is empty");
    expect(calls).toEqual([]);
  });

  it("a changed-file list containing only line breaks", () => {
    const { status, stderr } = runFixture({ changed: "\r\n\n" });
    expect(status).toBe(1);
    expect(stderr).toContain("Changed-file list is empty");
  });

  it("a Vitest configuration error", () => {
    const { status, stderr } = runFixture({ discovery: "config" });
    expect(status).toBe(1);
    expect(stderr).toContain("simulated invalid vitest config");
  });

  it("a related-test discovery error", () => {
    const { status, stderr, calls } = runFixture({ discovery: "error" });
    expect(status).toBe(1);
    expect(stderr).toContain("simulated discovery failure");
    expect(calls).toHaveLength(1);
  });

  it("a discovery process crash", () => {
    const { status, stdout } = runFixture({ discovery: "crash" });
    expect(status).toBe(3);
    expect(stdout).toContain("Finish related test discovery exit 3");
  });

  it("a discovery process killed by a signal", () => {
    const { status, stdout } = runFixture({ discovery: "signal" });
    expect(status).not.toBe(0);
    expect(stdout).not.toContain("browser suite covers");
    expect(stdout).not.toContain("Finish related test discovery exit 0");
  });

  it("a discovery timeout", () => {
    const { status, stdout } = runFixture({ discovery: "hang", shortTimeout: true });
    expect(status).toBe(124);
    expect(stdout).toContain("Finish related test discovery exit 124");
  }, 20_000);

  it("a failing test in one of several batches", () => {
    const { status, calls } = runFixture({ testCount: 51, batch: "failFirst" });
    expect(status).toBe(1);
    expect(calls.slice(1).map((files) => files.length)).toEqual([50, 1]);
  });

  it("a batch killed by a signal", () => {
    const { status, stdout, calls } = runFixture({ testCount: 51, batch: "signal" });
    expect(status).toBe(1);
    expect(stdout).toContain("Finish related tests batch 2/2 exit 0");
    expect(calls.slice(1).map((files) => files.length)).toEqual([50, 1]);
  });

  it("a batch timeout", () => {
    const { status, stdout } = runFixture({ testCount: 2, batch: "hang", shortTimeout: true });
    expect(status).toBe(1);
    expect(stdout).toContain("Finish related tests batch 1/1 exit 124");
  }, 20_000);
});
