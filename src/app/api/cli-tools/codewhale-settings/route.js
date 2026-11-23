"use server";

/**
 * CodeWhale (Hmbown/CodeWhale) settings route — ported from decolua/9router 6c9fe6f.
 *
 * Writes the `[openai]` table (`api_key`, `base_url`, `model`) in `~/.codewhale/config.toml`
 * under a "managed by DurinDoor" header. Other tables are preserved. Reset only removes
 * `[openai]` when it is DurinDoor-managed (current or legacy 9Router header, or a DurinDoor URL).
 */

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { parseTOML, stringifyTOML } from "confbox";
import { redactSecrets } from "@/shared/utils/secretRedaction";
import { isObject } from "@/shared/utils/typeChecks";
import { readExistingConfig, writeConfigAtomic } from "@/lib/cliTools/readExistingConfig";

const execAsync = promisify(exec);

const MANAGED_HEADER = "# CodeWhale config - managed by DurinDoor\n\n";
const MANAGED_MARKERS = ["managed by DurinDoor", "managed by 9Router"];

const getCodewhaleConfigPath = () => path.join(os.homedir(), ".codewhale", "config.toml");
const getLegacyConfigPath = () => path.join(os.homedir(), ".deepseek", "config.toml");

// An existing primary file wins, including when it cannot be parsed.
const getActiveConfigPath = async () => {
  for (const file of [getCodewhaleConfigPath(), getLegacyConfigPath()]) {
    try {
      await fs.access(file);
      return file;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return getCodewhaleConfigPath();
};

const checkCodewhaleInstalled = async () => {
  try {
    await execAsync(os.platform() === "win32" ? "where codewhale" : "which codewhale", { windowsHide: true });
    return true;
  } catch {
    return fs.access(await getActiveConfigPath()).then(() => true, () => false);
  }
};

const isPlainObject = (value) => value !== null && isObject(value) && !Array.isArray(value);

const parseObject = (raw) => {
  const parsed = parseTOML(raw);
  if (!isPlainObject(parsed)) throw new Error("expected an object");
  return parsed;
};

const hasDurinDoorConfig = (raw, config) =>
  MANAGED_MARKERS.some((marker) => String(raw ?? "").includes(marker))
  || String(config?.openai?.base_url ?? config?.providers?.openai?.base_url ?? "").includes("20128");

/** GET — report install state, redacted parsed config, and whether DurinDoor is configured. */
export async function GET() {
  try {
    if (!(await checkCodewhaleInstalled())) {
      return NextResponse.json({ installed: false, config: null, message: "CodeWhale is not installed" });
    }
    const configPath = await getActiveConfigPath();
    let raw = null;
    let config = null;
    try {
      raw = await fs.readFile(configPath, "utf-8");
      config = parseObject(raw);
    } catch {
      /* absent or unparseable config reads as unconfigured */
    }
    return NextResponse.json({
      installed: true,
      config: redactSecrets(config),
      has9Router: hasDurinDoorConfig(raw, config),
      configPath,
    });
  } catch (error) {
    console.log("Error checking codewhale settings:", error);
    return NextResponse.json({ error: "Failed to check codewhale settings" }, { status: 500 });
  }
}

/** POST — set the `[openai]` table; refuses to overwrite an unparseable config.toml. */
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

    const configPath = await getActiveConfigPath();
    const existing = (await readExistingConfig(configPath, parseObject)) ?? {};
    const legacyOpenai = isPlainObject(existing.providers?.openai) ? existing.providers.openai : {};
    const currentOpenai = isPlainObject(existing.openai) ? existing.openai : {};
    const providers = isPlainObject(existing.providers) ? { ...existing.providers } : null;
    if (providers) delete providers.openai;
    const updated = {
      ...existing,
      openai: {
        ...legacyOpenai,
        ...currentOpenai,
        api_key: apiKey || currentOpenai.api_key || legacyOpenai.api_key || "sk_durindoor",
        base_url: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
        model: model || "provider/model-id",
      },
    };

    if (providers && Object.keys(providers).length) updated.providers = providers;
    else if (providers) delete updated.providers;

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await writeConfigAtomic(configPath, MANAGED_HEADER + stringifyTOML(updated), "utf-8");

    return NextResponse.json({ success: true, message: "CodeWhale settings applied successfully!", configPath });
  } catch (error) {
    console.log("Error updating codewhale settings:", error.message);
    return NextResponse.json({ error: error.message || "Failed to update codewhale settings" }, { status: 500 });
  }
}

/** DELETE — drop the DurinDoor-managed `[openai]` table; deletes the file if nothing else remains. */
export async function DELETE() {
  try {
    const configPath = await getActiveConfigPath();
    let raw = "";
    const existing = await readExistingConfig(configPath, (content) => {
      raw = content;
      return parseObject(content);
    });
    if (!existing) return NextResponse.json({ success: true, message: "No config file to reset" });
    if (!hasDurinDoorConfig(raw, existing)) {
      return NextResponse.json({ success: true, message: "CodeWhale is not configured for DurinDoor" });
    }

    const rest = { ...existing };
    if (existing.openai) delete rest.openai;
    else if (isPlainObject(rest.providers) && rest.providers.openai) {
      const { openai: _legacyRemoved, ...otherProviders } = rest.providers;
      if (Object.keys(otherProviders).length) rest.providers = otherProviders;
      else delete rest.providers;
    }
    if (Object.keys(rest).length === 0) {
      await fs.rm(configPath, { force: true });
    } else {
      await writeConfigAtomic(configPath, stringifyTOML(rest), "utf-8");
    }

    return NextResponse.json({ success: true, message: "DurinDoor removed from CodeWhale" });
  } catch (error) {
    console.log("Error resetting codewhale settings:", error.message);
    return NextResponse.json({ error: error.message || "Failed to reset codewhale settings" }, { status: 500 });
  }
}
