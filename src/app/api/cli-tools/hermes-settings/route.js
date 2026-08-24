"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { isString } from "@/shared/utils/typeChecks.js";

const execAsync = promisify(exec);

const PROVIDER_NAME = "9router";
const API_KEY_ENV = "OPENAI_API_KEY";

const getHermesDir = () => path.join(os.homedir(), ".hermes");
const getHermesConfigPath = () => path.join(getHermesDir(), "config.yaml");
const getHermesEnvPath = () => path.join(getHermesDir(), ".env");

// Match top-level "model:" block (until next non-indented, non-empty line)
const MODEL_BLOCK_RE = /^model:[ \t]*\r?\n((?:[ \t]+.*\r?\n?|[ \t]*\r?\n)*)/m;

const escapeYamlString = (value) => String(value).
replace(/\\/g, "\\\\").
replace(/"/g, '\\"').
replace(/\r/g, "\\r").
replace(/\n/g, "\\n").
replace(/\t/g, "\\t");

const validateInput = (value, field) => {
  if (!value.trim()) return { error: `${field} must not be blank` };
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return { error: `${field} must not contain control characters` };
  return null;
};

const buildModelBlock = (model, baseUrl) => {
  const safeModel = escapeYamlString(model);
  const safeBaseUrl = escapeYamlString(baseUrl);
  return `model:\n  default: "${safeModel}"\n  provider: "custom"\n  base_url: "${safeBaseUrl}"\n  api_key: \${OPENAI_API_KEY}\n`;
};

// Parse current model block back to fields (best-effort, simple key:value)
const parseModelBlock = (yaml) => {
  const match = yaml.match(MODEL_BLOCK_RE);
  if (!match) return null;
  const body = match[1] || "";
  const get = (key) => {
    const m = body.match(new RegExp(`^[ \\t]+${key}:[ \\t]*["']?([^"'\\r\\n]+)["']?`, "m"));
    return m ? m[1].trim() : null;
  };
  return {
    default: get("default"),
    provider: get("provider"),
    base_url: get("base_url")
  };
};

const upsertModelBlock = (yaml, newBlock) => {
  if (MODEL_BLOCK_RE.test(yaml)) return yaml.replace(MODEL_BLOCK_RE, newBlock);
  return yaml.length > 0 ? `${newBlock}\n${yaml}` : newBlock;
};

const removeModelBlock = (yaml) => yaml.replace(MODEL_BLOCK_RE, "").replace(/^\n+/, "");

// .env helpers — upsert/remove single KEY=VALUE line
const upsertEnvVar = (envText, key, value) => {
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (re.test(envText)) return envText.replace(re, line);
  return envText.length > 0 && !envText.endsWith("\n") ? `${envText}\n${line}\n` : `${envText}${line}\n`;
};

const removeEnvVar = (envText, key) => {
  const re = new RegExp(`^${key}=.*\\r?\\n?`, "m");
  return envText.replace(re, "");
};

const checkHermesInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where hermes" : "which hermes";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getHermesConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readConfigYaml = async () => {
  try {
    return await fs.readFile(getHermesConfigPath(), "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
};

const readEnvFile = async () => {
  const envPath = getHermesEnvPath();
  try {
    if ((await fs.lstat(envPath)).isSymbolicLink()) {
      throw new Error("Hermes environment file must not be a symlink");
    }
    return await fs.readFile(envPath, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
};

const writeHermesEnvFile = async (envText) => {
  const envPath = getHermesEnvPath();
  const dir = path.dirname(envPath);
  const tempDir = await fs.mkdtemp(path.join(dir, ".env.tmp-"));
  const tempPath = path.join(tempDir, ".env");
  try {
    await fs.writeFile(tempPath, envText, { mode: 0o600, flag: "wx" });
    await fs.rename(tempPath, envPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
};

// Detect 9router by base_url containing localhost/127.0.0.1 or matching tunnel URL
const has9RouterConfig = (modelCfg) => {
  if (!modelCfg?.base_url) return false;
  return modelCfg.provider === "custom" && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(modelCfg.base_url);
};

export async function GET() {
  try {
    const installed = await checkHermesInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, settings: null, message: "Hermes Agent is not installed" });
    }
    const yaml = await readConfigYaml();
    const model = parseModelBlock(yaml);
    return NextResponse.json({
      installed: true,
      settings: { model },
      has9Router: has9RouterConfig(model),
      configPath: getHermesConfigPath()
    });
  } catch {
    console.log("Hermes settings read failed");
    return NextResponse.json({ error: "Failed to check hermes settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model } = await request.json();
    if (!isString(baseUrl) || !isString(model)) {
      return NextResponse.json({ error: "baseUrl and model are required" }, { status: 400 });
    }
    if (apiKey != null && !isString(apiKey)) {
      return NextResponse.json({ error: "apiKey must be a non-empty string when provided" }, { status: 400 });
    }
    const invalidBaseUrl = validateInput(baseUrl, "baseUrl");
    const invalidModel = validateInput(model, "model");
    const invalidApiKey = apiKey == null ? null : validateInput(apiKey, "apiKey") || (/\s/u.test(apiKey) ? { error: "apiKey must not contain whitespace" } : null);
    if (invalidBaseUrl || invalidModel || invalidApiKey) {
      return NextResponse.json(invalidBaseUrl || invalidModel || invalidApiKey, { status: 400 });
    }

    const dir = getHermesDir();
    await fs.mkdir(dir, { recursive: true });

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

    // Update config.yaml — replace/insert model: block, keep everything else
    const existingYaml = await readConfigYaml();
    const newYaml = upsertModelBlock(existingYaml, buildModelBlock(model, normalizedBaseUrl));
    await fs.writeFile(getHermesConfigPath(), newYaml);

    // Update .env — upsert OPENAI_API_KEY only when caller provides one
    if (apiKey) {
      const existingEnv = await readEnvFile();
      const newEnv = upsertEnvVar(existingEnv, API_KEY_ENV, apiKey);
      await writeHermesEnvFile(newEnv);
    }

    return NextResponse.json({
      success: true,
      message: "Hermes settings applied successfully!",
      configPath: getHermesConfigPath()
    });
  } catch (error) {
    console.log("Hermes settings update failed");
    return NextResponse.json({ error: "Failed to update hermes settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = getHermesConfigPath();
    let yaml = "";
    try {
      yaml = await fs.readFile(configPath, "utf-8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file to reset" });
      }
      throw error;
    }
    const newYaml = removeModelBlock(yaml);
    await fs.writeFile(configPath, newYaml);
    return NextResponse.json({ success: true, message: `${PROVIDER_NAME} model block removed` });
  } catch {
    console.log("Hermes settings reset failed");
    return NextResponse.json({ error: "Failed to reset hermes settings" }, { status: 500 });
  }
}