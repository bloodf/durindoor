#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { resolveCliAppDir } = require("./cliBuildPaths");
const { copyRequiredStandaloneSidecars } = require("./standaloneSidecars");

const cliDir = path.resolve(__dirname, "..");
const appDir = path.resolve(cliDir, "..");
const rootDir = path.resolve(appDir, "..");
const cliAppDir = resolveCliAppDir(cliDir);
const buildHomeDir = path.join(cliDir, ".build-home");
const buildDistDirName = ".next-cli-build";
const buildDistDir = path.join(appDir, buildDistDirName);

// Exclude patterns for files/folders we don't want to copy
const EXCLUDE_PATTERNS = [
  "@img",           // Sharp image processing (not needed with unoptimized images)
  "sharp",          // Sharp core lib (not needed with unoptimized images)
  "detect-libc",    // Sharp dependency
  ".env",           // Environment files
  ".env.local",
  ".env.*.local",
  "*.log",          // Log files
  "tmp",            // Temp files
  ".DS_Store",      // macOS files
];

function shouldExclude(name) {
  return EXCLUDE_PATTERNS.some(pattern => {
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      return regex.test(name);
    }
    return name === pattern;
  });
}

// npm pack drops symlinks. Hoist each physical package once, then retain only
// version conflicts below consumers. Conflict payloads use hard links, not copies;
// npm/tar can archive them as safe internal hardlink entries; installs need no repair.
function copyRuntimeModules(sources, dest, sourceRoot) {
  const packages = new Map();
  const checkedRealpath = (file) => {
    const real = fs.realpathSync(file);
    const relative = path.relative(sourceRoot, real);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Copy link escapes its runtime bundle: ${file} -> ${real}`);
    }
    return real;
  };
  const scan = (dir) => {
    const entries = new Map();
    if (!fs.existsSync(dir)) return entries;
    checkedRealpath(dir);
    for (const entry of fs.readdirSync(dir).sort()) {
      if (entry.startsWith(".") || shouldExclude(entry)) continue;
      const names = entry.startsWith("@")
        ? fs.readdirSync(checkedRealpath(path.join(dir, entry))).sort().map(name => `${entry}/${name}`)
        : [entry];
      for (const name of names) {
        const file = path.join(dir, name);
        const real = checkedRealpath(file);
        if (!fs.existsSync(path.join(real, "package.json"))) {
          throw new Error(`Runtime dependency has no package.json: ${file}`);
        }
        entries.set(name, real);
        if (!packages.has(real)) {
          const pkg = { dependencies: null, payload: null };
          packages.set(real, pkg); // Register before following dependency cycles.
          pkg.dependencies = scan(path.join(real, "node_modules"));
        }
      }
    }
    return entries;
  };
  const roots = new Map();
  for (const source of sources) {
    for (const [name, real] of scan(source)) {
      if (!roots.has(name)) roots.set(name, real);
    }
  }
  // Preserve each package's original resolution before merging local and fallback
  // roots. A fallback consumer may need a different version than the app root.
  for (const [real, pkg] of packages) {
    const manifest = JSON.parse(fs.readFileSync(path.join(real, "package.json"), "utf8"));
    const names = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies });
    for (const name of names) {
      if (shouldExclude(name.split("/")[0]) || pkg.dependencies.has(name)) continue;
      for (let dir = real; ; dir = path.dirname(dir)) {
        const candidate = path.join(dir, "node_modules", name);
        if (fs.existsSync(path.join(candidate, "package.json"))) {
          const dependency = checkedRealpath(candidate);
          if (!packages.has(dependency)) {
            const child = { dependencies: null, payload: null };
            packages.set(dependency, child);
            child.dependencies = scan(path.join(dependency, "node_modules"));
          }
          pkg.dependencies.set(name, dependency);
          break;
        }
        if (dir === sourceRoot || dir === path.dirname(dir)) break;
      }
    }
  }
  // Explicit root aliases win over transitive versions encountered during DFS.
  for (const pkg of packages.values()) {
    for (const [name, real] of pkg.dependencies) {
      if (!roots.has(name)) roots.set(name, real);
    }
  }
  const placements = new Map();
  const copyPayload = (source, target, ancestors = new Set()) => {
    const real = checkedRealpath(source);
    if (ancestors.has(real)) throw new Error(`Runtime payload directory cycle: ${source}`);
    const next = new Set(ancestors).add(real);
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(real, { withFileTypes: true })) {
      if (entry.name === "node_modules" || shouldExclude(entry.name)) continue;
      const file = checkedRealpath(path.join(real, entry.name));
      const output = path.join(target, entry.name);
      if (fs.statSync(file).isDirectory()) copyPayload(file, output, next);
      else fs.copyFileSync(file, output);
    }
  };
  const place = (real, target) => {
    placements.set(target, real);
    const pkg = packages.get(real);
    if (pkg.payload) {
      // This source is already inside the destination, not the input bundle.
      const linkPayload = (from, to) => {
        fs.mkdirSync(to, { recursive: true });
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
          if (entry.name === "node_modules") continue;
          const input = path.join(from, entry.name);
          const output = path.join(to, entry.name);
          if (entry.isDirectory()) linkPayload(input, output);
          else fs.linkSync(input, output);
        }
      };
      linkPayload(pkg.payload, target);
    } else {
      copyPayload(real, target);
      pkg.payload = target;
    }
  };
  for (const [name, real] of roots) place(real, path.join(dest, name));
  const resolve = (from, name) => {
    for (let dir = from; ; dir = path.dirname(dir)) {
      const found = placements.get(path.join(dir, "node_modules", name));
      if (found) return found;
      if (dir === path.dirname(dest)) return null;
    }
  };
  const wire = (real, target, ancestors = new Set()) => {
    if (ancestors.has(real)) {
      throw new Error(`Cannot flatten shadowed runtime dependency cycle: ${real}`);
    }
    const next = new Set(ancestors).add(real);
    const nestedPackages = [];
    for (const [name, dependency] of packages.get(real).dependencies) {
      if (resolve(target, name) === dependency) continue;
      const nested = path.join(target, "node_modules", name);
      place(dependency, nested);
      nestedPackages.push([dependency, nested]);
    }
    // Install siblings before resolving their dependencies: a sibling version
    // can shadow a hoisted package for every nested consumer.
    for (const [dependency, nested] of nestedPackages) wire(dependency, nested, next);
  };
  for (const [name, real] of roots) wire(real, path.join(dest, name));
}

// Reject external links instead of pulling shared dependencies or ancestors in.
function copyRecursive(src, dest, sourceRoot, fallbackModules = null) {
  if (!fs.existsSync(src)) {
    console.warn(`Warning: Source ${src} does not exist`);
    return;
  }
  sourceRoot ??= fs.realpathSync(src);
  if (path.basename(src) === "node_modules") {
    copyRuntimeModules([src], dest, sourceRoot);
    return;
  }
  
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldExclude(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.name === "node_modules") {
      copyRuntimeModules(fallbackModules ? [srcPath, fallbackModules] : [srcPath], destPath, sourceRoot);
    } else if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(srcPath);
      const relative = path.relative(sourceRoot, real);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Copy link escapes its runtime bundle: ${srcPath} -> ${real}`);
      }
      if (fs.statSync(real).isDirectory()) {
        throw new Error(`Runtime payload directory symlink is not supported: ${srcPath}`);
      }
      fs.copyFileSync(real, destPath);
    } else if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath, sourceRoot);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  if (fallbackModules && !fs.existsSync(path.join(src, "node_modules"))) {
    copyRuntimeModules([fallbackModules], path.join(dest, "node_modules"), sourceRoot);
  }
}

module.exports = { copyRecursive };

if (require.main === module) {
console.log("📦 Building 9Router CLI package with Next.js...\n");

fs.mkdirSync(buildHomeDir, { recursive: true });
fs.mkdirSync(path.join(buildHomeDir, "AppData", "Roaming"), { recursive: true });
fs.mkdirSync(path.join(buildHomeDir, "AppData", "Local"), { recursive: true });

console.log("0️⃣  Syncing version to app/package.json...");
const cliPkg = JSON.parse(fs.readFileSync(path.join(cliDir, "package.json"), "utf8"));
const appPkgPath = path.join(appDir, "package.json");
const appPkg = JSON.parse(fs.readFileSync(appPkgPath, "utf8"));
if (appPkg.version !== cliPkg.version) {
  appPkg.version = cliPkg.version;
  fs.writeFileSync(appPkgPath, JSON.stringify(appPkg, null, 2) + "\n");
  console.log(`✅ Version synced: ${cliPkg.version}\n`);
} else {
  console.log(`✅ Version already synced: ${cliPkg.version}\n`);
}

// Remove any stale staged build so compiled modules never survive across runs
// (port of decolua/9router #2748). Prevents stale-module runtime bugs.
if (fs.existsSync(buildDistDir)) {
  fs.rmSync(buildDistDir, { recursive: true, force: true });
}
console.log("1️⃣  Building Next.js app...");
try {
  execSync("npm run build", {
    stdio: "inherit",
    cwd: appDir,
    env: {
      ...process.env,
      HOME: buildHomeDir,
      USERPROFILE: buildHomeDir,
      APPDATA: path.join(buildHomeDir, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(buildHomeDir, "AppData", "Local"),
      NEXT_DIST_DIR: buildDistDirName,
      NEXT_TRACING_ROOT_MODE: "workspace",
    }
  });
  console.log("✅ Next.js build completed\n");
} catch (error) {
  console.error("❌ Next.js build failed");
  process.exit(1);
}

console.log("2️⃣  Cleaning old app/cli/app...");
if (fs.existsSync(cliAppDir)) {
  fs.rmSync(cliAppDir, { recursive: true, force: true });
}
console.log("✅ Cleaned\n");

// Newer Next.js standalone output writes server.js/package.json plus .next/, src/, and
// node_modules/ directly under .next/standalone, but sometimes nests under a workspace
// project subfolder (e.g. 9router/). Scan any direct subdir for server.js before falling back to app/.
console.log("3️⃣  Copying Next.js standalone build to app/cli/app...");
const standaloneRoot = path.join(appDir, ".next", "standalone");
const standaloneRootResolved = path.join(buildDistDir, "standalone");
let standaloneRootToUse = fs.existsSync(standaloneRootResolved) ? standaloneRootResolved : standaloneRoot;
// Next.js 16 nests standalone output under the project name when NEXT_TRACING_ROOT_MODE=workspace
// e.g. .next-cli-build/standalone/9router/server.js
let standaloneApp = standaloneRootToUse;
if (!fs.existsSync(path.join(standaloneApp, "server.js"))) {
  const subdirs = fs.readdirSync(standaloneRootToUse).filter(name => {
    try {
      return fs.statSync(path.join(standaloneRootToUse, name)).isDirectory() && name !== "node_modules";
    } catch {
      return false;
    }
  });
  const found = subdirs.find(name => fs.existsSync(path.join(standaloneRootToUse, name, "server.js")));
  if (found) {
    standaloneApp = path.join(standaloneRootToUse, found);
  } else {
    standaloneApp = path.join(standaloneRootToUse, "app");
  }
}
if (!fs.existsSync(standaloneApp)) {
  console.error("❌ Next.js standalone build not found under .next/standalone");
  console.error("Expected either .next/standalone/server.js or .next/standalone/app/ or .next/standalone/[folder]/");
  process.exit(1);
}
// Merge nested-app and standalone-root dependencies in one placement graph.
// Local aliases win, while fallback consumers retain their original versions.
const standaloneNodeModules = path.join(standaloneRootToUse, "node_modules");
copyRecursive(standaloneApp, cliAppDir, fs.realpathSync(standaloneRootToUse),
  standaloneApp !== standaloneRootToUse && fs.existsSync(standaloneNodeModules) ? standaloneNodeModules : null);
console.log("✅ Copied standalone build\n");

// Step 3a: Copy custom server + required root sidecars (custom-server.js
// injects real socket IP / strips spoofable XFF; head-response-guard.cjs is
// its #6608 HEAD guard). These live outside Next's standalone trace, so a
// missing copy crashes the shipped CLI at boot (OmniRoute #6908).
console.log("3️⃣ a Copying custom server + sidecars...");
try {
  copyRequiredStandaloneSidecars(appDir, cliAppDir);
  console.log("✅ Copied custom-server.js + head-response-guard.cjs\n");
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

// Step 3b: Ensure sql.js (pure JS fallback) bundled in app/cli/app/node_modules.
// Strip better-sqlite3 (native) — it lives in ~/.9router/runtime to avoid
// Windows EBUSY during global CLI updates. node:sqlite (Node ≥22.5) is also
// available as a no-install middle tier.
console.log("3️⃣ b Configuring SQLite drivers...");
function ensureModuleInBundle(pkg, { required = false } = {}) {
  const dest = path.join(cliAppDir, "node_modules", pkg);
  if (fs.existsSync(dest)) {
    console.log(`✅ ${pkg} already bundled`);
    return dest;
  }
  const candidates = [
    path.join(appDir, "node_modules", pkg),
    path.join(rootDir, "node_modules", pkg),
  ];
  const src = candidates.find((p) => fs.existsSync(p));
  if (!src) {
    if (required) throw new Error(`Required standalone dependency ${pkg} not found locally`);
    console.warn(`⚠️  ${pkg} not found locally — bundle will rely on node:sqlite or runtime install`);
    return null;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyRecursive(src, dest);
  console.log(`✅ Bundled ${pkg}`);
  return dest;
}
function ensureModuleTree(pkg, seen = new Set()) {
  if (seen.has(pkg)) return;
  seen.add(pkg);
  const dest = ensureModuleInBundle(pkg, { required: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
  for (const dependency of Object.keys(manifest.dependencies || {})) ensureModuleTree(dependency, seen);
}
ensureModuleInBundle("sql.js");
ensureModuleTree("https-proxy-agent");
ensureModuleTree("socks-proxy-agent");
ensureModuleTree("jsonc-parser");
ensureModuleTree("undici");
ensureModuleTree("stream-json");
const betterDir = path.join(cliAppDir, "node_modules", "better-sqlite3");
if (fs.existsSync(betterDir)) {
  fs.rmSync(betterDir, { recursive: true, force: true });
  console.log("✅ Stripped better-sqlite3 (lives in ~/.9router/runtime)");
}
console.log("");

console.log("4️⃣  Copying static files...");
const staticSrc = path.join(appDir, ".next", "static");
const staticSrcResolved = path.join(buildDistDir, "static");
const staticDest = path.join(cliAppDir, buildDistDirName, "static");
if (fs.existsSync(staticSrcResolved) || fs.existsSync(staticSrc)) {
  copyRecursive(fs.existsSync(staticSrcResolved) ? staticSrcResolved : staticSrc, staticDest);
  console.log("✅ Copied static files\n");
} else {
  console.log("⏭️  No static files found\n");
}

console.log("5️⃣  Copying public folder...");
const publicSrc = path.join(appDir, "public");
const publicDest = path.join(cliAppDir, "public");
if (fs.existsSync(publicSrc)) {
  copyRecursive(publicSrc, publicDest);
  console.log("✅ Copied public folder\n");
} else {
  console.log("⏭️  No public folder found\n");
}

// Step 6: Copy vendor-chunks (required for production)
console.log("6️⃣  Copying vendor-chunks...");
const vendorChunksSrc = path.join(appDir, ".next", "server", "vendor-chunks");
const vendorChunksSrcResolved = path.join(buildDistDir, "server", "vendor-chunks");
const vendorChunksDest = path.join(cliAppDir, buildDistDirName, "server", "vendor-chunks");
if (fs.existsSync(vendorChunksSrcResolved) || fs.existsSync(vendorChunksSrc)) {
  copyRecursive(fs.existsSync(vendorChunksSrcResolved) ? vendorChunksSrcResolved : vendorChunksSrc, vendorChunksDest);
  console.log("✅ Copied vendor-chunks\n");
} else {
  console.log("⏭️  No vendor-chunks found\n");
}

// Step 7: Copy MITM server files (not bundled by Next.js standalone)
console.log("7️⃣  Copying MITM server files...");
const mitmSrc = path.join(appDir, "src", "mitm");
const mitmDest = path.join(cliAppDir, "src", "mitm");
if (fs.existsSync(mitmSrc)) {
  copyRecursive(mitmSrc, mitmDest);
  console.log("✅ Copied MITM files\n");
} else {
  console.log("⏭️  No MITM files found\n");
}

// Step 7b: Copy standalone updater (headless Node process for install progress)
console.log("7️⃣ b Copying updater files...");
const updaterSrc = path.join(appDir, "src", "lib", "updater");
const updaterDest = path.join(cliAppDir, "src", "lib", "updater");
if (fs.existsSync(updaterSrc)) {
  copyRecursive(updaterSrc, updaterDest);
  console.log("✅ Copied updater files\n");
} else {
  console.log("⏭️  No updater files found\n");
}

// Step 8: Build MITM server (config driven - see app/cli/scripts/buildMitm.js)
console.log("8️⃣  Building MITM server...");
try {
  execSync("node scripts/buildMitm.js", { stdio: "inherit", cwd: cliDir });
  console.log("✅ MITM server build completed\n");
} catch (error) {
  console.error("❌ MITM build failed");
  process.exit(1);
}

console.log("✨ CLI package build completed!");
console.log(`📁 Output: ${cliAppDir}`);

try {
  const { execSync: exec } = require("child_process");
  const size = exec(`du -sh "${cliAppDir}"`, { encoding: "utf8" }).trim();
  console.log(`📊 Package size: ${size.split("\t")[0]}`);
} catch (e) {
  // Silent fail on size check
}
}
