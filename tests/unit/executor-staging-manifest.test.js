/**
 * #2311: staging is declared in open-sse/executors/staged.json, not in comments.
 * An executor or provider module is staged when no production entry point can
 * import it. The manifest must match that set exactly, so both an undeclared
 * orphan and a promoted module still listed as staged fail here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "../../open-sse/executors/staged.json";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { hasSpecializedExecutor } from "../../open-sse/executors/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = /\.(?:[cm]?js|jsx|tsx?)$/;
const NOT_PRODUCTION = /\.(?:test|spec|stories)\./;
// A copy-me template for new registry entries; it is never meant to be imported.
const TEMPLATES = new Set(["open-sse/providers/REGISTRY_TEMPLATE.js"]);
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"'\n]+)["']/gm;

const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
  if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
  const relative = `${dir}/${entry.name}`;
  if (entry.isDirectory()) return walk(relative);
  return SOURCE.test(entry.name) && !NOT_PRODUCTION.test(entry.name) ? [relative] : [];
});

const files = new Set([...walk("src"), ...walk("open-sse")]);

function resolveImport(from, specifier) {
  let base = null;
  if (specifier.startsWith(".")) base = path.posix.join(path.posix.dirname(from), specifier);
  else if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier === "open-sse" || specifier.startsWith("open-sse/")) base = specifier;
  if (!base) return null;
  return [base, `${base}.js`, `${base}.mjs`, `${base}.jsx`, `${base}.ts`, `${base}/index.js`].find((file) => files.has(file)) ?? null;
}

function unreachableModules() {
  const queue = [...files].filter((file) => file.startsWith("src/"));
  queue.push("open-sse/index.js", "open-sse/executors/index.js", "open-sse/providers/index.js");
  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of fs.readFileSync(path.join(root, file), "utf8").matchAll(IMPORT)) {
      const target = resolveImport(file, match[1]);
      if (target) queue.push(target);
    }
  }
  return [...files]
    .filter((file) => /^open-sse\/(?:executors|providers)\//.test(file) && !seen.has(file) && !TEMPLATES.has(file))
    .sort();
}

describe("executor staging manifest", () => {
  it("lists exactly the executor and provider modules production cannot reach", () => {
    expect(manifest.modules.map((entry) => entry.module).sort()).toEqual(unreachableModules());
  });

  it("marks every entry staged and gives a reason", () => {
    for (const entry of manifest.modules) {
      expect(entry.staged, entry.module).toBe(true);
      expect(entry.reason?.length, entry.module).toBeGreaterThan(0);
    }
  });

  it("declares a staged executor whose provider is already in the catalog", () => {
    const catalog = new Set(REGISTRY.map((entry) => entry.id));
    for (const entry of manifest.modules) {
      const id = path.basename(entry.module, ".js");
      expect(entry.catalogProvider, entry.module).toBe(catalog.has(id) ? id : undefined);
      if (entry.catalogProvider) expect(hasSpecializedExecutor(entry.catalogProvider), entry.module).toBe(false);
    }
  });
});
