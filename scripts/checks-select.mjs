import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Select existing changed files that can be checked by ESLint or Vitest. */
export function selectChecks(changedFiles) {
  const result = { eslint: [], tests: [], related: [] };
  for (const file of new Set(changedFiles)) {
    if (!file || !existsSync(path.join(root, file))) continue;
    if (/^src\/.*\.(?:js|jsx|mjs)$/.test(file)) result.eslint.push(file);
    if (/^tests\/(?:unit|translator)\/.*\.test\.(?:js|mjs)$/.test(file)) {
      result.tests.push(file.slice(6));
    } else if (!file.startsWith("tests/") && /\.(?:js|jsx|mjs|cjs|ts|tsx)$/.test(file)) {
      result.related.push(file);
    }
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error("Usage: node scripts/checks-select.mjs <file-list>");
    process.exitCode = 1;
  } else {
    const files = (await readFile(process.argv[2], "utf8")).split(/\r?\n/);
    console.log(JSON.stringify(selectChecks(files)));
  }
}
