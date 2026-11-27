import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

export function resolveDevinBin({ platform = process.platform, env = process.env, fs: fsApi = fs, homedir = os.homedir } = {}) {
  const envBin = env.CLI_DEVIN_BIN?.trim();
  if (envBin) return envBin;
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || path.win32.join(homedir(), "AppData", "Local");
    const winPath = path.win32.join(localAppData, "devin", "cli", "bin", "devin.exe");
    if (fsApi.existsSync(winPath)) return winPath;
    return "devin.exe";
  }
  for (const candidate of [
  path.join(homedir(), ".local", "share", "devin", "bin", "devin"),
  path.join(homedir(), ".devin", "bin", "devin")])
  {
    if (fsApi.existsSync(candidate)) return candidate;
  }
  return "devin";
}

const DEFAULT_WINDOWS_PATHEXT = ".COM;.EXE;.BAT;.CMD";

// Windows environment keys are case-insensitive (`Path`, `PATHEXT`, ...).
function readWindowsEnv(env, name) {
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * File names cmd.exe could launch for `bin`. A name whose extension is listed in
 * PATHEXT (case-insensitive) is tried as written; any other name is tried only
 * with each PATHEXT extension appended, because Windows will not run an
 * extensionless or unknown-extension file. Bare names search PATH entries only
 * (not the current directory), which can under-report but never over-report.
 */
function windowsCommandCandidates(bin, env) {
  const extensions = (readWindowsEnv(env, "PATHEXT") || DEFAULT_WINDOWS_PATHEXT)
    .split(";").map((ext) => ext.trim().toLowerCase()).filter((ext) => /^\.[^.\\/:*?"<>|\s]+$/.test(ext));
  const ownExt = path.win32.extname(bin).toLowerCase();
  const names = ownExt && extensions.includes(ownExt) ? [bin] : extensions.map((ext) => bin + ext);
  if (/[\\/]/.test(bin) || path.win32.isAbsolute(bin)) return names;
  const dirs = (readWindowsEnv(env, "PATH") || "").split(";").map((dir) => dir.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
  return dirs.flatMap((dir) => names.map((name) => path.win32.join(dir, name)));
}

/**
 * Advisory filesystem check used only to keep unavailable local Devin providers
 * out of auto-family candidate pools. It never executes anything, a later spawn
 * can still fail, and explicit or saved-combo selections are not gated by it.
 * POSIX requires an executable regular file (X_OK). Windows has no execute bit,
 * so it mirrors cmd.exe resolution (the credentialed CLI spawns with a shell
 * there): PATH plus PATHEXT, case-insensitive extensions. The agentic provider
 * stays unsupported on Windows and requires an absolute CLI_DEVIN_BIN.
 * `platform`, `env` and `fs` are injectable for tests.
 */
export function isDevinBinAvailable({ agentic = false, platform = process.platform, env = process.env, fs: fsApi = fs } = {}) {
  const bin = agentic ? env.CLI_DEVIN_BIN?.trim() : resolveDevinBin({ platform, env, fs: fsApi });
  if (!bin || (agentic && (!path.isAbsolute(bin) || platform === "win32"))) return false;
  if (platform === "win32") {
    return windowsCommandCandidates(bin, env).some((candidate) => {
      try {
        return fsApi.statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
  }
  const candidates = bin.includes("/") ? [bin] : (env.PATH || "").split(path.delimiter).map((dir) => path.join(dir || ".", bin));
  return candidates.some((candidate) => {
    try {
      fsApi.accessSync(candidate, fsApi.constants.X_OK);
      return fsApi.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

export function rpc(method, params, id) {
  const message = { jsonrpc: "2.0", method, params };
  if (id !== undefined) message.id = id;
  return `${JSON.stringify(message)}\n`;
}

export function spawnDevinAcp(bin, args, options) {
  return spawn(bin, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
}

// OmniRoute open-sse/executors/devin-cli.ts: ACP text blocks may be nested.
export function extractChunkText(content) {
  if (isString(content)) return content;
  if (Array.isArray(content)) return content.map(extractChunkText).join("");
  return isObject(content) && isString(content.text) ? content.text : "";
}
