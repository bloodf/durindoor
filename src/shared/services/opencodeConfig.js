import fs from "fs";
import os from "os";
import path from "path";
import { applyEdits, modify, parse, printParseErrorCode } from "jsonc-parser";
import { isObject } from "../utils/typeChecks.js";

const formattingOptions = { insertSpaces: true, tabSize: 2 };

export const resolveOpenCodeConfigDir = (env = process.env, homeDir = os.homedir()) =>
path.join(String(env.XDG_CONFIG_HOME || "").trim() || path.join(homeDir, ".config"), "opencode");

export const resolveOpenCodeConfigPath = (env = process.env, homeDir = os.homedir()) => {
  const dir = resolveOpenCodeConfigDir(env, homeDir);
  const jsonc = path.join(dir, "opencode.jsonc");
  if (fs.existsSync(jsonc)) return jsonc;
  return path.join(dir, "opencode.json");
};

export const parseOpenCodeConfig = (text) => {
  const errors = [];
  const config = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !config || !isObject(config) || Array.isArray(config)) {
    const detail = errors[0] ? `${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}` : "root must be an object";
    throw new Error(`Existing OpenCode config is invalid JSONC (${detail}); refusing to overwrite it.`);
  }
  return config;
};

export const modifyOpenCodeConfig = (text, configPath, value) =>
applyEdits(text, modify(text, configPath, value, { formattingOptions }));