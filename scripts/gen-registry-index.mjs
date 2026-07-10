#!/usr/bin/env node
/**
 * gen-registry-index.mjs
 *
 * Regenerates `open-sse/providers/registry/index.js`, the static-import barrel
 * that aggregates every provider registry module into one default-export array.
 *
 * The registry is consumed by `open-sse/providers/index.js` (PROVIDERS), which
 * in turn feeds the model catalog (`config/providerModels.js`), provider
 * lookup, and the `/v1/models` route. A bundler-friendly static import list is
 * required because dynamic `import()` of the whole directory is not analyzable
 * by Next/webpack. Hand-editing it is error-prone; this script is the source of
 * truth.
 *
 * Behavior:
 *  - Scans `open-sse/providers/registry/*.js`.
 *  - Excludes only `index.js` itself. `REGISTRY_TEMPLATE.js` lives in the
 *    parent `open-sse/providers/` dir, so it is never in scope.
 *  - Sorts filenames deterministically by code point (`Array.prototype.sort()`),
 *    NOT localeCompare, so output is identical across OS/CI locales.
 *  - Assigns import ids `p0..pN` in sorted order.
 *  - Detects array-valued modules (`export default [ ... ]`, e.g.
 *    `omniroute-api-cloud.js`) and emits `...pN` in the aggregate array so the
 *    flattened shape is preserved. Object-valued modules emit plain `pN`.
 *  - Writes a header `// Auto-generated: static imports of all registry entries`.
 *
 * Modes:
 *  - Default: rewrite the file in place (idempotent — byte-identical output
 *    when nothing changed).
 *  - `--check`: do not write; exit non-zero if the committed file drifts from
 *    freshly generated content. Used by CI / `npm run check:registry-index`.
 *
 * Usage:
 *   node scripts/gen-registry-index.mjs          # write
 *   node scripts/gen-registry-index.mjs --check  # verify only
 *
 * @module scripts/gen-registry-index
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Repo root (parent of scripts/). */
export const root = path.resolve(__dirname, "..");
/** Directory holding per-provider registry modules. */
export const registryDir = path.join(root, "open-sse", "providers", "registry");
/** Output barrel file path. */
export const indexPath = path.join(registryDir, "index.js");

const HEADER = "// Auto-generated: static imports of all registry entries";

/**
 * Detect whether a module's default export is an array.
 *
 * Array-valued registry modules (e.g. `omniroute-api-cloud.js`) export multiple
 * provider entries in one file and must be spread into the aggregate array to
 * preserve the flat registry shape consumed downstream.
 *
 * Detection imports the module and inspects the runtime value of its default
 * export (`Array.isArray`) rather than matching source text. That avoids
 * misclassifying `export default [` written inside block comments, template
 * literals, or strings. Registry entry modules are self-contained (constants +
 * a default export) and import cleanly under Node.
 *
 * @param {string} filePath Absolute path to the module.
 * @returns {Promise<boolean>} True when the default export is an array.
 */
export async function isArrayExport(filePath) {
  const mod = await import(pathToFileURL(filePath).href);
  return Array.isArray(mod.default);
}

/**
 * List registry entry filenames to include in the barrel.
 *
 * Returns `*.js` files in `registryDir` except `index.js`, sorted by code
 * point. Code-point sort is deliberate: it is locale-independent and therefore
 * reproducible on Linux/macOS/CI. `REGISTRY_TEMPLATE.js` is never returned
 * because it lives in the parent directory, not in `registryDir`.
 *
 * @param {string} [dir=registryDir] Directory to scan.
 * @returns {Promise<string[]>} Sorted filenames (basenames only).
 */
export async function listRegistryFiles(dir = registryDir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".js") && e.name !== "index.js")
    .map((e) => e.name)
    .sort();
}

/**
 * Generate the full barrel file contents for the given registry directory.
 *
 * @param {string} [dir=registryDir] Directory to scan.
 * @returns {Promise<string>} Complete file text (trailing newline included).
 */
export async function generateIndex(dir = registryDir) {
  const files = await listRegistryFiles(dir);
  const spread = new Array(files.length);

  for (let i = 0; i < files.length; i++) {
    spread[i] = await isArrayExport(path.join(dir, files[i]));
  }

  const imports = files.map(
    (f, i) => `import p${i} from "./${f}";`,
  );
  const entries = files.map((_, i) => (spread[i] ? `  ...p${i},` : `  p${i},`));

  return [
    HEADER,
    ...imports,
    "",
    "export default [",
    ...entries,
    "];",
    "",
  ].join("\n");
}

/**
 * Run the generator. Injectable paths/mode make the CLI contract testable
 * against temp fixtures without touching the real registry index.
 *
 * @param {Object} [opts]
 * @param {string} [opts.dir=registryDir] Directory to scan.
 * @param {string} [opts.indexPath=indexPath] Output file path.
 * @param {boolean} [opts.check=false] When true, verify only; never write.
 * @returns {Promise<{exitCode: number, message: string, dirty?: boolean}>}
 *   `exitCode` is 0 on success / up-to-date, 1 when `--check` finds drift.
 *   `dirty` is present only in `--check` mode (true = drift detected).
 */
export async function main(opts = {}) {
  const dir = opts.dir ?? registryDir;
  const outPath = opts.indexPath ?? indexPath;
  const check = opts.check ?? false;
  const generated = await generateIndex(dir);

  if (check) {
    const committed = await readFile(outPath, "utf8").catch(() => "");
    if (generated !== committed) {
      return {
        exitCode: 1,
        dirty: true,
        message:
          "registry/index.js drift detected. Run `npm run gen:registry-index` and commit the result.",
      };
    }
    return { exitCode: 0, dirty: false, message: "registry/index.js is up to date." };
  }

  await writeFile(outPath, generated, "utf8");
  return { exitCode: 0, message: `wrote ${outPath}` };
}

async function cli() {
  const result = await main({ check: process.argv.includes("--check") });
  if (result.dirty) console.error(result.message);
  else console.log(result.message);
  process.exitCode = result.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await cli();
}
