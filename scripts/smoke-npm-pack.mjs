#!/usr/bin/env node
// Install a packed CLI tarball into a clean prefix and run the installed-artifact
// smoke against it. Never publishes; scripts are skipped so ~/.durindoor is untouched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { smokeInstalledArtifact } from "./smoke-installed-artifact.mjs";

export async function smokeNpmPack(tarball) {
  const file = fs.realpathSync(tarball);
  if (!/\.tgz$/.test(file)) throw new Error("Pass the npm pack .tgz");
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-npm-pack-")));
  try {
    const home = path.join(temp, "home");
    fs.mkdirSync(home);
    const install = spawnSync("npm", [
      "install", "--prefix", path.join(temp, "prefix"), "--ignore-scripts",
      "--no-audit", "--no-fund", file,
    ], {
      stdio: "inherit",
      env: { ...process.env, HOME: home, npm_config_cache: path.join(temp, "npm-cache") },
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
