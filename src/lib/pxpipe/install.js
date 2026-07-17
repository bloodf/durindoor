import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "../dataDir.js";

export const PXPIPE_DIR = path.join(DATA_DIR, "pxpipe");
const INSTALL_LOG = path.join(PXPIPE_DIR, "install.log");

export const PXPIPE_MISSING_CODE = "DEPENDENCY_MISSING";

const MISSING_REASONS = {
  not_resolved: "Bundled pxpipe-proxy dependency is missing; reinstall DurinDoor",
  not_found: "Bundled pxpipe-proxy dependency is present but library entry is missing",
  not_loaded: "Bundled pxpipe-proxy dependency is present but failed to load",
};

const STANDALONE_ROOT_ENV = "DURINDOOR_STANDALONE_ROOT";

function ensureDir() {
  if (!fs.existsSync(PXPIPE_DIR)) fs.mkdirSync(PXPIPE_DIR, { recursive: true });
}

function writeInstallLog(message) {
  try {
    ensureDir();
    fs.appendFileSync(INSTALL_LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Logging must never break status queries.
  }
}

const PXPIPE_TRANSFORM_SUBPATH = "./transform";

function getExportedEntry(pkg, subpath) {
  const exportDef = pkg?.exports?.[subpath];
  if (typeof exportDef === "string") {
    return exportDef.startsWith("./") ? exportDef : `./${exportDef}`;
  }
  if (!exportDef || typeof exportDef !== "object") return null;
  const importPath = exportDef.import;
  if (typeof importPath !== "string" || !importPath.endsWith(".js")) return null;
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
  } catch (error) {
    writeInstallLog(`getInstallInfo read error: ${error.message}`);
    return { installed: false, version: null, path: root, reason: MISSING_REASONS.not_loaded, code: PXPIPE_MISSING_CODE };
  }
}

// Runtime npm install is no longer supported. The package is a direct
// dependency. The install API remains so callers can surface a clear error.
export function isInstalling() {
  return false;
}

export function installPxpipe() {
  const info = getInstallInfo();
  if (info.installed) return Promise.resolve(info);
  const err = new Error(info.reason || "PXPIPE dependency is not installed");
  err.code = info.code || PXPIPE_MISSING_CODE;
  err.surface = info.reason || "PXPIPE dependency is not installed";
  writeInstallLog(`installPxpipe refused: ${err.message}`);
  return Promise.reject(err);
}

export function getInstallLogTail(maxLines = 200) {
  try {
    if (!fs.existsSync(INSTALL_LOG)) return "";
    const lines = fs.readFileSync(INSTALL_LOG, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}
