import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

export function resolveDevinBin() {
  const envBin = process.env.CLI_DEVIN_BIN?.trim();
  if (envBin) return envBin;
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const winPath = path.join(localAppData, "devin", "cli", "bin", "devin.exe");
    if (fs.existsSync(winPath)) return winPath;
    return "devin.exe";
  }
  for (const candidate of [
  path.join(os.homedir(), ".local", "share", "devin", "bin", "devin"),
  path.join(os.homedir(), ".devin", "bin", "devin")])
  {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "devin";
}

/** Advisory filesystem check only; a later spawn can still fail. */
export function isDevinBinAvailable({ agentic = false } = {}) {
  const bin = agentic ? process.env.CLI_DEVIN_BIN?.trim() : resolveDevinBin();
  if (!bin || (agentic && (!path.isAbsolute(bin) || process.platform === "win32"))) return false;
  const hasDirectory = bin.includes("/") || (process.platform === "win32" && bin.includes("\\"));
  const candidates = hasDirectory ? [bin] : (process.env.PATH || "").split(path.delimiter).map((dir) => path.join(dir || ".", bin));
  return candidates.some((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.statSync(candidate).isFile();
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
