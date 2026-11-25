import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isMainModule } from "./lib/is-main-module.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Select changed tests and tracked tests that mention changed source imports. */
export function selectChecks(changedFiles, deletedFiles = []) {
  const result = { eslint: [], tests: [], related: [] };
  for (const file of new Set(changedFiles)) {
    if (!file || !existsSync(path.join(root, file))) continue;
    if (/^src\/.*\.(?:js|jsx|mjs)$/.test(file)) result.eslint.push(file);
    if (/^tests\/(?:unit|translator)\/.*\.test\.(?:js|mjs)$/.test(file)) {
      result.tests.push(file.slice(6));
    } else if (!file.startsWith("tests/") && /\.(?:js|jsx|mjs|cjs|ts|tsx)$/.test(file)) {
      addRelated(file, result.related);
    }
  }
  const deleted = [...new Set(deletedFiles.filter(Boolean))];
  if (deleted.length) {
    result.fullLint = true;
    for (const file of deleted) {
      if (/\.(?:js|jsx|mjs|cjs|ts|tsx)$/.test(file) && !file.startsWith("tests/")) addRelated(file, result.related);
      const basename = path.basename(file, path.extname(file));
      if (!basename) continue;
      let matches;
      try {
        matches = execFileSync("git", ["grep", "-l", "-F", "-e", basename, "--", ":(glob)tests/**/*.test.js", ":(glob)tests/**/*.test.mjs"], { cwd: root, encoding: "utf8" });
      } catch (error) {
        if (error.status === 1) continue;
        throw error;
      }
      for (const match of matches.trim().split("\n")) {
        const test = match.slice(6);
        if (!result.tests.includes(test)) result.tests.push(test);
      }
    }
  }
  return result;
}

// Git searches tracked test files even when the source has been deleted.
function addRelated(file, related) {
  const ext = path.extname(file);
  const stemPath = file.slice(0, -ext.length);
  const stem = path.basename(stemPath);
  const patterns = [stemPath];
  if (file.startsWith("src/")) patterns.push(`@/${stemPath.slice(4)}`);
  if (stem !== "index") {
    for (const suffix of ['"', '.js"', "'", ".js'"]) patterns.push(`/${stem}${suffix}`);
  }
  let matches;
  try {
    matches = execFileSync("git", ["grep", "-l", "-F", ...patterns.flatMap((pattern) => ["-e", pattern]), "--", ":(glob)tests/**/*.test.js", ":(glob)tests/**/*.test.mjs"], { cwd: root, encoding: "utf8" });
  } catch (error) {
    if (error.status === 1) return;
    throw error;
  }
  for (const match of matches.trim().split("\n")) {
    const test = match.slice(6);
    if (!related.includes(test)) related.push(test);
  }
}

if (isMainModule(import.meta.url)) {
  if (!process.argv[2]) {
    console.error("Usage: node scripts/checks-select.mjs <file-list> [deleted-file-list]");
    process.exitCode = 1;
  } else {
    const files = (await readFile(process.argv[2], "utf8")).split(/\r?\n/);
    const deleted = process.argv[3] ? (await readFile(process.argv[3], "utf8")).split(/\r?\n/) : [];
    console.log(JSON.stringify(selectChecks(files, deleted)));
  }
}
