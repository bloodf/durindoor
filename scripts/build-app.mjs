#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createIsolatedBuildEnvironment } from "./build-environment.mjs";

const require = createRequire(import.meta.url);

/**
 * Rebuild only traced/runtime packages, never the shared node_modules pool.
 * NFT can preserve node_modules itself as an external symlink; existsSync then
 * mistakes every shared package for a bundled one, and later writes escape.
 * Resolve dependencies at their source location and keep deduplicated links
 * relative to the artifact so nested versions and relocation remain safe.
 */
export function materializeStandaloneDependencies(standaloneDir, distDir, sourceRoot, runtimePackages) {
  const modules = path.join(standaloneDir, "node_modules");
  const seeds = new Map();
  const findPackage = (name, from) => {
    for (let dir = from; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, "node_modules", name);
      if (fs.existsSync(path.join(candidate, "package.json"))) return fs.realpathSync(candidate);
      if (path.dirname(dir) === dir) throw new Error(`Cannot locate runtime dependency ${name} from ${from}`);
    }
  };
  const addTrace = (file) => {
    const marker = `${path.sep}node_modules${path.sep}`;
    const index = file.indexOf(marker);
    if (index < 0) return; // A trace of node_modules itself is not the whole pool.
    const parts = file.slice(index + marker.length).split(path.sep);
    const name = parts.slice(0, parts[0].startsWith("@") ? 2 : 1).join("/");
    const root = file.slice(0, index + marker.length) + name;
    if (fs.existsSync(path.join(root, "package.json"))) seeds.set(name, fs.realpathSync(root));
  };
  const visitTraces = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "standalone" || entry.name === "node_modules") continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visitTraces(file);
      else if (entry.name.endsWith(".nft.json")) {
        for (const traced of JSON.parse(fs.readFileSync(file, "utf8")).files) {
          addTrace(path.resolve(dir, traced));
        }
      }
    }
  };
  visitTraces(distDir);
  for (const name of runtimePackages) seeds.set(name, findPackage(name, sourceRoot));

  // Unlink the output alias before ANY package write. rm does not follow links.
  // Rebuild traced directories too: their descendants can contain external links.
  fs.rmSync(modules, { recursive: true, force: true });
  fs.mkdirSync(modules, { recursive: true });
  const copied = new Map();
  const install = (source, dest) => {
    const previous = copied.get(source);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (previous) {
      if (previous !== dest) fs.symlinkSync(path.relative(path.dirname(dest), previous), dest, "dir");
      return;
    }
    copied.set(source, dest);
    // Dereference package-local links, but never recursively copy a dependency
    // pool. Dependencies below are selected from manifests, not devDependencies.
    fs.cpSync(source, dest, {
      recursive: true,
      dereference: true,
      filter: (file) => {
        if (file === source) return true;
        if (path.basename(file) === "node_modules") return false;
        const real = fs.realpathSync(file);
        const relative = path.relative(source, real);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
          || relative.split(path.sep).includes("node_modules")) {
          throw new Error(`Package link escapes its runtime package: ${file} -> ${real}`);
        }
        if (fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).isDirectory()) {
          // Directory aliases can recurse through ancestor links. Reject them
          // rather than copying an unbounded tree; file aliases are materialized.
          throw new Error(`Package directory symlink is not supported: ${file}`);
        }
        return true;
      },
    });
    const pkg = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
    const optional = { ...pkg.optionalDependencies };
    for (const [name, meta] of Object.entries(pkg.peerDependenciesMeta || {})) {
      if (meta.optional) optional[name] = pkg.peerDependencies?.[name];
    }
    const dependencies = { ...pkg.dependencies, ...pkg.peerDependencies, ...optional };
    for (const name of Object.keys(dependencies)) {
      let dependency;
      try {
        dependency = findPackage(name, source);
      } catch (error) {
        if (Object.hasOwn(optional, name)) continue;
        throw error;
      }
      install(dependency, path.join(dest, "node_modules", name));
    }
  };
  for (const [name, source] of seeds) install(source, path.join(modules, name));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const nextBin = require.resolve("next/dist/bin/next");
const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-build-"));

let status = 1;
try {
  const result = spawnSync(process.execPath, [nextBin, "build", "--webpack"], {
    stdio: "inherit",
    env: createIsolatedBuildEnvironment(process.env, buildRoot),
  });
  if (result.error) throw result.error;
  status = result.status ?? 1;
  if (status === 0) {
    const distDir = process.env.NEXT_DIST_DIR || ".next";
    const standaloneRoot = path.join(process.cwd(), distDir, "standalone");
    const standaloneDir = fs.existsSync(path.join(standaloneRoot, "server.js"))
      ? standaloneRoot
      : fs.readdirSync(standaloneRoot)
        .map((name) => path.join(standaloneRoot, name))
        .find((candidate) => fs.existsSync(path.join(candidate, "server.js")));
    if (!standaloneDir) throw new Error(`Standalone server not found under ${standaloneRoot}`);
    const runtimeManifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    // Copied open-sse and sidecars load runtime packages outside NFT's graph.
    const runtimePackages = Object.keys(runtimeManifest.dependencies || {});
    for (const name of Object.keys(runtimeManifest.optionalDependencies || {})) {
      if (fs.existsSync(path.join(process.cwd(), "node_modules", name))) runtimePackages.push(name);
    }
    materializeStandaloneDependencies(standaloneDir, path.resolve(distDir), process.cwd(), runtimePackages);

    // Next's standalone trace includes the server bundle but (with this repo's
    // custom distDir/outputFileTracingRoot setup) does NOT copy the client static
    // chunks or public files into the standalone root. Without them, the running
    // server 404s on hashed .js/.css and favicons. Copy fresh on every build so
    // the deployed directory always matches the just-built output.
    const nextStaticSource = path.join(process.cwd(), distDir, "static");
    const nextStaticDest = path.join(standaloneDir, distDir, "static");
    if (fs.existsSync(nextStaticDest)) {
      fs.rmSync(nextStaticDest, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(nextStaticDest), { recursive: true });
    fs.cpSync(nextStaticSource, nextStaticDest, { recursive: true, dereference: true });

    const publicSource = path.join(process.cwd(), "public");
    const publicDest = path.join(standaloneDir, "public");
    if (fs.existsSync(publicDest)) {
      fs.rmSync(publicDest, { recursive: true, force: true });
    }
    if (fs.existsSync(publicSource)) {
      fs.cpSync(publicSource, publicDest, { recursive: true, dereference: true });
    }

    fs.copyFileSync(path.join(process.cwd(), "custom-server.js"), path.join(standaloneDir, "custom-server.js"));
    // custom-server.js requires ./head-response-guard.cjs (OmniRoute #6908):
    // a root-level sidecar outside Next's NFT trace, so it must be copied by
    // hand or the standalone server crashes at boot with MODULE_NOT_FOUND.
    fs.copyFileSync(path.join(process.cwd(), "head-response-guard.cjs"), path.join(standaloneDir, "head-response-guard.cjs"));
    fs.copyFileSync(path.join(process.cwd(), "web-login-host-boundary.cjs"), path.join(standaloneDir, "web-login-host-boundary.cjs"));
    fs.cpSync(path.join(process.cwd(), "src", "mitm"), path.join(standaloneDir, "src", "mitm"), {
      recursive: true,
    });
    // Realtime WebSocket bridge: custom-server.js `require()`s these CJS helpers
    // from bare Node where `@/` / `open-sse/` aliases don't resolve, and NFT
    // does not trace dynamic `require()` paths of a post-build entry. Copy the
    // sources preserving their on-disk relative layout so the `require(...)`
    // specifiers inside custom-server.js still resolve.
    const wsHandshakeDest = path.join(standaloneDir, "src", "shared", "utils", "wsHandshake.js");
    fs.mkdirSync(path.dirname(wsHandshakeDest), { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), "src", "shared", "utils", "wsHandshake.js"),
      wsHandshakeDest,
    );
    // Realtime resource limits (CJS source of truth) — required at import time
    // by both custom-server.js (maxPayload) and realtimeCore.js (item cap).
    fs.copyFileSync(
      path.join(process.cwd(), "src", "shared", "utils", "realtimeConfig.js"),
      path.join(standaloneDir, "src", "shared", "utils", "realtimeConfig.js"),
    );
    // Runtime server code imports from `open-sse/*` via bare aliases that
    // Next's NFT does not fully trace. The Dockerfile already repairs this by
    // copying the whole open-sse tree; do the same for standalone builds from
    // source so `npm run build && npm start` does not 500 on missing modules.
    const openSseSource = path.join(process.cwd(), "open-sse");
    const openSseDest = path.join(standaloneDir, "open-sse");
    if (fs.existsSync(openSseDest)) {
      fs.rmSync(openSseDest, { recursive: true, force: true });
    }
    fs.cpSync(openSseSource, openSseDest, { recursive: true, dereference: true });
    // OmniRoute #6828: custom-server.js requires this at its first line to strip
    // empty-string env vars before app modules snapshot them.
    fs.copyFileSync(
      path.join(process.cwd(), "src", "shared", "utils", "normalizeEnv.js"),
      path.join(standaloneDir, "src", "shared", "utils", "normalizeEnv.js"),
    );
    /** runtimeConfig.js imports this ESM helper outside Next's NFT trace. */
    fs.copyFileSync(
      path.join(process.cwd(), "src", "shared", "utils", "typeChecks.js"),
      path.join(standaloneDir, "src", "shared", "utils", "typeChecks.js"),
    );
    // custom-server.js requires this CJS helper at import time (#551); like
    // every post-build entry dependency it is outside Next's NFT trace, so a
    // missing copy crash-loops the deployed server with MODULE_NOT_FOUND.
    fs.copyFileSync(
      path.join(process.cwd(), "src", "shared", "utils", "typeChecks.cjs"),
      path.join(standaloneDir, "src", "shared", "utils", "typeChecks.cjs"),
    );
    // sql.js is the last-resort pure-JS SQLite driver (src/lib/db/driver.js falls
    // back to it when better-sqlite3 and node:sqlite are both unavailable). NFT
    // traces the JS entry but NOT its sibling `sql-wasm.wasm`, which emscripten
    // loads at runtime relative to the script directory. Without the wasm the
    // fallback dies with "[DB] sql.js unavailable" and the app has no database
    // at all (upstream 27f3710c8).
    // `sql.js` exports only "." and "./dist/*", so each asset is resolved through
    // its own subpath export rather than via package.json (not exported).
    const sqlJsDistDest = path.join(standaloneDir, "node_modules", "sql.js", "dist");
    fs.mkdirSync(sqlJsDistDest, { recursive: true });
    for (const asset of ["sql-wasm.js", "sql-wasm.wasm"]) {
      fs.copyFileSync(require.resolve(`sql.js/dist/${asset}`), path.join(sqlJsDistDest, asset));
    }
    const sharedConstantsDir = path.join(standaloneDir, "src", "shared", "constants");
    fs.mkdirSync(sharedConstantsDir, { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), "src", "shared", "constants", "processExitCodes.js"),
      path.join(sharedConstantsDir, "processExitCodes.js"),
    );
    // Fail the build (and CI) if the shipped egress code cannot resolve undici
    // from inside the bundle — the 4.9.4 tarball shipped without it. Resolution
    // walks up into the repo's own node_modules, so require an in-bundle path.
    const undiciResolved = createRequire(path.join(standaloneDir, "open-sse", "utils", "proxyFetch.js"))
      .resolve("undici");
    if (!undiciResolved.startsWith(standaloneDir + path.sep)) {
      throw new Error(`undici resolves outside the standalone bundle (${undiciResolved})`);
    }
  }
} finally {
  fs.rmSync(buildRoot, { recursive: true, force: true });
}

process.exit(status);
}
