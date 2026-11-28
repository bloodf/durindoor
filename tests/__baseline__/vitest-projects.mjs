import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(resolve(root, "package.json"));
const { transformSync } = require("esbuild");
const { parse: parseJavaScript } = require("@babel/parser");
const overrides = {
  unit: new Set(["translator/golden-request.test.js"]),
  integration: new Set(["unit/oauth-callback-cleanup.test.js", "unit/oauth-fixed-port-flow.test.js"]),
};
const resourceImport = /(?:from\s*|import\s*\(|require\s*\()["'](?:node:)?(?:child_process|worker_threads|better-sqlite3|sql\.js|@electric-sql\/pglite)["']/g;
const resourceOperation = /\b(?:(?:process\.env\.)?DATA_DIR|mkdtemp(?:Sync)?|new\s+Worker|createServer|\.listen)\s*(?:\(|\b)/;
const localImport = /(?:\bfrom\s*|\bimport\s*\(|\bimportActual\s*\(|\bimport\s*)["']((?:\.{1,2}\/|@\/|open-sse\/)[^"']+)["']/g;

function parse(source) {
  return transformSync(source, { loader: "jsx", legalComments: "none" }).code;
}
function containsResource(code) {
  const importMatches = [...code.matchAll(resourceImport)];
  if (!importMatches.length && !resourceOperation.test(code)) return false;
  // Token positions protect regular expressions and strings without hiding
  // executable template interpolations; esbuild has already removed comments.
  const tokens = parseJavaScript(code, { sourceType: "unambiguous", tokens: true }).tokens;
  if (importMatches.some((match) => !tokens.some((token) =>
    ["string", "regexp", "template"].includes(token.type.label) &&
    token.start <= match.index && match.index < token.end))) return true;
  const chars = code.split("");
  for (const token of tokens) {
    if (["string", "regexp", "template"].includes(token.type.label)) {
      for (let i = token.start; i < token.end; i++) chars[i] = " ";
    }
  }
  return resourceOperation.test(chars.join(""));
}
/** Conservatively classify malformed source as integration. */
export function isIntegrationSource(source) {
  try { return containsResource(parse(source)); } catch { return true; }
}

/** Classify a test and its local transitive imports, with cycle-safe memoization. */
export function createFileClassifier(testsDir, repoRoot = root) {
  repoRoot = resolve(repoRoot);
  const sources = new Map();
  const results = new Map();
  return function isIntegration(entry) {
    if (overrides.unit.has(entry)) return false;
    if (overrides.integration.has(entry)) return true;
    const entryPath = resolve(testsDir, entry);
    const seen = new Set();
    const pending = [entryPath];
    while (pending.length) {
      const file = pending.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      if (results.has(file)) {
        if (results.get(file)) { results.set(entryPath, true); return true; }
        continue;
      }
      let record = sources.get(file);
      if (!record) {
        let source;
        try { source = readFileSync(file, "utf8"); } catch { results.set(entryPath, true); return true; }
        const dependencies = [];
        for (const match of source.matchAll(localImport)) {
          const specifier = match[1];
          const target = specifier.startsWith("@/") ? resolve(repoRoot, "src", specifier.slice(2))
            : specifier.startsWith("open-sse/") ? resolve(repoRoot, specifier)
            : resolve(dirname(file), specifier);
          if (target.startsWith(repoRoot + "/") && !target.includes("/node_modules/")) {
            for (const candidate of [target, target + ".js", target + ".mjs", resolve(target, "index.js")]) {
              if (existsSync(candidate)) { dependencies.push(candidate); break; }
            }
          }
        }
        // Only candidate resource operations need tokenization; raw imports
        // may add conservative edges, including imports in comments.
        const candidate = [...source.matchAll(resourceImport)].length > 0 || resourceOperation.test(source);
        record = { matches: candidate && isIntegrationSource(source), dependencies };
        sources.set(file, record);
      }
      if (record.matches) { results.set(entryPath, true); return true; }
      pending.push(...record.dependencies);
    }
    for (const file of seen) results.set(file, false);
    return false;
  };
}
