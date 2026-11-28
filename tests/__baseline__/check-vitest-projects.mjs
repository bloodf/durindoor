// Proves the unit/integration projects partition the pre-split inventory:
// every file in exactly one project, union equal to the root include/exclude globs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../vitest.config.js";

const testsDir = fileURLToPath(new URL("../", import.meta.url));
const vitest = resolve(testsDir, "node_modules/vitest/vitest.mjs");

function list(project, cwd = testsDir) {
  const args = [vitest, "list", "--filesOnly", "--json", ...(cwd === testsDir ? [] : ["--config", resolve(testsDir, "vitest.config.js")]), ...(project ? ["--project", project] : [])];
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`vitest list ${project || ""} failed: ${result.error?.message || result.stderr}`);
  return JSON.parse(result.stdout).map(entry => resolve(cwd, typeof entry === "string" ? entry : entry.file)).sort();
}

const expected = globSync(config.test.include, { cwd: testsDir, exclude: config.test.exclude }).map(f => resolve(testsDir, f)).sort();
const unit = list("unit");
const integration = list("integration");
const union = [...unit, ...integration].sort();
for (const file of ["unit/oauth-callback-cleanup.test.js", "unit/oauth-fixed-port-flow.test.js"]) {
  assert.ok(integration.includes(resolve(testsDir, file)), `${file} must be integration`);
}

assert.ok(expected.length > 0, "empty inventory");
assert.ok(unit.length > 0 && integration.length > 0, "a project collected no files");
assert.equal(new Set(union).size, union.length, "duplicate project membership");
assert.deepEqual(union, expected, "projects differ from the original inventory");
assert.deepEqual(list(), expected, "default discovery differs from the original inventory");
console.log(`unit: ${unit.length}; integration: ${integration.length}; total: ${union.length}`);

const repoDir = resolve(testsDir, "..");
const rootUnit = list("unit", repoDir);
const rootIntegration = list("integration", repoDir);
assert.deepEqual(rootUnit, unit, "root unit membership differs");
assert.deepEqual(rootIntegration, integration, "root integration membership differs");
assert.deepEqual(list(undefined, repoDir), expected, "root default inventory differs");
console.log(`root unit: ${rootUnit.length}; integration: ${rootIntegration.length}; total: ${rootUnit.length + rootIntegration.length}`);
