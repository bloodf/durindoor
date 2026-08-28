"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseTOML, stringifyTOML } from "confbox";
import { isObject } from "../../../../shared/utils/typeChecks.js";
import { readExistingConfig } from "@/lib/cliTools/readExistingConfig";

const execAsync = promisify(exec);

const getCodexDir = () => path.join(os.homedir(), ".codex");
const getCodexConfigPath = () => path.join(getCodexDir(), "config.toml");
const getCodexAuthPath = () => path.join(getCodexDir(), "auth.json");

// Flatten confbox-parsed TOML into a writable object, preserving nested tables
const parsedToWritable = (obj) => obj ?? {};

/**
 * Parse a config that must remain a keyed object when merged and serialized.
 * Arrays, primitives, and null are valid JSON values but invalid Codex auth/config shapes.
 */
const parseConfigObject = (raw, parse) => {
  const parsed = parse(raw);
  if (parsed === null || parsed === undefined || !isObject(parsed) || Array.isArray(parsed)) {
    throw new Error("expected an object");
  }
  return parsed;
};

// Set a nested key from a flat dotted path, creating intermediate objects as needed
const setNestedSection = (obj, dottedKey, value) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || !isObject(cur[keys[i]])) {
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

    return NextResponse.json({
      installed: true,
      config,
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

    // Ensure directory exists
    await fs.mkdir(codexDir, { recursive: true });

    // Parse both existing files before either write. Otherwise a bad auth.json
    // could reject the request only after config.toml had already been replaced.
    const [existingConfig, existingAuth] = await Promise.all([
      readExistingConfig(
        configPath,
        (raw) => parseConfigObject(raw, (value) => parsedToWritable(parseTOML(value))),
      ),
      readExistingConfig(authPath, (raw) => parseConfigObject(raw, JSON.parse)),
    ]);
    const parsed = existingConfig ?? {};
    const authData = existingAuth ?? {};

    // Update only DurinDoor related fields (api_key goes to auth.json, not config.toml)
    parsed.model = model;
    parsed.model_provider = "9router";

    // Update or create 9router provider section (display name DurinDoor) (no api_key - Codex reads from auth.json)
    // Ensure /v1 suffix is added only once
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    setNestedSection(parsed, "model_providers.9router", {
      name: "DurinDoor",
      base_url: normalizedBaseUrl,
      wire_api: "responses"
    });

    // Add subagent configuration
    const effectiveSubagentModel = subagentModel || model;
    setNestedSection(parsed, "agents.subagent", {
      model: effectiveSubagentModel
    });

    // Both destinations passed preflight above; now write their merged values.
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    // Force apikey mode (keep existing tokens untouched for ChatGPT login reuse)
    authData.OPENAI_API_KEY = apiKey;
    authData.auth_mode = "apikey";
    await fs.writeFile(authPath, JSON.stringify(authData, null, 2));

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

// DELETE - Remove DurinDoor settings only (keep other settings)
export async function DELETE() {
  try {
    const configPath = getCodexConfigPath();

    // Read and parse existing config
    let parsed = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parsedToWritable(parseTOML(existingConfig));
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No config file to reset"
        });
      }
      throw error;
    }

    // Remove DurinDoor related root fields only if they point to 9router
    if (parsed.model_provider === "9router") {
      delete parsed.model;
      delete parsed.model_provider;
    }

    // Remove 9router provider section
    deleteNestedSection(parsed, "model_providers.9router");

    // Remove subagent configuration
    deleteNestedSection(parsed, "agents.subagent");

    // Write updated config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    // Remove OPENAI_API_KEY from auth.json
    const authPath = getCodexAuthPath();
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      const authData = JSON.parse(existingAuth);
      delete authData.OPENAI_API_KEY;
      delete authData.auth_mode;

      // Write back or delete if empty
      if (Object.keys(authData).length === 0) {
        await fs.unlink(authPath);
      } else {
        await fs.writeFile(authPath, JSON.stringify(authData, null, 2));
      }
    } catch {/* No auth file */}

    return NextResponse.json({
      success: true,
      message: "DurinDoor settings removed successfully"
    });
  } catch (error) {
    console.log("Error resetting codex settings:", error);
    return NextResponse.json({ error: "Failed to reset codex settings" }, { status: 500 });
  }
}