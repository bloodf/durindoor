import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { materializeStandaloneDependencies } from "../../scripts/build-app.mjs";
const { copyRecursive } = createRequire(import.meta.url)("../../cli/scripts/build-cli.js");

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
  it.each(["root", "package"])("materializes external %s links without changing the source pool", (topology) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "standalone-closure-"));
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
      // Exercise the real archive boundary, with both input trees unavailable.
      const packageDir = path.join(temp, "cli-package");
      const staged = path.join(packageDir, "app");
      copyRecursive(output, staged);
      const stagedModules = path.join(staged, "node_modules");
      expect(fs.lstatSync(path.join(stagedModules, "leaf")).isSymbolicLink()).toBe(false);
      expect(fs.statSync(path.join(stagedModules, "traced", "node_modules", "leaf", "index.js")).ino)
        .toBe(fs.statSync(path.join(stagedModules, "second", "node_modules", "leaf", "index.js")).ino);
      expect(Object.values(snapshot(staged)).some(value => value && typeof value === "object" && "link" in value)).toBe(false);
      expect(snapshot(path.join(temp, "pool"))).toEqual(before);
      fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({
        name: "standalone-pack-regression", version: "1.0.0", files: ["app"],
      }));
      const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json"], {
        cwd: packageDir, encoding: "utf8", env: { ...process.env, npm_config_cache: path.join(temp, "npm-cache") },
      }));
      const installed = path.join(temp, "installed");
      fs.mkdirSync(installed);
      execFileSync("tar", ["-xzf", path.join(packageDir, packed[0].filename), "--strip-components=1", "-C", installed]);
      const relocated = path.join(installed, "app");
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
      const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json"], {
        cwd: packageDir, encoding: "utf8", env: { ...process.env, npm_config_cache: path.join(temp, "npm-cache") },
      }));
      const installed = path.join(temp, "installed");
      fs.mkdirSync(installed);
      execFileSync("tar", ["-xzf", path.join(packageDir, packed[0].filename), "--strip-components=1", "-C", installed]);
      fs.rmSync(standalone, { recursive: true });
      fs.rmSync(staged, { recursive: true });
      const require = createRequire(path.join(installed, "app", "server.js"));
      expect(require("leaf")).toBe("local");
      expect(require("alias")).toBe("local");
      expect(require("local-consumer")).toBe("local");
      expect(require("fallback-consumer")).toBe("fallback");
      expect(require("second-consumer")).toBe("fallback");
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }, 30_000);

  it("isolates staged hardlink payloads from the source pool", () => {
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
      expect(stagedRequire("leaf")).toBe("staged");
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
