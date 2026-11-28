import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(resolve(root, "package.json"));
const { transformSync } = require("esbuild");
const { parse: parseJavaScript } = require("@babel/parser");
const CACHE_VERSION = 1;
const overrides = {
  unit: new Set(["translator/golden-request.test.js"]),
  integration: new Set(["unit/oauth-callback-cleanup.test.js", "unit/oauth-fixed-port-flow.test.js"]),
};
const resourceImport = /(?:from\s*|import\s*\(|require\s*\(|import\s*)\s*["'](?:node:)?(?:child_process|worker_threads|better-sqlite3|sql\.js|@electric-sql\/pglite)["']/g;
const resourceOperation = /\b(?:(?:process\.env\.)?DATA_DIR|mkdtemp(?:Sync)?|new\s+Worker|createServer|\.listen)\s*(?:\(|\b)/;
const localImport = /(?:\bfrom\s*|\bimport\s*\(|\bimportActual\s*\(|\brequire\s*\(|\bimport\s*)\s*["']((?:\.{1,2}\/|@\/|open-sse\/)[^"']+)["']/g;

function parse(source) {
  return transformSync(source, { loader: "jsx", legalComments: "none" }).code;
}
function containsResource(code) {
  const importMatches = [...code.matchAll(resourceImport)];
  if (!importMatches.length && !resourceOperation.test(code)) return false;
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
  const cacheFile = resolve(testsDir, "node_modules/.cache/vitest-projects.json");
  let persistent = {};
  try {
    const data = JSON.parse(readFileSync(cacheFile, "utf8"));
    if (data.version === CACHE_VERSION && data.files && typeof data.files === "object" && !Array.isArray(data.files)) persistent = data.files;
  } catch { /* Missing, corrupt, or unreadable cache is rebuilt. */ }
  const sources = new Map();
  const results = new Map();
  let changed = false;
  function readRecord(file) {
    if (sources.has(file)) return sources.get(file);
    let stat;
    try { stat = statSync(file); } catch { return { matches: true, imports: [] }; }
    const cached = persistent[file];
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs &&
      typeof cached.matches === "boolean" && Array.isArray(cached.imports) && cached.imports.every((item) => typeof item === "string")) {
      sources.set(file, cached);
      return cached;
    }
    let matches = true;
    let imports = [];
    try {
      const source = readFileSync(file, "utf8");
      const code = parse(source);
      matches = containsResource(code);
      // Preserve the existing conservative commented-import behavior while
      // collecting executable imports from canonicalized source.
      imports = [...new Set([...code.matchAll(localImport), ...source.matchAll(localImport)].map((match) => match[1]))];
    } catch { /* Parse failures are integration. */ }
    const record = { size: stat.size, mtimeMs: stat.mtimeMs, matches, imports };
    persistent[file] = record;
    sources.set(file, record);
    changed = true;
    return record;
  }
  function isIntegration(entry) {
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
      const record = readRecord(file);
      if (record.matches) { results.set(entryPath, true); return true; }
      for (const specifier of record.imports) {
        const target = specifier.startsWith("@/") ? resolve(repoRoot, "src", specifier.slice(2))
          : specifier.startsWith("open-sse/") ? resolve(repoRoot, specifier)
          : resolve(dirname(file), specifier);
        if (target.startsWith(repoRoot + "/") && !target.includes("/node_modules/")) {
          for (const candidate of [target, target + ".js", target + ".mjs", resolve(target, "index.js")]) {
            if (existsSync(candidate)) { pending.push(candidate); break; }
          }
        }
      }
    }
    for (const file of seen) results.set(file, false);
    return false;
  }
  isIntegration.saveCache = () => {
    if (!changed) return;
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      const temp = `${cacheFile}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(temp, JSON.stringify({ version: CACHE_VERSION, files: persistent }));
      renameSync(temp, cacheFile);
    } catch { /* Cache is optional; classification remains valid without it. */ }
  };
  return isIntegration;
}
