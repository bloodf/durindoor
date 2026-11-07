import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../cli/scripts/build-cli.js", import.meta.url), "utf8");

function invoke(failBuild) {
  const stopBeforePackaging = new Error("stop before packaging");
  const exit = new Error("process exited");
  const fs = {
    mkdirSync: vi.fn(),
    readFileSync: vi.fn((file) => JSON.stringify(file === "/repo/cli/package.json"
      ? { version: "1.2.3" } : { version: "0.0.0", private: true })),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    existsSync: vi.fn((file) => {
      if (file === "/repo/cli/app") throw stopBeforePackaging;
      return file === "/repo/.next-cli-build";
    }),
  };
  const child = {
    execSync: vi.fn(() => { throw new Error("redundant npm build dispatcher"); }),
    execFileSync: vi.fn(() => { if (failBuild) throw new Error("builder failed"); }),
  };
  const module = { exports: {} };
  const require = Object.assign((name) => {
    if (name === "fs") return fs;
    if (name === "path") return path;
    if (name === "child_process") return child;
    if (name === "./cliBuildPaths") return { resolveCliAppDir: () => "/repo/cli/app" };
    if (name === "./standaloneSidecars") return {};
    throw new Error(`Unexpected require: ${name}`);
  }, { main: module });
  const process = {
    execPath: "/runtime/node",
    env: { RETAINED: "yes", HOME: "/old-home", USERPROFILE: "/old-profile", APPDATA: "/old-appdata", LOCALAPPDATA: "/old-local", NEXT_DIST_DIR: "old-dist", NEXT_TRACING_ROOT_MODE: "old-mode" },
    exit: vi.fn(() => { throw exit; }),
  };
  let stopped;
  try {
    vm.runInNewContext(source, { require, module, __dirname: "/repo/cli/scripts", process,
      console: { log: vi.fn(), error: vi.fn() } });
  } catch (error) { stopped = error; }
  return { fs, child, process, stopped, stopBeforePackaging, exit };
}

describe("CLI app build dispatch", () => {
  it.each([false, true])("preserves direct builder options and failure handling, failure=%s", (failBuild) => {
    const run = invoke(failBuild);
    expect(run.child.execSync).not.toHaveBeenCalled();
    expect(run.child.execFileSync).toHaveBeenCalledExactlyOnceWith("/runtime/node", ["/repo/scripts/build-app.mjs"], {
      cwd: "/repo", stdio: "inherit", env: {
        RETAINED: "yes", HOME: "/repo/cli/.build-home", USERPROFILE: "/repo/cli/.build-home",
        APPDATA: "/repo/cli/.build-home/AppData/Roaming", LOCALAPPDATA: "/repo/cli/.build-home/AppData/Local",
        NEXT_DIST_DIR: ".next-cli-build", NEXT_TRACING_ROOT_MODE: "workspace",
      },
    });
    expect(run.fs.writeFileSync).toHaveBeenCalledExactlyOnceWith("/repo/package.json", JSON.stringify({ version: "1.2.3", private: true }, null, 2) + "\n");
    expect(run.fs.rmSync).toHaveBeenCalledExactlyOnceWith("/repo/.next-cli-build", { recursive: true, force: true });
    expect(run.fs.rmSync.mock.invocationCallOrder[0]).toBeLessThan(run.child.execFileSync.mock.invocationCallOrder[0]);
    expect(run.stopped).toBe(failBuild ? run.exit : run.stopBeforePackaging);
    if (failBuild) expect(run.process.exit).toHaveBeenCalledExactlyOnceWith(1);
    else expect(run.process.exit).not.toHaveBeenCalled();
  });
});
