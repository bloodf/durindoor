// The orchestrator can reuse one Vitest dependency scan across bounded test runs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const testDir = join(root, "tests");
const vitestCli = join(testDir, "node_modules/vitest/vitest.mjs");
const batchSize = 50;

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
    const specs = await vitest.getRelevantTestSpecifications();
    const files = [...new Set(specs.map(({ moduleId }) => relative(testDir, moduleId)))].sort();
    if (!files.length) throw new Error("Vitest selected zero related test files");
    writeFileSync(output, JSON.stringify(files));
    console.log(`Vitest selected ${files.length} related test files`);
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
