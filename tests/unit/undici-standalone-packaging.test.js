import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { materializeStandaloneDependencies } from "../../scripts/build-app.mjs";
const { copyRecursive } = createRequire(import.meta.url)("../../cli/scripts/build-cli.js");

// Install through npm, not tar: pacote drops link entries that plain tar extracts.
function installPacked(packageDir, temp) {
  const env = { ...process.env, npm_config_cache: path.join(temp, "npm-cache") };
  const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json"], {
    cwd: packageDir, encoding: "utf8", env,
  }));
  const installed = path.join(temp, "installed");
  fs.mkdirSync(installed);
  fs.writeFileSync(path.join(installed, "package.json"), JSON.stringify({ name: "consumer", version: "1.0.0" }));
  execFileSync("npm", ["install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", path.join(packageDir, packed[0].filename)], {
    cwd: installed, encoding: "utf8", env,
  });
  return path.join(installed, "node_modules", packed[0].name, "app");
}

function snapshot(root) {
  const result = {};
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const key = path.relative(root, file);
      if (entry.isSymbolicLink()) result[key] = { link: fs.readlinkSync(file) };
      else if (entry.isDirectory()) {
        result[key] = { directory: true };
        visit(file);
      } else result[key] = fs.readFileSync(file).toString("base64");
    }
  };
  visit(root);
  return result;
}

describe("standalone dependency closure", () => {
  it("uses Dirent types for payload entries and stats only resolved symlink targets", () => {
    const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cli-payload-metadata-")));
    try {
      const source = path.join(temp, "source");
      const pkg = path.join(source, "node_modules", "payload");
      const nested = path.join(pkg, "nested");
      fs.mkdirSync(nested, { recursive: true, mode: 0o750 });
      fs.writeFileSync(path.join(pkg, "package.json"), '{"name":"payload"}');
      const binary = path.join(pkg, "binary");
      const plain = path.join(pkg, "plain.txt");
      const child = path.join(nested, "child.txt");
      fs.writeFileSync(binary, Buffer.from([0, 255, 1, 13, 10]));
      fs.chmodSync(binary, 0o751);
      fs.writeFileSync(plain, "plain\n");
      fs.writeFileSync(child, "nested\n");
      fs.chmodSync(child, 0o640);
      fs.symlinkSync("binary", path.join(pkg, "file-link"));
      fs.symlinkSync("nested", path.join(pkg, "directory-link"), "dir");
      const before = snapshot(source);
      const paths = [pkg, nested, binary, plain, child, path.join(pkg, "file-link"), path.join(pkg, "directory-link")];
      const modes = paths.map(file => fs.lstatSync(file).mode);
      const staged = path.join(temp, "staged");
      const stat = vi.spyOn(fs, "statSync");
      const realpath = vi.spyOn(fs, "realpathSync");
      let statQueries;
      let realpathQueries;
      try {
        copyRecursive(source, staged);
        statQueries = stat.mock.calls.map(([file]) => String(file)).filter(file => file.startsWith(pkg + path.sep));
        realpathQueries = realpath.mock.calls.map(([file]) => String(file));
      } finally {
        stat.mockRestore();
        realpath.mockRestore();
      }
      const output = path.join(staged, "node_modules", "payload");
      expect(fs.readFileSync(path.join(output, "binary"))).toEqual(Buffer.from([0, 255, 1, 13, 10]));
      expect(fs.readFileSync(path.join(output, "file-link"))).toEqual(fs.readFileSync(binary));
      expect(fs.readFileSync(path.join(output, "directory-link", "child.txt"), "utf8")).toBe("nested\n");
      expect(fs.readFileSync(path.join(output, "plain.txt"), "utf8")).toBe("plain\n");
      expect(fs.statSync(path.join(output, "binary")).mode & 0o777).toBe(0o751);
      expect(fs.statSync(path.join(output, "file-link")).mode & 0o777).toBe(0o751);
      expect(fs.statSync(path.join(output, "nested", "child.txt")).mode & 0o777).toBe(0o640);
      expect(fs.statSync(path.join(output, "nested")).mode & 0o777).toBe(0o777 & ~process.umask());
      expect(Object.values(snapshot(staged)).some(value => value && typeof value === "object" && "link" in value)).toBe(false);
      expect(fs.statSync(path.join(output, "binary")).nlink).toBe(1);
      expect(fs.statSync(path.join(output, "binary")).ino).not.toBe(fs.statSync(binary).ino);
      expect(snapshot(source)).toEqual(before);
      expect(paths.map(file => fs.lstatSync(file).mode)).toEqual(modes);
      expect(realpathQueries).toEqual(expect.arrayContaining(paths));
      // These are fs API calls, not a count of underlying kernel syscalls.
      expect(statQueries.sort()).toEqual([binary, nested].sort());
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it.each([
    ["file", "EISDIR"],
    ["directory", "ENOTDIR"],
  ])("fails closed when a %s Dirent becomes stale", (kind, code) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-stale-dirent-"));
    try {
      const source = path.join(temp, "source");
      const pkg = path.join(source, "node_modules", "payload");
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(path.join(pkg, "package.json"), '{"name":"payload"}');
      const victim = path.join(pkg, "victim");
      if (kind === "file") fs.writeFileSync(victim, "original");
      else fs.mkdirSync(victim);
      const readDirectory = fs.readdirSync;
      let changed = false;
      const read = vi.spyOn(fs, "readdirSync").mockImplementation((dir, ...args) => {
        const entries = readDirectory(dir, ...args);
        if (String(dir) === pkg && !changed) {
          changed = true;
          fs.rmSync(victim, { recursive: true });
          if (kind === "file") fs.mkdirSync(victim);
          else fs.writeFileSync(victim, "replacement must not be copied");
        }
        return entries;
      });
      try {
        expect(() => copyRecursive(source, path.join(temp, "staged"))).toThrow(code);
      } finally {
        read.mockRestore();
      }
      expect(changed).toBe(true);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it.each(["external-file", "external-directory", "directory-cycle"])("rejects payload %s links", (kind) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-payload-link-"));
    try {
      const source = path.join(temp, "source");
      const pkg = path.join(source, "node_modules", "payload");
      const outside = path.join(temp, "outside");
      fs.mkdirSync(pkg, { recursive: true });
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(pkg, "package.json"), '{"name":"payload"}');
      fs.writeFileSync(path.join(outside, "private.txt"), "must not ship");
      const target = kind === "directory-cycle" ? pkg : kind === "external-file" ? path.join(outside, "private.txt") : outside;
      fs.symlinkSync(target, path.join(pkg, "link"), kind === "external-file" ? "file" : "dir");
      const before = snapshot(source);
      const privateBefore = snapshot(outside);
      expect(() => copyRecursive(source, path.join(temp, "staged"))).toThrow(
        kind === "directory-cycle" ? "Runtime payload directory cycle" : "Copy link escapes its runtime bundle",
      );
      expect(snapshot(source)).toEqual(before);
      expect(snapshot(outside)).toEqual(privateBefore);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("keeps rejecting directory links outside a package payload", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-top-level-link-"));
    try {
      const source = path.join(temp, "source");
      fs.mkdirSync(path.join(source, "nested"), { recursive: true });
      fs.symlinkSync("nested", path.join(source, "alias"), "dir");
      const before = snapshot(source);
      expect(() => copyRecursive(source, path.join(temp, "staged"))).toThrow("Runtime payload directory symlink is not supported");
      expect(snapshot(source)).toEqual(before);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("places sibling version conflicts before resolving their children", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-sibling-versions-"));
    try {
      const source = path.join(temp, "source");
      const modules = path.join(source, "node_modules");
      const makePackage = (dir, name, version, code, dependencies = {}) => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version, main: "index.js", dependencies }));
        fs.writeFileSync(path.join(dir, "index.js"), code);
      };
      makePackage(path.join(modules, "leaf"), "leaf", "1.0.0", 'module.exports = "root";');
      makePackage(path.join(modules, "reader"), "reader", "1.0.0", 'module.exports = "root-reader";');
      const consumer = path.join(modules, "consumer");
      makePackage(consumer, "consumer", "1.0.0", 'module.exports = require("reader");', { reader: "2", leaf: "2" });
      makePackage(path.join(consumer, "node_modules", "reader"), "reader", "2.0.0", 'module.exports = require("leaf");', { leaf: "2" });
      makePackage(path.join(consumer, "node_modules", "leaf"), "leaf", "2.0.0", 'module.exports = "nested";');
      const before = snapshot(source);
      const staged = path.join(temp, "staged");
      copyRecursive(source, staged);
      const require = createRequire(path.join(staged, "server.js"));
      expect(require("consumer")).toBe("nested");
      expect(require("reader")).toBe("root-reader");
      expect(require("leaf")).toBe("root");
      expect(fs.existsSync(path.join(staged, "node_modules", "consumer", "node_modules", "reader", "node_modules", "leaf"))).toBe(false);
      expect(snapshot(source)).toEqual(before);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it.each(["root", "package"])("materializes external %s links without changing the source pool", (topology) => {
    const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "standalone-closure-")));
    try {
      const pool = path.join(temp, "pool", "node_modules");
      const source = path.join(temp, "source");
      const dist = path.join(source, ".next");
      const output = path.join(dist, "standalone");
      const modules = path.join(output, "node_modules");
      const makePackage = (dir, name, code, extra = {}) => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, main: "index.js", ...extra }));
        fs.writeFileSync(path.join(dir, "index.js"), code);
      };
      makePackage(path.join(pool, "undici"), "undici", 'module.exports = require("dep") + require("./alias.js");', {
        dependencies: { dep: "1" }, optionalDependencies: { absent: "1" }, devDependencies: { unused: "1" },
      });
      fs.writeFileSync(path.join(pool, "undici", "value.js"), 'module.exports = ":linked";');
      fs.symlinkSync("value.js", path.join(pool, "undici", "alias.js"));
      makePackage(path.join(pool, "dep"), "dep", 'module.exports = require("leaf");', { dependencies: { leaf: "1" } });
      makePackage(path.join(pool, "leaf"), "leaf", 'module.exports = "hoisted";', { dependencies: { dep: "1" } });
      makePackage(path.join(pool, "unused"), "unused", 'throw new Error("dev dependency must not ship");');
      makePackage(path.join(pool, "traced"), "traced", 'module.exports = require("leaf");', { dependencies: { leaf: "2" } });
      makePackage(path.join(pool, "traced", "node_modules", "leaf"), "leaf", 'module.exports = "nested";');
      makePackage(path.join(pool, "second"), "second", 'module.exports = require("leaf");', { dependencies: { leaf: "2" } });
      fs.mkdirSync(path.join(pool, "second", "node_modules"));
      fs.symlinkSync(path.join(pool, "traced", "node_modules", "leaf"), path.join(pool, "second", "node_modules", "leaf"), "dir");
      fs.mkdirSync(output, { recursive: true });
      fs.symlinkSync(pool, path.join(source, "node_modules"), "dir");
      if (topology === "root") fs.symlinkSync(pool, modules, "dir");
      else {
        fs.mkdirSync(modules);
        fs.symlinkSync(path.join(pool, "undici"), path.join(modules, "undici"), "dir");
      }
      fs.writeFileSync(path.join(dist, "server.js.nft.json"), JSON.stringify({ files: [
        path.relative(dist, path.join(source, "node_modules")),
        path.relative(dist, path.join(pool, "traced", "index.js")),
        path.relative(dist, path.join(pool, "second", "index.js")),
      ] }));
      const before = snapshot(path.join(temp, "pool"));
      const sourceLink = fs.readlinkSync(path.join(source, "node_modules"));

      materializeStandaloneDependencies(output, dist, source, ["undici", "leaf"]);

      expect(fs.lstatSync(modules).isSymbolicLink()).toBe(false);
      expect(snapshot(path.join(temp, "pool"))).toEqual(before);
      expect(fs.readlinkSync(path.join(source, "node_modules"))).toBe(sourceLink);
      expect(fs.realpathSync(path.join(source, "node_modules"))).toBe(pool);
      expect(fs.existsSync(path.join(modules, "unused"))).toBe(false);
      // npm pack omits symlinks, even when the standalone filesystem resolves.
      // Exercise the real pack and install boundary, with both input trees unavailable.
      const packageDir = path.join(temp, "cli-package");
      const staged = path.join(packageDir, "app");
      copyRecursive(output, staged);
      const stagedModules = path.join(staged, "node_modules");
      expect(fs.lstatSync(path.join(stagedModules, "leaf")).isSymbolicLink()).toBe(false);
      // Hard links never survive npm install, so conflict payloads must be real files.
      expect(fs.statSync(path.join(stagedModules, "traced", "node_modules", "leaf", "index.js")).nlink).toBe(1);
      expect(fs.statSync(path.join(stagedModules, "second", "node_modules", "leaf", "index.js")).nlink).toBe(1);
      expect(Object.values(snapshot(staged)).some(value => value && typeof value === "object" && "link" in value)).toBe(false);
      expect(snapshot(path.join(temp, "pool"))).toEqual(before);
      fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({
        name: "standalone-pack-regression", version: "1.0.0", files: ["app"],
      }));
      const installedApp = installPacked(packageDir, temp);
      const relocated = installedApp;
      fs.renameSync(staged, path.join(temp, "hidden-stage"));
      fs.renameSync(output, path.join(temp, "hidden-standalone"));
      fs.renameSync(path.join(temp, "pool"), path.join(temp, "hidden-pool"));
      const require = createRequire(path.join(relocated, "custom-server.js"));
      expect(require("undici")).toBe("hoisted:linked");
      expect(require("traced")).toBe("nested");
      expect(require("second")).toBe("nested");
      expect(require("leaf")).toBe("hoisted");
      expect(require.resolve("undici").startsWith(relocated + path.sep)).toBe(true);
      expect(require("dep")).toBe("hoisted");
      expect(fs.existsSync(path.join(relocated, "node_modules", "dep", "node_modules", "leaf"))).toBe(false);
      expect(fs.existsSync(path.join(relocated, "node_modules", "leaf", "node_modules", "dep"))).toBe(false);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }, 30_000);

  it("preserves overlapping nested-app and fallback packages through npm pack", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "standalone-overlap-"));
    try {
      const standalone = path.join(temp, "standalone");
      const app = path.join(standalone, "project");
      const localModules = path.join(app, "node_modules");
      const fallbackModules = path.join(standalone, "node_modules");
      const makePackage = (dir, name, code, dependencies = {}) => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, main: "index.js", dependencies }));
        fs.writeFileSync(path.join(dir, "index.js"), code);
      };
      makePackage(path.join(localModules, "leaf"), "leaf", 'module.exports = "local";');
      fs.symlinkSync("leaf", path.join(localModules, "alias"), "dir");
      makePackage(path.join(localModules, "local-consumer"), "local-consumer", 'module.exports = require("leaf");', { leaf: "1" });
      makePackage(path.join(fallbackModules, "leaf"), "leaf", 'module.exports = "fallback";');
      fs.symlinkSync("leaf", path.join(fallbackModules, "alias"), "dir");
      makePackage(path.join(fallbackModules, "fallback-consumer"), "fallback-consumer", 'module.exports = require("leaf");', { leaf: "2" });
      makePackage(path.join(fallbackModules, "second-consumer"), "second-consumer", 'module.exports = require("leaf");', { leaf: "2" });
      const before = snapshot(standalone);
      const packageDir = path.join(temp, "package");
      const staged = path.join(packageDir, "app");
      copyRecursive(app, staged, fs.realpathSync(standalone), fallbackModules);
      expect(snapshot(standalone)).toEqual(before);
      expect(Object.values(snapshot(staged)).some(value => value && typeof value === "object" && "link" in value)).toBe(false);
      fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({
        name: "standalone-overlap-regression", version: "1.0.0", files: ["app"],
      }));
      const installedApp = installPacked(packageDir, temp);
      fs.rmSync(standalone, { recursive: true });
      fs.rmSync(staged, { recursive: true });
      const require = createRequire(path.join(installedApp, "server.js"));
      expect(require("leaf")).toBe("local");
      expect(require("alias")).toBe("local");
      expect(require("local-consumer")).toBe("local");
      expect(require("fallback-consumer")).toBe("fallback");
      expect(require("second-consumer")).toBe("fallback");
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }, 30_000);

  it("isolates staged payloads from the source pool", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-source-isolation-"));
    try {
      const source = path.join(temp, "source");
      const modules = path.join(source, "node_modules");
      const pkg = path.join(modules, "leaf");
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(path.join(pkg, "package.json"), '{"name":"leaf","main":"index.js"}');
      fs.writeFileSync(path.join(pkg, "index.js"), 'module.exports = "source";');
      fs.symlinkSync("leaf", path.join(modules, "alias"), "dir");
      const before = snapshot(source);
      const staged = path.join(temp, "staged");
      copyRecursive(source, staged);
      fs.writeFileSync(path.join(staged, "node_modules", "alias", "index.js"), 'module.exports = "staged";');
      expect(snapshot(source)).toEqual(before);
      const sourceRequire = createRequire(path.join(source, "server.js"));
      const stagedRequire = createRequire(path.join(staged, "server.js"));
      expect(sourceRequire("leaf")).toBe("source");
      expect(sourceRequire("alias")).toBe("source");
      // Conflict payloads are real copies, so editing an alias reaches neither source nor sibling.
      expect(stagedRequire("leaf")).toBe("source");
      expect(stagedRequire("alias")).toBe("staged");
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it.each(["absolute", "relative"])("rejects %s package links escaping into the shared pool", (kind) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "standalone-unsafe-link-"));
    try {
      const source = path.join(temp, "source");
      const pool = path.join(temp, "pool", "node_modules");
      const pkg = path.join(pool, "undici");
      const dist = path.join(source, ".next");
      const output = path.join(dist, "standalone");
      fs.mkdirSync(pkg, { recursive: true });
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(pkg, "package.json"), '{"name":"undici","main":"index.js"}');
      fs.writeFileSync(path.join(pool, "private.txt"), "must not ship");
      fs.symlinkSync(kind === "absolute" ? path.join(pool, "private.txt") : "../private.txt", path.join(pkg, "index.js"));
      fs.symlinkSync(pool, path.join(source, "node_modules"), "dir");
      fs.symlinkSync(pool, path.join(output, "node_modules"), "dir");
      const before = snapshot(path.join(temp, "pool"));

      expect(() => materializeStandaloneDependencies(output, dist, source, ["undici"]))
        .toThrow("Package link escapes its runtime package");
      expect(snapshot(path.join(temp, "pool"))).toEqual(before);
      expect(fs.readlinkSync(path.join(source, "node_modules"))).toBe(pool);
      expect(fs.existsSync(path.join(output, "node_modules", "undici", "index.js"))).toBe(false);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
  it("rejects CLI copy links to an external shared dependency pool", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cli-unsafe-link-"));
    try {
      const source = path.join(temp, "standalone");
      const pool = path.join(temp, "pool");
      fs.mkdirSync(source);
      fs.mkdirSync(pool);
      fs.writeFileSync(path.join(pool, "private.txt"), "must not ship");
      fs.symlinkSync(pool, path.join(source, "node_modules"), "dir");
      const before = snapshot(pool);
      expect(() => copyRecursive(source, path.join(temp, "cli-app")))
        .toThrow("Copy link escapes its runtime bundle");
      expect(snapshot(pool)).toEqual(before);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});
