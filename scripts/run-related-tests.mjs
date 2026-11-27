// The orchestrator can reuse one Vitest dependency scan across bounded test runs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const testDir = join(root, "tests");
const vitestCli = join(testDir, "node_modules/vitest/vitest.mjs");
const batchSize = 50;
const dependencyConcurrency = 8;

function limitDependencyConcurrency(vitest) {
  const specifications = vitest.specifications;
  const getTestDependencies = specifications.getTestDependencies.bind(specifications);
  let active = 0;
  const waiting = [];
  specifications.getTestDependencies = async (...args) => {
    if (active >= dependencyConcurrency) await new Promise((resolve) => waiting.push(resolve));
    active++;
    try {
      return await getTestDependencies(...args);
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

// Playwright specs and their helpers live under website/tests/ and are run by
// the browser suite, not Vitest. A change made only of those files can
// legitimately select zero related unit tests.
const browserTestDir = join(root, "website", "tests");

function isBrowserTestFile(file) {
  const path = relative(browserTestDir, resolve(root, file));
  return Boolean(path) && !path.startsWith("..") && !isAbsolute(path);
}

function run(label, args, env) {
  console.log(`Start ${label}`);
  const { status, signal, error } = spawnSync("timeout", [
    "-k", "5s", "295s", process.execPath, ...args,
  ], { cwd: testDir, env, stdio: "inherit" });
  const code = status ?? 1;
  if (error || signal) console.error(error || `${label} received ${signal}`);
  console.log(`Finish ${label} exit ${code}`);
  return code;
}

async function discover(changedList, output) {
  const changed = readFileSync(changedList, "utf8").split(/\r?\n/).filter(Boolean);
  if (!changed.length) throw new Error("Changed-file list is empty");
  const { createVitest } = await import("../tests/node_modules/vitest/dist/node.js");
  const vitest = await createVitest("test", {
    watch: false,
    cache: false,
    related: changed.map((file) => resolve(root, file)),
  }, { cacheDir: join(dirname(output), "vite-cache") });
  try {
    // Vitest otherwise builds every test's dependency graph at once. Large
    // suites can exhaust resources before related-test discovery completes.
    limitDependencyConcurrency(vitest);
    const specs = await vitest.getRelevantTestSpecifications();
    const files = [...new Set(specs.map(({ moduleId }) => relative(testDir, moduleId)))].sort();
    if (!files.length && !changed.every(isBrowserTestFile)) {
      throw new Error("Vitest selected zero related test files");
    }
    writeFileSync(output, JSON.stringify(files));
    console.log(files.length
      ? `Vitest selected ${files.length} related test files`
      : `Vitest selected zero related test files; every changed file is a browser test under website/tests/, which the browser suite covers`);
  } finally {
    await vitest.close();
  }
}

function runRelated(changedList) {
  const temporary = mkdtempSync(join(tmpdir(), "vitest-related-"));
  const output = join(temporary, "files.json");
  const env = { ...process.env, TMPDIR: temporary };
  try {
    const discovery = run("related test discovery", [
      script, "--discover", resolve(changedList), output,
    ], env);
    if (discovery !== 0) return discovery;

    const files = JSON.parse(readFileSync(output, "utf8"));
    const batches = Math.ceil(files.length / batchSize);
    let failed = false;
    for (let index = 0; index < batches; index++) {
      const batch = files.slice(index * batchSize, (index + 1) * batchSize);
      const code = run(`related tests batch ${index + 1}/${batches}`, [
        vitestCli, "run", "--maxWorkers=4", "--isolate", "--pool=forks",
        "--reporter=verbose", "--no-cache", ...batch.map((file) => resolve(testDir, file)),
      ], env);
      if (code !== 0) failed = true;
    }
    return failed ? 1 : 0;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

const [mode, changedList, output] = process.argv.slice(2);
if (mode === "--discover" && changedList && output) {
  await discover(changedList, output);
} else if (mode && !changedList) {
  process.exitCode = runRelated(mode);
} else {
  console.error("Usage: node scripts/run-related-tests.mjs <changed-file-list>");
  process.exitCode = 1;
}
