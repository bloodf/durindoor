#!/usr/bin/env node

/**
 * Run ESLint from an isolated checkout.
 *
 * pnpm does not hoist ESLint to the root `node_modules/eslint`, so a checkout
 * that links its dependencies from a shared store has no `node_modules/eslint`
 * entry and `node node_modules/eslint/bin/eslint.js` fails with MODULE_NOT_FOUND.
 * The virtual store still holds the package, so resolve it from there when the
 * top-level link is missing. Nothing is installed or relinked.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const direct = resolve(root, "node_modules/eslint/bin/eslint.js");
let eslintBin = existsSync(direct) ? direct : null;

if (!eslintBin) {
  const virtualStore = resolve(root, "node_modules/.pnpm");
  try {
    const entries = readdirSync(virtualStore).filter((entry) => entry.startsWith("eslint@"));
    for (const entry of entries) {
      const candidate = join(virtualStore, entry, "node_modules/eslint/bin/eslint.js");
      if (existsSync(candidate)) {
        eslintBin = candidate;
        break;
      }
    }
  } catch {
    // Report the same clear resolution error below when the virtual store is absent.
  }
}

if (!eslintBin) {
  process.stderr.write("Unable to locate ESLint under node_modules or the pnpm virtual store.\n");
  process.exit(1);
}

const result = spawnSync(process.execPath, [eslintBin, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
