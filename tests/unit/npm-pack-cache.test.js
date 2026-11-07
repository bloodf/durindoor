import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ install: vi.fn(), smoke: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: mocks.install }));
vi.mock("../../scripts/smoke-installed-artifact.mjs", () => ({ smokeInstalledArtifact: mocks.smoke }));
import { smokeNpmPack } from "../../scripts/smoke-npm-pack.mjs";

let root, seed, tarball, temporary;
const payload = Buffer.from([0, 255, 13, 10]);
beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pack-cache-test-"));
  seed = path.join(root, "seed");
  fs.mkdirSync(path.join(seed, "_cacache/content"), { recursive: true });
  fs.writeFileSync(path.join(seed, "_cacache/content/value"), payload);
  fs.writeFileSync(path.join(seed, ".npmrc"), "synthetic config must not be copied");
  tarball = path.join(root, "package.tgz");
  fs.writeFileSync(tarball, "synthetic tarball; npm is mocked");
  vi.stubEnv("npm_config_cache", seed);
  vi.stubEnv("npm_config_offline", "true");
  const mkdtemp = fs.mkdtempSync.bind(fs);
  temporary = [];
  vi.spyOn(fs, "mkdtempSync").mockImplementation((...args) => {
    const made = mkdtemp(...args); temporary.push(made); return made;
  });
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("packed CLI private npm cache", () => {
  it.each([0, 23])("copies only cache bytes, keeps isolation and cleans up after install exit %i", async (status) => {
    mocks.install.mockImplementation((binary, args, options) => {
      expect(binary).toBe("npm");
      const privateRoot = path.dirname(options.env.HOME);
      const prefix = path.join(privateRoot, "prefix");
      expect(args).toEqual(["install", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", tarball]);
      expect(fs.existsSync(prefix)).toBe(false);
      expect(fs.readdirSync(options.env.HOME)).toEqual([]);
      expect(options.env.npm_config_offline).toBe("true");
      expect(options.env.npm_config_cache).toBe(path.join(privateRoot, "npm-cache"));
      expect(fs.readdirSync(options.env.npm_config_cache)).toEqual(["_cacache"]);
      const copied = path.join(options.env.npm_config_cache, "_cacache/content/value");
      expect(fs.readFileSync(copied)).toEqual(payload);
      expect(fs.statSync(copied).ino).not.toBe(fs.statSync(path.join(seed, "_cacache/content/value")).ino);
      fs.writeFileSync(copied, "private mutation");
      const entry = path.join(prefix, "node_modules/durindoor/app/custom-server.js");
      fs.mkdirSync(path.dirname(entry), { recursive: true }); fs.writeFileSync(entry, "synthetic entry");
      return { status };
    });
    if (status) await expect(smokeNpmPack(tarball)).rejects.toThrow("npm install of tarball failed: 23");
    else {
      await smokeNpmPack(tarball);
      expect(mocks.smoke).toHaveBeenCalledExactlyOnceWith(path.join(temporary[0], "prefix/node_modules/durindoor/app/custom-server.js"));
    }
    expect(fs.readFileSync(path.join(seed, "_cacache/content/value"))).toEqual(payload);
    expect(temporary).toHaveLength(1);
    expect(fs.existsSync(temporary[0])).toBe(false);
    if (status) expect(mocks.smoke).not.toHaveBeenCalled();
  });

  it("keeps default online behavior without reading the seed", async () => {
    vi.stubEnv("npm_config_offline", "false");
    fs.rmSync(path.join(seed, "_cacache"), { recursive: true });
    mocks.install.mockImplementation((binary, args, options) => {
      expect(fs.existsSync(options.env.npm_config_cache)).toBe(false);
      return { status: 23 };
    });
    await expect(smokeNpmPack(tarball)).rejects.toThrow("npm install of tarball failed: 23");
    expect(fs.existsSync(temporary[0])).toBe(false);
  });

  it.each(["symlink", "hardlink"])("rejects %s cache aliases before installation and cleans up", async (kind) => {
    const value = path.join(seed, "_cacache/content/value");
    const alias = path.join(seed, "_cacache/alias");
    if (kind === "symlink") fs.symlinkSync(value, alias);
    else fs.linkSync(value, alias);
    await expect(smokeNpmPack(tarball)).rejects.toThrow(/cache.*(link|regular)/i);
    expect(mocks.install).not.toHaveBeenCalled();
    expect(fs.existsSync(temporary[0])).toBe(false);
    expect(fs.readFileSync(value)).toEqual(payload);
  });
});
