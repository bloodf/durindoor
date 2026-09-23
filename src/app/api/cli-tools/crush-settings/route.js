"use server";

/**
 * Crush (charmbracelet/crush) settings route — ported from decolua/9router 6c9fe6f.
 *
 * Writes an `openai-compat` `providers.durindoor` entry into
 * `$XDG_CONFIG_HOME/crush/crush.json` (default `~/.config/crush/crush.json`).
 * A legacy `providers.9router` entry counts as configured and is replaced on apply.
 */

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { redactSecrets } from "@/shared/utils/secretRedaction";
import { isObject } from "@/shared/utils/typeChecks";
import { readExistingConfig } from "@/lib/cliTools/readExistingConfig";

const execAsync = promisify(exec);

const PROVIDER_ID = "durindoor";
const LEGACY_PROVIDER_ID = "9router";

const getCrushConfigPath = () => {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configDir, "crush", "crush.json");
};

const checkCrushInstalled = async () => {
  try {
    await execAsync(os.platform() === "win32" ? "where crush" : "which crush", { windowsHide: true });
    return true;
  } catch {
    return fs.access(getCrushConfigPath()).then(() => true, () => false);
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
  if (providers[PROVIDER_ID]?.base_url || providers[LEGACY_PROVIDER_ID]?.base_url) return true;
  return Object.values(providers).some((p) => String(p?.base_url ?? "").includes("20128"));
};

/** GET — report install state, redacted crush.json, and whether DurinDoor is configured. */
export async function GET() {
  try {
    if (!(await checkCrushInstalled())) {
      return NextResponse.json({ installed: false, config: null, message: "Crush CLI is not installed" });
    }
    let config = null;
    try {
      config = JSON.parse(await fs.readFile(getCrushConfigPath(), "utf-8"));
    } catch {
      /* absent or unreadable config reads as unconfigured */
    }
    return NextResponse.json({
      installed: true,
      config: redactSecrets(config),
      has9Router: hasDurinDoorConfig(config),
      configPath: getCrushConfigPath(),
    });
  } catch (error) {
    console.log("Error checking crush settings:", error);
    return NextResponse.json({ error: "Failed to check crush settings" }, { status: 500 });
  }
}

/** POST — merge the DurinDoor provider into crush.json; refuses to overwrite an unparseable file. */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const { baseUrl, apiKey, model } = body || {};
    if (!baseUrl) return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });

    const configPath = getCrushConfigPath();
    const existing = (await readExistingConfig(configPath, parseObject)) ?? {};
    const providers = isPlainObject(existing.providers) ? { ...existing.providers } : {};
    delete providers[LEGACY_PROVIDER_ID];

    const modelId = model || "provider/model-id";
    providers[PROVIDER_ID] = {
      type: "openai-compat",
      base_url: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
      api_key: apiKey || "sk_durindoor",
      models: [{ id: modelId, name: modelId, context_window: 128000 }],
    };

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ ...existing, providers }, null, 2), "utf-8");

    return NextResponse.json({ success: true, message: "Crush settings applied successfully!", configPath });
  } catch (error) {
    console.log("Error updating crush settings:", error.message);
    return NextResponse.json({ error: error.message || "Failed to update crush settings" }, { status: 500 });
  }
}

/** DELETE — remove the DurinDoor (and legacy 9router) provider, keep everything else. */
export async function DELETE() {
  try {
    const configPath = getCrushConfigPath();
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

    return NextResponse.json({ success: true, message: "DurinDoor removed from Crush" });
  } catch (error) {
    console.log("Error resetting crush settings:", error.message);
    return NextResponse.json({ error: error.message || "Failed to reset crush settings" }, { status: 500 });
  }
}
