import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AUTOSTART = "../../cli/src/cli/tray/autostart.js";

let root;
let home;
let dataDir;
let cliPath;
let savedEnv;
let savedPlatform;

function desktopEntry() {
  return path.join(home, ".config", "autostart", "9router.desktop");
}

function decisionMarker() {
  return path.join(dataDir, "autostart-decided");
}

function loadAutostart() {
  delete require.cache[require.resolve(AUTOSTART)];
  return require(AUTOSTART);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-autostart-3651-"));
  home = path.join(root, "home");
  dataDir = path.join(root, "data");
  cliPath = path.join(root, "cli.js");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(cliPath, "// fixture\n");

  savedEnv = Object.fromEntries(
    ["HOME", "USERPROFILE", "DATA_DIR", "DISPLAY"].map((key) => [key, process.env[key]])
  );
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.DATA_DIR = dataDir;
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
  delete require.cache[require.resolve(AUTOSTART)];
  fs.rmSync(root, { recursive: true, force: true });
});

describe("tray autostart decisions (upstream #3651)", () => {
  it("enables once implicitly and records the decision", () => {
    const { ensureAutoStart } = loadAutostart();

    expect(ensureAutoStart(cliPath)).toBe(true);
    expect(fs.existsSync(desktopEntry())).toBe(true);
    expect(fs.existsSync(decisionMarker())).toBe(true);
  });

  it("preserves an explicit disable on later implicit attempts", () => {
    const { disableAutoStart, ensureAutoStart } = loadAutostart();
    ensureAutoStart(cliPath);

    expect(disableAutoStart()).toBe(true);
    expect(ensureAutoStart(cliPath)).toBe(false);
    expect(fs.existsSync(desktopEntry())).toBe(false);
  });

  it("does not recreate an entry removed after the initial decision", () => {
    const { ensureAutoStart } = loadAutostart();
    ensureAutoStart(cliPath);
    fs.unlinkSync(desktopEntry());

    expect(ensureAutoStart(cliPath)).toBe(false);
    expect(fs.existsSync(desktopEntry())).toBe(false);
  });

  it("allows explicit re-enable after disable and preserves it", () => {
    const { disableAutoStart, enableAutoStart, ensureAutoStart } = loadAutostart();
    ensureAutoStart(cliPath);
    disableAutoStart();

    expect(enableAutoStart(cliPath)).toBe(true);
    expect(fs.existsSync(desktopEntry())).toBe(true);
    expect(fs.existsSync(decisionMarker())).toBe(true);
    expect(ensureAutoStart(cliPath)).toBe(false);
    expect(fs.existsSync(desktopEntry())).toBe(true);
  });

  it("records an explicit disable when no platform entry exists", () => {
    const { disableAutoStart, ensureAutoStart } = loadAutostart();

    expect(disableAutoStart()).toBe(true);
    expect(fs.existsSync(decisionMarker())).toBe(true);
    expect(ensureAutoStart(cliPath)).toBe(false);
    expect(fs.existsSync(desktopEntry())).toBe(false);
  });
});
