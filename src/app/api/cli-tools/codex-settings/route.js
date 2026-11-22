"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseTOML, stringifyTOML } from "confbox";
import { isObject, isRecord } from "../../../../shared/utils/typeChecks.js";
import { readExistingConfig, writeConfigAtomic } from "@/lib/cliTools/readExistingConfig";
import { redactSecrets } from "@/shared/utils/secretRedaction";

const execAsync = promisify(exec);

const getCodexDir = () => path.join(os.homedir(), ".codex");
const getCodexConfigPath = () => path.join(getCodexDir(), "config.toml");
const getCodexAuthPath = () => path.join(getCodexDir(), "auth.json");
const getCodexBackupPath = () => path.join(getCodexDir(), ".durindoor-backup.json");

const captureField = (obj, key) =>
  isRecord(obj) && Object.hasOwn(obj, key)
    ? { had: true, value: obj[key] }
    : { had: false };

const restoreField = (obj, key, backupEntry) => {
  if (backupEntry?.had) {
    obj[key] = backupEntry.value;
  } else {
    delete obj[key];
  }
};

// Flatten confbox-parsed TOML into a writable object, preserving nested tables
const parsedToWritable = (obj) => obj ?? {};

const redactCodexTokens = (value) => {
  if (Array.isArray(value)) return value.map(redactCodexTokens);
  if (!value || !isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    /token$/i.test(key) && child != null && child !== ""
      ? "[REDACTED]"
      : redactCodexTokens(child),
  ]));
};

/**
 * Parse a config that must remain a keyed object when merged and serialized.
 * Arrays, primitives, and null are valid JSON values but invalid Codex auth/config shapes.
 */
const parseConfigObject = (raw, parse) => {
  const parsed = parse(raw);
  if (!isRecord(parsed)) {
    throw new Error("expected an object");
  }
  return parsed;
};

// Set a nested key from a flat dotted path, creating intermediate objects as needed
const setNestedSection = (obj, dottedKey, value) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isRecord(cur[keys[i]])) {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
};

// Delete a nested key from a flat dotted path
const deleteNestedSection = (obj, dottedKey) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur?.[keys[i]];
    if (cur == null) return;
  }
  delete cur[keys[keys.length - 1]];
};

// Check if codex CLI is installed (via which/where or config file exists)
const checkCodexInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where codex" : "which codex";
    const env = isWindows ?
    { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` } :
    process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getCodexConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Read current config.toml
const readConfig = async () => {
  try {
    const configPath = getCodexConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    return content;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Check if config has DurinDoor settings
const has9RouterConfig = (config) => {
  if (!config) return false;
  return config.includes("model_provider = \"9router\"") || config.includes("[model_providers.9router]");
};

// GET - Check codex CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkCodexInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Codex CLI is not installed"
      });
    }

    const config = await readConfig();
    const redactedConfig = config
      ? stringifyTOML(redactSecrets(redactCodexTokens(parseTOML(config))))
      : config;

    return NextResponse.json({
      installed: true,
      config: redactedConfig,
      has9Router: has9RouterConfig(config),
      configPath: getCodexConfigPath()
    });
  } catch (error) {
    console.log("Error checking codex settings:", error);
    return NextResponse.json({ error: "Failed to check codex settings" }, { status: 500 });
  }
}

// POST - Update DurinDoor settings (merge with existing config)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, subagentModel } = await request.json();

    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    const codexDir = getCodexDir();
    const configPath = getCodexConfigPath();
    const authPath = getCodexAuthPath();
    const backupPath = getCodexBackupPath();

    // Ensure directory exists
    await fs.mkdir(codexDir, { recursive: true });

    // Parse existing files before any write. Otherwise a bad auth.json
    // could reject the request only after config.toml had already been replaced.
    const [existingConfig, existingAuth, existingBackup] = await Promise.all([
      readExistingConfig(
        configPath,
        (raw) => parseConfigObject(raw, (value) => parsedToWritable(parseTOML(value))),
      ),
      readExistingConfig(authPath, (raw) => parseConfigObject(raw, JSON.parse)),
      readExistingConfig(backupPath, (raw) => parseConfigObject(raw, JSON.parse)),
    ]);
    const parsed = existingConfig ?? {};
    const authData = existingAuth ?? {};

    const effectiveSubagentModel = subagentModel || model;

    // Remember user-owned values on first apply so reset restores them instead of deleting them.
    const backupBase = existingBackup ?? (
      existingConfig?.model_provider === "9router"
        ? {
            config: {
              model: { had: false },
              model_provider: { had: false },
              subagentModel: { had: false },
            },
            auth: {
              OPENAI_API_KEY: { had: false },
              auth_mode: { had: false },
            },
          }
        : {
            config: {
              model: captureField(existingConfig, "model"),
              model_provider: captureField(existingConfig, "model_provider"),
              subagentModel: captureField(existingConfig?.agents?.subagent, "model"),
            },
            auth: {
              OPENAI_API_KEY: captureField(existingAuth, "OPENAI_API_KEY"),
              auth_mode: captureField(existingAuth, "auth_mode"),
            },
          }
    );

    const nextBackup = {
      config: backupBase.config,
      auth: backupBase.auth,
      written: {
        model,
        model_provider: "9router",
        subagentModel: effectiveSubagentModel,
        OPENAI_API_KEY: apiKey,
        auth_mode: "apikey",
      },
    };

    // Update only DurinDoor related fields (api_key goes to auth.json, not config.toml)
    parsed.model = model;
    parsed.model_provider = "9router";

    // Update or create 9router provider section (display name DurinDoor) (no api_key - Codex reads from auth.json)
    // Normalize trailing slashes so we always end with a single /v1
    const trimmedBaseUrl = baseUrl.replace(/\/+$/, "");
    const normalizedBaseUrl = trimmedBaseUrl.endsWith("/v1") ? trimmedBaseUrl : `${trimmedBaseUrl}/v1`;
    setNestedSection(parsed, "model_providers.9router", {
      name: "DurinDoor",
      base_url: normalizedBaseUrl,
      wire_api: "responses"
    });

    // Add subagent configuration while preserving unrelated keys under [agents.subagent]
    const existingSubagent = isRecord(parsed.agents?.subagent) ? parsed.agents.subagent : {};
    setNestedSection(parsed, "agents.subagent", {
      ...existingSubagent,
      model: effectiveSubagentModel
    });

    // Persist backup first, then write the merged config.toml and auth.json
    await fs.writeFile(backupPath, JSON.stringify(nextBackup, null, 2), { mode: 0o600 });
    const configContent = stringifyTOML(parsed);
    await writeConfigAtomic(configPath, configContent);

    // Force apikey mode (keep existing tokens untouched for ChatGPT login reuse)
    authData.OPENAI_API_KEY = apiKey;
    authData.auth_mode = "apikey";
    await writeConfigAtomic(authPath, JSON.stringify(authData, null, 2));

    return NextResponse.json({
      success: true,
      message: "Codex settings applied successfully!",
      configPath
    });
  } catch (error) {
    console.log("Error updating codex settings:", error);
    const refusedToClobber = String(error?.message || "").includes("refusing to overwrite it");
    return NextResponse.json(
      { error: refusedToClobber ? error.message : "Failed to update codex settings" },
      { status: 500 },
    );
  }
}

// DELETE - Remove DurinDoor settings only (restore backed-up user values, keep other settings)
export async function DELETE() {
  try {
    const configPath = getCodexConfigPath();
    const authPath = getCodexAuthPath();
    const backupPath = getCodexBackupPath();

    // Read and parse existing config, auth, and backup safely
    const [existingConfig, existingAuth, existingBackup] = await Promise.all([
      readExistingConfig(
        configPath,
        (raw) => parseConfigObject(raw, (value) => parsedToWritable(parseTOML(value))),
      ),
      readExistingConfig(authPath, (raw) => parseConfigObject(raw, JSON.parse)),
      readExistingConfig(backupPath, (raw) => parseConfigObject(raw, JSON.parse)),
    ]);

    if (!existingConfig) {
      return NextResponse.json({
        success: true,
        message: "No config file to reset"
      });
    }

    const parsed = existingConfig;

    // Remove 9router provider section and clean up empty [model_providers]
    deleteNestedSection(parsed, "model_providers.9router");
    if (isRecord(parsed.model_providers) && Object.keys(parsed.model_providers).length === 0) {
      delete parsed.model_providers;
    }

    if (existingBackup) {
      const written = isRecord(existingBackup.written) ? existingBackup.written : {};

      if (parsed.model === written.model || parsed.model_provider === "9router") {
        restoreField(parsed, "model", existingBackup.config?.model);
      }
      if (parsed.model_provider === (written.model_provider || "9router")) {
        restoreField(parsed, "model_provider", existingBackup.config?.model_provider);
      }

      if (isRecord(parsed.agents?.subagent) && parsed.agents.subagent.model === written.subagentModel) {
        restoreField(parsed.agents.subagent, "model", existingBackup.config?.subagentModel);
        if (Object.keys(parsed.agents.subagent).length === 0) {
          delete parsed.agents.subagent;
        }
      }
      if (isRecord(parsed.agents) && Object.keys(parsed.agents).length === 0) {
        delete parsed.agents;
      }

      if (existingAuth) {
        if (existingAuth.OPENAI_API_KEY === written.OPENAI_API_KEY) {
          restoreField(existingAuth, "OPENAI_API_KEY", existingBackup.auth?.OPENAI_API_KEY);
        }
        if (existingAuth.auth_mode === written.auth_mode) {
          restoreField(existingAuth, "auth_mode", existingBackup.auth?.auth_mode);
        }

        if (Object.keys(existingAuth).length === 0) {
          await fs.unlink(authPath);
        } else {
          await writeConfigAtomic(authPath, JSON.stringify(existingAuth, null, 2));
        }
      }

      await fs.unlink(backupPath).catch((err) => {
        if (err?.code !== "ENOENT") throw err;
      });
    } else {
      // No backup (legacy or user-only config): only remove fields when DurinDoor owns model_provider.
      const ownedByDurinDoor = parsed.model_provider === "9router";
      if (ownedByDurinDoor) {
        delete parsed.model;
        delete parsed.model_provider;
        deleteNestedSection(parsed, "agents.subagent");
        if (isRecord(parsed.agents) && Object.keys(parsed.agents).length === 0) {
          delete parsed.agents;
        }

        if (existingAuth) {
          delete existingAuth.OPENAI_API_KEY;
          delete existingAuth.auth_mode;
          if (Object.keys(existingAuth).length === 0) {
            await fs.unlink(authPath);
          } else {
            await writeConfigAtomic(authPath, JSON.stringify(existingAuth, null, 2));
          }
        }
      }
    }

    // Write updated config
    const configContent = stringifyTOML(parsed);
    await writeConfigAtomic(configPath, configContent);

    return NextResponse.json({
      success: true,
      message: "DurinDoor settings removed successfully"
    });
  } catch (error) {
    console.log("Error resetting codex settings:", error);
    const refusedToClobber = String(error?.message || "").includes("refusing to overwrite it");
    return NextResponse.json(
      { error: refusedToClobber ? error.message : "Failed to reset codex settings" },
      { status: 500 },
    );
  }
}
