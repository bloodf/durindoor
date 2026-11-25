import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const postinstall = fs.readFileSync(new URL("../../cli/hooks/postinstall.js", import.meta.url), "utf8");
const tray = fs.readFileSync(new URL("../../cli/hooks/trayRuntime.js", import.meta.url), "utf8");

describe("CLI runtime installation", () => {
  it("requests only the optional SQLite accelerator at postinstall", () => {
    const ensure = vi.fn();
    vm.runInNewContext(postinstall.replace(/^#![^\n]*\n/, ""), {
      require: () => ({ ensureSqliteRuntime: ensure }), console, process: { exit: vi.fn() },
    });
    expect(ensure).toHaveBeenCalledWith(expect.objectContaining({ installBetterSqlite: true, allowInstall: false }));
  });

  it("installs the tray asynchronously and remembers failures for this version", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-tray-test-"));
    try {
      const child = new EventEmitter();
      const spawn = vi.fn(() => child);
      const spawnSync = vi.fn();
      const hookModule = { exports: {} };
      vm.runInNewContext(tray, {
        module: hookModule, process: { platform: "linux" }, console: { log: vi.fn() },
        require: (name) => {
          if (name === "fs") return fs;
          if (name === "path") return path;
          if (name === "child_process") return { spawn, spawnSync };
          if (name === "./sqliteRuntime") return { getRuntimeDir: () => root, getRuntimeNodeModules: () => path.join(root, "node_modules") };
          throw new Error("missing module");
        },
      });
      const pending = hookModule.exports.ensureTrayRuntime({ asynchronous: true });
      expect(spawn).toHaveBeenCalledOnce();
      expect(spawnSync).not.toHaveBeenCalled();
      child.emit("close", 1);
      expect((await pending).systray).toBe(false);
      expect((await hookModule.exports.ensureTrayRuntime({ asynchronous: true })).systray).toBe(false);
      expect(spawn).toHaveBeenCalledOnce();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
