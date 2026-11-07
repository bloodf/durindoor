#!/usr/bin/env node
// Install a packed CLI tarball into a clean prefix and run the installed-artifact
// smoke against it. Never publishes; scripts are skipped so ~/.durindoor is untouched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { smokeInstalledArtifact } from "./smoke-installed-artifact.mjs";

// Copy cache data only. Keep npm writes and credentials out of the seed.
function copyCacheData(source, destination) {
  const state = fs.lstatSync(source);
  if (state.isSymbolicLink()) throw new Error(`Cache symlink rejected: ${source}`);
  if (state.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(source)) copyCacheData(path.join(source, name), path.join(destination, name));
    return;
  }
  if (!state.isFile() || state.nlink !== 1) throw new Error(`Cache data must be regular and unlinked: ${source}`);
  const input = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(input);
    if (!opened.isFile() || opened.nlink !== 1) throw new Error(`Cache data must be regular and unlinked: ${source}`);
    const output = fs.openSync(destination, "wx", 0o600);
    try {
      const buffer = Buffer.alloc(64 * 1024);
      let count;
      while ((count = fs.readSync(input, buffer, 0, buffer.length, null)) !== 0) {
        let written = 0;
        while (written < count) {
          const bytes = fs.writeSync(output, buffer, written, count - written);
          if (bytes === 0) throw new Error("Cache copy made no write progress");
          written += bytes;
        }
      }
    } finally { fs.closeSync(output); }
  } finally { fs.closeSync(input); }
}

export async function smokeNpmPack(tarball) {
  const file = fs.realpathSync(tarball);
  if (!/\.tgz$/.test(file)) throw new Error("Pass the npm pack .tgz");
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-npm-pack-")));
  try {
    const home = path.join(temp, "home");
    fs.mkdirSync(home);
    const cache = path.join(temp, "npm-cache");
    if (process.env.npm_config_offline === "true" && process.env.npm_config_cache) {
      const seed = path.resolve(process.env.npm_config_cache);
      for (let dir = seed; ; dir = path.dirname(dir)) {
        if (fs.lstatSync(dir).isSymbolicLink()) throw new Error(`Cache symlink rejected: ${dir}`);
        if (dir === path.dirname(dir)) break;
      }
      copyCacheData(path.join(seed, "_cacache"), path.join(cache, "_cacache"));
    }
    const install = spawnSync("npm", [
      "install", "--prefix", path.join(temp, "prefix"), "--ignore-scripts",
      "--no-audit", "--no-fund", file,
    ], {
      stdio: "inherit",
      env: { ...process.env, HOME: home, npm_config_cache: cache },
    });
    if (install.status !== 0) throw new Error(`npm install of tarball failed: ${install.status}`);
    const entry = path.join(temp, "prefix/node_modules/durindoor/app/custom-server.js");
    if (!fs.existsSync(entry)) throw new Error("Packed tarball has no app/custom-server.js");
    await smokeInstalledArtifact(entry);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/smoke-npm-pack.mjs /absolute/durindoor-x.y.z.tgz");
    process.exitCode = 1;
  } else {
    smokeNpmPack(process.argv[2]).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
