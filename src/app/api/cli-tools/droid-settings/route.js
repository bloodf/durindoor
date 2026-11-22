"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { writeConfigAtomic } from "@/lib/cliTools/readExistingConfig";
import path from "path";
import os from "os";
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser";
import { redactSecrets } from "@/shared/utils/secretRedaction";
import { readExistingConfig } from "@/lib/cliTools/readExistingConfig";
import { isRecord, isString } from "../../../../shared/utils/typeChecks.js";

const execAsync = promisify(exec);
const JSONC_FORMAT_OPTIONS = { insertSpaces: true, tabSize: 2 };

const getDroidDir = () => path.join(os.homedir(), ".factory");
const getDroidSettingsPath = () => path.join(getDroidDir(), "settings.json");

const parseDroidSettings = (raw) => {
  const errors = [];
  const parsed = parseJsonc(raw, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0 || !isRecord(parsed)) {
    throw new Error("expected a JSONC object");
  }
  return { parsed, raw };
};

// Check if droid CLI is installed (via which/where or config file exists)
const checkDroidInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where droid" : "which droid";
    const env = isWindows ?
    { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` } :
    process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getDroidSettingsPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Read current settings.json (JSONC-tolerant for status checks)
const readSettings = async () => {
  try {
    const settingsPath = getDroidSettingsPath();
    const content = await fs.readFile(settingsPath, "utf-8");
    return parseDroidSettings(content).parsed;
  } catch (error) {
    return null;
  }
};

// Check if settings has DurinDoor customModels
const has9RouterConfig = (settings) => {
  if (!settings || !settings.customModels) return false;
  return settings.customModels.some((m) => m.id?.startsWith("custom:9Router"));
};

// GET - Check droid CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkDroidInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        settings: null,
        message: "Factory Droid CLI is not installed"
      });
    }

    const settings = await readSettings();

    return NextResponse.json({
      installed: true,
      settings: redactSecrets(settings),
      has9Router: has9RouterConfig(settings),
      settingsPath: getDroidSettingsPath()
    });
  } catch (error) {
    console.log("Error checking droid settings:", error);
    return NextResponse.json({ error: "Failed to check droid settings" }, { status: 500 });
  }
}

// POST - Update DurinDoor customModels (merge with existing settings)
// Accepts either `model` (string, legacy single-model) or `models` (array of strings, multi-model)
// Also accepts `activeModel` to set which model is active/primary
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models, activeModel } = await request.json();

    // Accept either `models` (array) or `model` (string, legacy)
    const modelsArray = Array.isArray(models) ? models.slice() : isString(model) ? [model] : [];

    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl and at least one model are required" }, { status: 400 });
    }

    const droidDir = getDroidDir();
    const settingsPath = getDroidSettingsPath();

    // Read existing settings before creating directory or writing; refuse unparseable files.
    const existing = await readExistingConfig(settingsPath, parseDroidSettings);
    const settings = existing?.parsed ?? {};
    const existingRaw = existing?.raw ?? null;

    await fs.mkdir(droidDir, { recursive: true });

    const existingCustomModels = Array.isArray(settings.customModels) ? settings.customModels : [];
    const existingKey = existingCustomModels.find((m) => m?.id?.startsWith("custom:9Router"))?.apiKey;

    // Remove all existing DurinDoor configs while keeping the user's own customModels
    const preservedModels = existingCustomModels.filter((m) => !m?.id?.startsWith("custom:9Router"));

    // Normalize baseUrl to ensure a single /v1 suffix
    const trimmedBaseUrl = baseUrl.replace(/\/+$/, "");
    const normalizedBaseUrl = trimmedBaseUrl.endsWith("/v1") ? trimmedBaseUrl : `${trimmedBaseUrl}/v1`;
    const keyToUse = apiKey || existingKey || "your_api_key";

    const addedEntries = [];
    for (let i = 0; i < modelsArray.length; i++) {
      const m = modelsArray[i];
      if (!m || !isString(m)) continue;
      addedEntries.push({
        model: m,
        id: `custom:9Router-${i}`,
        index: i,
        baseUrl: normalizedBaseUrl,
        apiKey: keyToUse,
        displayName: m,
        maxOutputTokens: 131072,
        noImageSupport: false,
        provider: "openai"
      });
    }

    settings.customModels = [...preservedModels, ...addedEntries];

    // Determine default model by ID among DurinDoor's entries; activeModel === "" leaves order unchanged.
    if (!(isString(activeModel) && activeModel === "") && addedEntries.length > 0) {
      const targetEntry = (isString(activeModel) && addedEntries.find((e) => e.model === activeModel)) || addedEntries[0];
      const targetIdx = settings.customModels.findIndex((m) => m.id === targetEntry.id);
      if (targetIdx >= 0) {
        const [defaultEntry] = settings.customModels.splice(targetIdx, 1);
        settings.customModels.unshift({ ...defaultEntry, index: 0 });
      }
    }
    settings.customModels.forEach((m, i) => { m.index = i; });

    // Write settings, preserving JSONC comments and formatting on existing files
    const nextContent = existingRaw !== null
      ? applyEdits(
          existingRaw,
          modify(existingRaw, ["customModels"], settings.customModels, { formattingOptions: JSONC_FORMAT_OPTIONS })
        )
      : JSON.stringify(settings, null, 2);
    await writeConfigAtomic(settingsPath, nextContent);

    return NextResponse.json({
      success: true,
      message: "Factory Droid settings applied successfully!",
      settingsPath
    });
  } catch (error) {
    console.log("Error updating droid settings:", error);
    const refusedToClobber = String(error?.message || "").includes("refusing to overwrite it");
    return NextResponse.json(
      { error: refusedToClobber ? error.message : "Failed to update droid settings" },
      { status: 500 }
    );
  }
}

// DELETE - Remove DurinDoor customModels only (keep other settings)
export async function DELETE() {
  try {
    const settingsPath = getDroidSettingsPath();

    // Read existing settings; refuse unparseable files without modifying them.
    const existing = await readExistingConfig(settingsPath, parseDroidSettings);
    if (!existing) {
      return NextResponse.json({
        success: true,
        message: "No settings file to reset"
      });
    }

    const { parsed: settings, raw: existingRaw } = existing;

    // Remove DurinDoor customModels
    if (Array.isArray(settings.customModels)) {
      const remaining = settings.customModels.filter((m) => !m?.id?.startsWith("custom:9Router"));
      const nextCustomModels = remaining.length > 0 ? remaining : undefined;
      const nextContent = applyEdits(
        existingRaw,
        modify(existingRaw, ["customModels"], nextCustomModels, { formattingOptions: JSONC_FORMAT_OPTIONS })
      );
      await writeConfigAtomic(settingsPath, nextContent);
    }

    return NextResponse.json({
      success: true,
      message: "DurinDoor settings removed successfully"
    });
  } catch (error) {
    console.log("Error resetting droid settings:", error);
    const refusedToClobber = String(error?.message || "").includes("refusing to overwrite it");
    return NextResponse.json(
      { error: refusedToClobber ? error.message : "Failed to reset droid settings" },
      { status: 500 }
    );
  }
}