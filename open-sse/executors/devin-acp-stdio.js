import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

// Share the executor’s isolated-home validation with automatic routing readiness.
export function isolatedHome({ env = process.env, fs: fsApi = fs } = {}) {
  const configured = env.DEVIN_AGENTIC_HOME;
  if (!configured || !path.isAbsolute(configured)) return null;
  try {
    const home = fsApi.realpathSync(configured);
    const protectedPaths = [fsApi.realpathSync(os.homedir()), fsApi.realpathSync(process.cwd())];
    if (protectedPaths.some((entry) => entry === home || entry.startsWith(home + path.sep) || home.startsWith(entry + path.sep))) return null;
    return fsApi.statSync(home).isDirectory() ? home : null;
  } catch {
    return null;
  }
}

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

// Extensions cmd.exe launches itself (batch files) or through CreateProcess when the
// file is named with its extension, independent of PATHEXT. cmd looks up a name that
// includes an extension as that exact file name, in the given directory or, for a bare
// name, in each PATH directory; PATHEXT only supplies extensions for names without one.
const WINDOWS_INHERENT_EXTENSIONS = [".com", ".exe", ".bat", ".cmd"];

/**
 * The executable token cmd.exe sees for `bin`, or null when its meaning is not a
 * single unambiguous file name. The credentialed executor spawns with `shell: true`
 * on Windows, so Node runs `cmd.exe /d /s /c "<bin> acp ..."` without quoting `bin`.
 * One balanced pair of quotes wrapping the whole value is therefore stripped (cmd
 * does the same). Anything cmd would split, expand or redirect is rejected: interior
 * or unbalanced quotes, `%` expansion, unquoted whitespace or `& | < > ^`, padding
 * inside the quotes, and drive-relative or other stray `:` forms.
 */
function windowsShellToken(bin) {
  let token = bin;
  const quoted = token.length >= 2 && token.startsWith('"') && token.endsWith('"');
  if (quoted) token = token.slice(1, -1);
  if (!token || token.includes('"') || token.includes("%") || token !== token.trim()) return null;
  if (!quoted && /[\s&|<>^]/.test(token)) return null;
  if (/[\0-\x1f]/.test(token)) return null;
  const colon = token.indexOf(":");
  if (colon !== -1 && !(colon === 1 && /^[A-Za-z]:[\\/]/.test(token) && !token.includes(":", 2))) return null;
  return token;
}

/**
 * File names cmd.exe could launch for `bin`. A name whose extension is listed in
 * PATHEXT (case-insensitive) is tried as written, as is any bare or directory-qualified
 * name ending in .com/.exe/.bat/.cmd, which cmd runs regardless of PATHEXT. Any other
 * name is tried only with each PATHEXT extension appended, because Windows will not
 * run an extensionless or unknown-extension file. Bare names search PATH entries
 * only (not the current directory), which can under-report but never over-report.
 * Returns no candidates when `bin` is malformed or ambiguous for the shell.
 */
function windowsCommandCandidates(bin, env) {
  const token = windowsShellToken(bin);
  if (token === null) return [];
  const extensions = (readWindowsEnv(env, "PATHEXT") || DEFAULT_WINDOWS_PATHEXT)
    .split(";").map((ext) => ext.trim().toLowerCase()).filter((ext) => /^\.[^.\\/:*?"<>|\s]+$/.test(ext));
  const explicitPath = /[\\/]/.test(token) || path.win32.isAbsolute(token);
  const ownExt = path.win32.extname(token).toLowerCase();
  const runsAsWritten = ownExt && (extensions.includes(ownExt) || WINDOWS_INHERENT_EXTENSIONS.includes(ownExt));
  const names = runsAsWritten ? [token] : extensions.map((ext) => token + ext);
  if (explicitPath) return names;
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
 * stays unsupported on Windows and requires an absolute CLI_DEVIN_BIN plus a
 * valid isolated DEVIN_AGENTIC_HOME.
 * `platform`, `env` and `fs` are injectable for tests.
 */
export function isDevinBinAvailable({ agentic = false, platform = process.platform, env = process.env, fs: fsApi = fs } = {}) {
  const bin = agentic ? env.CLI_DEVIN_BIN?.trim() : resolveDevinBin({ platform, env, fs: fsApi });
  if (!bin || (agentic && (!path.isAbsolute(bin) || platform === "win32" || !isolatedHome({ env, fs: fsApi })))) return false;
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
