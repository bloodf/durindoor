import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const AUTOSTART = "../../cli/src/cli/tray/autostart.js";
const cliSource = fs.readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");
const appUpdaterSource = fs.readFileSync(new URL("../../src/lib/appUpdater.js", import.meta.url), "utf8");
let root;
let savedEnv;
let savedPlatform;

function loadAutostart() {
  delete require.cache[require.resolve(AUTOSTART)];
  return require(AUTOSTART);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-tray-host-"));
  savedEnv = Object.fromEntries(["HOME", "USERPROFILE", "DATA_DIR", "DISPLAY", "APPDATA"].map((key) => [key, process.env[key]]));
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(home, ".config", "autostart"), { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.DATA_DIR = path.join(root, "data");
  process.env.DISPLAY = ":0";
  savedPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
});

afterEach(() => {
  Object.defineProperty(process, "platform", savedPlatform);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
  delete require.cache[require.resolve(AUTOSTART)];
});

describe("tray and autostart preserve the selected bind address", () => {
  it("passes host and port to the detached tray relaunch", () => {
    expect(cliSource).toContain('"--host", host, "--port", port.toString()');
    expect(cliSource).toContain("ensureAutoStart(__filename, { host, port })");
  });

  it("writes host and port to the Linux autostart entry with desktop escaping", () => {
    const { enableAutoStart } = loadAutostart();
    const cliPath = path.join(root, "cli.js");
    fs.writeFileSync(cliPath, "");
    expect(enableAutoStart(cliPath, { host: "127.0.0.1", port: 23456 })).toBe(true);
    const entry = fs.readFileSync(path.join(process.env.HOME, ".config", "autostart", "9router.desktop"), "utf8");
    expect(entry).toContain('--host "127.0.0.1" --port 23456');
  });

  it("writes host and port into macOS and Windows autostart entries", () => {
    const cliPath = path.join(root, "cli.js");
    fs.writeFileSync(cliPath, "");
    const { enableAutoStart } = loadAutostart();
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    expect(enableAutoStart(cliPath, { host: "127.0.0.1", port: 23456 })).toBe(true);
    const plist = fs.readFileSync(path.join(process.env.HOME, "Library", "LaunchAgents", "com.9router.autostart.plist"), "utf8");
    expect(plist).toContain("<string>127.0.0.1</string>");
    expect(plist).toContain("<string>23456</string>");

    process.env.APPDATA = root;
    const winStartupDir = path.join(root, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
    fs.mkdirSync(winStartupDir, { recursive: true });
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    expect(enableAutoStart(cliPath, { host: "127.0.0.1", port: 23456 })).toBe(true);
    const vbs = fs.readFileSync(path.join(winStartupDir, "9router.vbs"), "utf8");
    expect(vbs).toContain('--host ""127.0.0.1"" --port 23456');
  });

  it("includes the running host and port in the updater relaunch", () => {
    expect(appUpdaterSource).toContain('"--host", appHost');
    expect(appUpdaterSource).toContain('"--port", appPort');
  });
});
