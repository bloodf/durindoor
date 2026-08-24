import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "../dataDir.js";
import { isObject, isString } from "../../shared/utils/typeChecks.js";

export const PXPIPE_DIR = path.join(DATA_DIR, "pxpipe");

export const PXPIPE_MISSING_CODE = "DEPENDENCY_MISSING";

const MISSING_REASONS = {
  not_resolved: "Bundled pxpipe-proxy dependency is missing; reinstall DurinDoor",
  not_found: "Bundled pxpipe-proxy dependency is present but library entry is missing",
  not_loaded: "Bundled pxpipe-proxy dependency is present but failed to load"
};

const STANDALONE_ROOT_ENV = "DURINDOOR_STANDALONE_ROOT";


const PXPIPE_TRANSFORM_SUBPATH = "./transform";

function getExportedEntry(pkg, subpath) {
  const exportDef = pkg?.exports?.[subpath];
  if (isString(exportDef)) {
    return exportDef.startsWith("./") ? exportDef : `./${exportDef}`;
  }
  if (!exportDef || !isObject(exportDef)) return null;
  const importPath = exportDef.import;
  if (!isString(importPath) || !importPath.endsWith(".js")) return null;
  return importPath;
}

/**
 * Find the installed pxpipe-proxy package root on disk. This function avoids
 * import.meta.resolve because Next.js server bundling replaces it with a stub
 * that cannot resolve ESM-only exports. Instead we look in the obvious places:
 *   1. The standalone runtime root (production custom server sets this).
 *   2. The node_modules tree above this source file (dev/tests).
 *   3. process.cwd() as a last-ditch fallback (build-time scripts).
 */
function findPackageRoot() {
  const standalone = process.env[STANDALONE_ROOT_ENV];
  if (standalone) {
    const root = path.join(standalone, "node_modules", "pxpipe-proxy");
    if (fs.existsSync(root)) return root;
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", "pxpipe-proxy");
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  const cwdCandidate = path.join(process.cwd(), "node_modules", "pxpipe-proxy");
  return fs.existsSync(cwdCandidate) ? cwdCandidate : null;
}

function resolveLibraryEntry() {
  const root = findPackageRoot();
  if (!root) return null;
  const pkgJson = path.join(root, "package.json");
  let exportPath = null;
  try {
    const pkg = fs.existsSync(pkgJson) ? JSON.parse(fs.readFileSync(pkgJson, "utf8")) : {};
    exportPath = getExportedEntry(pkg, PXPIPE_TRANSFORM_SUBPATH);
  } catch {
    return null;
  }
  if (!exportPath) return null;
  const resolvedRoot = path.resolve(root);
  const entry = path.resolve(resolvedRoot, exportPath);
  if (!entry.startsWith(`${resolvedRoot}${path.sep}`) && entry !== resolvedRoot) return null;
  return fs.existsSync(entry) ? entry : null;
}

export function packageRoot() {
  return findPackageRoot() || "";
}

export function libraryEntry() {
  return resolveLibraryEntry() || "";
}

// { installed, version, path, reason, code } — installed means the exported
// library entry exists and is readable. The package is a declared dependency;
// no runtime network install is performed.
export function getInstallInfo() {
  const root = findPackageRoot();
  if (!root) {
    return { installed: false, version: null, path: null, reason: MISSING_REASONS.not_resolved, code: PXPIPE_MISSING_CODE };
  }
  const entry = resolveLibraryEntry();
  if (!entry) {
    return { installed: false, version: null, path: root, reason: MISSING_REASONS.not_found, code: PXPIPE_MISSING_CODE };
  }
  try {
    const pkgJson = path.join(root, "package.json");
    const pkg = fs.existsSync(pkgJson) ? JSON.parse(fs.readFileSync(pkgJson, "utf8")) : {};
    return { installed: true, version: pkg.version || null, path: root };
  } catch {
    // Unreadable package.json means the bundled dependency is corrupt.
    return { installed: false, version: null, path: root, reason: MISSING_REASONS.not_loaded, code: PXPIPE_MISSING_CODE };
  }
}