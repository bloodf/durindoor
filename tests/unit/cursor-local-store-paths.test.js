import { afterEach, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { getCursorDbCandidatePaths } from "../../src/lib/oauth/services/cursorLocalStore.js";

afterEach(() => vi.unstubAllEnvs());

it("uses current Windows application directories without relocating user databases into the package", () => {
  vi.stubEnv("APPDATA", "C:\\Users\\operator\\Roaming");
  vi.stubEnv("LOCALAPPDATA", "D:\\Local Apps");
  expect(getCursorDbCandidatePaths("win32")).toEqual([
    join(process.env.APPDATA, "Cursor", "User", "globalStorage", "state.vscdb"),
    join(process.env.APPDATA, "Cursor - Insiders", "User", "globalStorage", "state.vscdb"),
    join(process.env.LOCALAPPDATA, "Cursor", "User", "globalStorage", "state.vscdb"),
    join(process.env.LOCALAPPDATA, "Programs", "Cursor", "User", "globalStorage", "state.vscdb"),
  ]);
  vi.stubEnv("APPDATA", "");
  vi.stubEnv("LOCALAPPDATA", "");
  expect(getCursorDbCandidatePaths("win32")).toEqual([
    join(homedir(), "AppData", "Roaming", "Cursor", "User", "globalStorage", "state.vscdb"),
    join(homedir(), "AppData", "Roaming", "Cursor - Insiders", "User", "globalStorage", "state.vscdb"),
    join(homedir(), "AppData", "Local", "Cursor", "User", "globalStorage", "state.vscdb"),
    join(homedir(), "AppData", "Local", "Programs", "Cursor", "User", "globalStorage", "state.vscdb"),
  ]);
});
