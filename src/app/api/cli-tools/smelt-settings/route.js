"use server";

/**
 * Smelt settings route — ported from decolua/9router 6c9fe6f.
 *
 * Smelt reads a flat `~/.smelt/config.json` (`baseUrl`, `apiKey`, `model`).
 * Apply merges those keys plus a `_managedBy: "durindoor"` marker; reset only
 * strips them when the marker (or legacy `9router` marker) or a DurinDoor URL is present.
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

const MANAGED_BY = "durindoor";
const LEGACY_MANAGED_BY = "9router";
const MANAGED_KEYS = ["baseUrl", "apiKey", "model", "_managedBy"];

const getSmeltConfigPath = () => path.join(os.homedir(), ".smelt", "config.json");

const checkSmeltInstalled = async () => {
  try {
    await execAsync(os.platform() === "win32" ? "where smelt" : "which smelt", { windowsHide: true });
    return true;
  } catch {
    return fs.access(getSmeltConfigPath()).then(() => true, () => false);
  }
};

const isPlainObject = (value) => value !== null && isObject(value) && !Array.isArray(value);

const parseObject = (raw) => {
  const parsed = JSON.parse(raw);
  if (!isPlainObject(parsed)) throw new Error("expected an object");
  return parsed;
};

const hasDurinDoorConfig = (config) => {
  if (!isPlainObject(config)) return false;
  return config._managedBy === MANAGED_BY
    || config._managedBy === LEGACY_MANAGED_BY
    || String(config.baseUrl ?? "").includes("20128");
};

/** GET — report install state, redacted config.json, and whether DurinDoor is configured. */
export async function GET() {
  try {
    if (!(await checkSmeltInstalled())) {
      return NextResponse.json({ installed: false, config: null, message: "Smelt is not installed" });
    }
    let config = null;
    try {
      config = JSON.parse(await fs.readFile(getSmeltConfigPath(), "utf-8"));
    } catch {
      /* absent or unreadable config reads as unconfigured */
    }
    return NextResponse.json({
      installed: true,
      config: redactSecrets(config),
      has9Router: hasDurinDoorConfig(config),
      configPath: getSmeltConfigPath(),
    });
  } catch (error) {
    console.log("Error checking smelt settings:", error);
    return NextResponse.json({ error: "Failed to check smelt settings" }, { status: 500 });
  }
}

/** POST — merge DurinDoor endpoint keys into config.json; refuses to overwrite an unparseable file. */
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

    const configPath = getSmeltConfigPath();
    const existing = (await readExistingConfig(configPath, parseObject)) ?? {};
    const updated = {
      ...existing,
      baseUrl: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
      apiKey: apiKey || "sk_durindoor",
      model: model || existing.model || "provider/model-id",
      _managedBy: MANAGED_BY,
    };

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(updated, null, 2), "utf-8");

    return NextResponse.json({ success: true, message: "Smelt settings applied successfully!", configPath });
  } catch (error) {
    console.log("Error updating smelt settings:", error.message);
    return NextResponse.json({ error: error.message || "Failed to update smelt settings" }, { status: 500 });
  }
}

/** DELETE — strip DurinDoor-managed keys; deletes the file only if nothing else remains. */
export async function DELETE() {
  try {
    const configPath = getSmeltConfigPath();
    const existing = await readExistingConfig(configPath, parseObject);
    if (!existing) return NextResponse.json({ success: true, message: "No config file to reset" });
    if (!hasDurinDoorConfig(existing)) {
      return NextResponse.json({ success: true, message: "Smelt is not configured for DurinDoor" });
    }

    const next = Object.fromEntries(Object.entries(existing).filter(([key]) => !MANAGED_KEYS.includes(key)));
    if (Object.keys(next).length === 0) {
      await fs.rm(configPath, { force: true });
    } else {
      await fs.writeFile(configPath, JSON.stringify(next, null, 2), "utf-8");
    }

    return NextResponse.json({ success: true, message: "DurinDoor removed from Smelt" });
  } catch (error) {
    console.log("Error resetting smelt settings:", error.message);
    return NextResponse.json({ error: error.message || "Failed to reset smelt settings" }, { status: 500 });
  }
}
