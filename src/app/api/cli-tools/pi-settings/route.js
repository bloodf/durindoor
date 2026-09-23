"use server";

/**
 * Pi (pi-coding-agent) settings route — ported from decolua/9router 6c9fe6f.
 *
 * Writes an OpenAI-compatible `providers.durindoor` entry into
 * `~/.pi/agent/models.json` (falls back to `~/.pi/models.json` when only that
 * file exists). Pi takes a model list, so POST accepts `models` (strings or
 * `{ id, name, contextWindow, maxTokens }`) or a single `model`.
 * A legacy `providers.9router` entry counts as configured and is replaced on apply.
 */

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { redactSecrets } from "@/shared/utils/secretRedaction";
import { isObject, isString } from "@/shared/utils/typeChecks";
import { readExistingConfig } from "@/lib/cliTools/readExistingConfig";

const execAsync = promisify(exec);

const PROVIDER_ID = "durindoor";
const LEGACY_PROVIDER_ID = "9router";
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 16384;

const getAgentModelsPath = () => path.join(os.homedir(), ".pi", "agent", "models.json");
const getRootModelsPath = () => path.join(os.homedir(), ".pi", "models.json");

const exists = (p) => fs.access(p).then(() => true, () => false);

const resolveModelsJsonPath = async () => {
  if (await exists(getAgentModelsPath())) return getAgentModelsPath();
  if (await exists(getRootModelsPath())) return getRootModelsPath();
  return getAgentModelsPath();
};

const checkPiInstalled = async () => {
  try {
    await execAsync(os.platform() === "win32" ? "where pi" : "which pi", { windowsHide: true });
    return true;
  } catch {
    return (await exists(getAgentModelsPath())) || exists(getRootModelsPath());
  }
};

const isPlainObject = (value) => value !== null && isObject(value) && !Array.isArray(value);

const parseObject = (raw) => {
  const parsed = JSON.parse(raw);
  if (!isPlainObject(parsed)) throw new Error("expected an object");
  return parsed;
};

const hasDurinDoorConfig = (config) => {
  const providers = config?.providers;
  if (!isPlainObject(providers)) return false;
  if (providers[PROVIDER_ID]?.baseUrl || providers[LEGACY_PROVIDER_ID]?.baseUrl) return true;
  return Object.values(providers).some((p) => String(p?.baseUrl ?? "").includes("20128"));
};

const toModelEntry = (m) => {
  if (isString(m)) {
    return { id: m, name: m, contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS };
  }
  const id = m?.id || "provider/model-id";
  return {
    id,
    name: m?.name || id,
    contextWindow: m?.contextWindow || DEFAULT_CONTEXT_WINDOW,
    maxTokens: m?.maxTokens || DEFAULT_MAX_TOKENS,
  };
};

/** GET — report install state, redacted models.json, and whether DurinDoor is configured. */
export async function GET() {
  try {
    if (!(await checkPiInstalled())) {
      return NextResponse.json({ installed: false, config: null, message: "Pi CLI is not installed" });
    }
    const configPath = await resolveModelsJsonPath();
    let config = null;
    try {
      config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    } catch {
      /* absent or unreadable config reads as unconfigured */
    }
    return NextResponse.json({
      installed: true,
      config: redactSecrets(config),
      has9Router: hasDurinDoorConfig(config),
      configPath,
    });
  } catch (error) {
    console.log("Error checking pi settings:", error);
    return NextResponse.json({ error: "Failed to check pi settings" }, { status: 500 });
  }
}

/** POST — merge the DurinDoor provider into models.json; refuses to overwrite an unparseable file. */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const { baseUrl, apiKey, model, models } = body || {};
    if (!baseUrl) return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });

    const configPath = await resolveModelsJsonPath();
    const existing = (await readExistingConfig(configPath, parseObject)) ?? {};
    const providers = isPlainObject(existing.providers) ? { ...existing.providers } : {};
    delete providers[LEGACY_PROVIDER_ID];

    const modelList = Array.isArray(models) && models.length > 0
      ? models.map(toModelEntry)
      : [toModelEntry(model || "provider/model-id")];

    providers[PROVIDER_ID] = {
      baseUrl: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
      apiKey: apiKey || "sk_durindoor",
      api: "openai-completions",
      models: modelList,
    };

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ ...existing, providers }, null, 2), "utf-8");

    return NextResponse.json({
      success: true,
      message: "Pi settings applied! Use /model in Pi to select a DurinDoor model.",
      configPath,
    });
  } catch (error) {
    console.log("Error updating pi settings:", error.message);
    return NextResponse.json({ error: error.message || "Failed to update pi settings" }, { status: 500 });
  }
}

/** DELETE — remove the DurinDoor (and legacy 9router) provider, keep everything else. */
export async function DELETE() {
  try {
    const configPath = await resolveModelsJsonPath();
    const existing = await readExistingConfig(configPath, parseObject);
    if (!existing) return NextResponse.json({ success: true, message: "No config file to reset" });

    if (isPlainObject(existing.providers)) {
      const providers = { ...existing.providers };
      delete providers[PROVIDER_ID];
      delete providers[LEGACY_PROVIDER_ID];
      const next = { ...existing, providers };
      if (Object.keys(providers).length === 0) delete next.providers;
      await fs.writeFile(configPath, JSON.stringify(next, null, 2), "utf-8");
    }

    return NextResponse.json({ success: true, message: "DurinDoor removed from Pi" });
  } catch (error) {
    console.log("Error resetting pi settings:", error.message);
    return NextResponse.json({ error: error.message || "Failed to reset pi settings" }, { status: 500 });
  }
}
