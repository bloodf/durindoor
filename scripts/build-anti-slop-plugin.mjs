#!/usr/bin/env node
/**
 * Bundle the vendored TypeScript anti-slop oxlint plugin to plain ESM JavaScript.
 *
 * Node 20.20.x (CI pin) does not support `--experimental-strip-types`, so oxlint
 * loads `./tools/oxlint/anti-slop/index.bundle.js` instead of `index.ts`.
 *
 * @see docs/development/anti-slop.md
 */

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(ROOT, "tools/oxlint/anti-slop/index.ts");
const outfile = path.join(ROOT, "tools/oxlint/anti-slop/index.bundle.js");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "info",
});

console.log(`anti-slop plugin bundled → ${path.relative(ROOT, outfile)}`);
