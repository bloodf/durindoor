"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { assertWriterOwnsTarget, readExistingConfig, writeConfigAtomic } from "@/lib/cliTools/readExistingConfig";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const getDataDir = () => path.join(os.homedir(), ".cline", "data");
const getGlobalStatePath = () => path.join(getDataDir(), "globalState.json");
const getSecretsPath = () => path.join(getDataDir(), "secrets.json");

const checkInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where cline" : "which cline";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getGlobalStatePath());
      return true;
    } catch {
      return false;
    }
  }
};

const readJson = (filePath) => readExistingConfig(filePath, (content) =>
  JSON.parse(content.replace(/,(\s*[}\]])/g, "$1"))
);

const has9RouterConfig = (globalState) => {
  if (!globalState) return false;
  const isOpenAi =
    globalState.actModeApiProvider === "openai" || globalState.planModeApiProvider === "openai";
  const baseUrl = globalState.openAiBaseUrl || "";
  return isOpenAi && (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes("9router"));
};

export async function GET() {
  try {
    const installed = await checkInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, settings: null, message: "Cline CLI is not installed" });
    }
    const globalState = await readJson(getGlobalStatePath());
    return NextResponse.json({
      installed: true,
      settings: {
        actModeApiProvider: globalState?.actModeApiProvider,
        planModeApiProvider: globalState?.planModeApiProvider,
        openAiBaseUrl: globalState?.openAiBaseUrl,
        openAiModelId: globalState?.openAiModelId,
      },
      has9Router: has9RouterConfig(globalState),
      globalStatePath: getGlobalStatePath(),
    });
  } catch (error) {
    console.log("Error checking cline settings:", error);
    return NextResponse.json({ error: ["CLI_CONFIG_PARSE_ERROR", "CLI_CONFIG_FOREIGN_OWNER"].includes(error?.code) ? error.message : "Failed to check cline settings" }, { status: ["CLI_CONFIG_PARSE_ERROR", "CLI_CONFIG_FOREIGN_OWNER"].includes(error?.code) ? 409 : 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model } = await request.json();
    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    await fs.mkdir(getDataDir(), { recursive: true });

    // Cline expects base WITHOUT /v1
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl.slice(0, -3) : baseUrl;

    const globalState = (await readJson(getGlobalStatePath())) || {};
    globalState.actModeApiProvider = "openai";
    globalState.planModeApiProvider = "openai";
    globalState.openAiBaseUrl = normalizedBaseUrl;
    globalState.openAiModelId = model;
    globalState.planModeOpenAiModelId = model;
    await readJson(getSecretsPath());
    // Refuse a foreign target before changing either settings file.
    await Promise.all([getGlobalStatePath(), getSecretsPath()].map(assertWriterOwnsTarget));
    await writeConfigAtomic(getGlobalStatePath(), JSON.stringify(globalState, null, 2));

    const secrets = (await readJson(getSecretsPath())) || {};
    secrets.openAiApiKey = apiKey;
    await writeConfigAtomic(getSecretsPath(), JSON.stringify(secrets, null, 2));

    return NextResponse.json({ success: true, message: "Cline settings applied successfully!", globalStatePath: getGlobalStatePath() });
  } catch (error) {
    console.log("Error updating cline settings:", error);
    return NextResponse.json({ error: ["CLI_CONFIG_PARSE_ERROR", "CLI_CONFIG_FOREIGN_OWNER"].includes(error?.code) ? error.message : "Failed to update cline settings" }, { status: ["CLI_CONFIG_PARSE_ERROR", "CLI_CONFIG_FOREIGN_OWNER"].includes(error?.code) ? 409 : 500 });
  }
}

export async function DELETE() {
  try {
    const globalState = await readJson(getGlobalStatePath());
    if (!globalState) {
      return NextResponse.json({ success: true, message: "No settings file to reset" });
    }

    if (globalState.actModeApiProvider === "openai") {
      delete globalState.openAiBaseUrl;
      delete globalState.openAiModelId;
      delete globalState.planModeOpenAiModelId;
      globalState.actModeApiProvider = "cline";
      globalState.planModeApiProvider = "cline";
    }
    await readJson(getSecretsPath());
    // Refuse a foreign target before changing either settings file.
    await Promise.all([getGlobalStatePath(), getSecretsPath()].map(assertWriterOwnsTarget));
    await writeConfigAtomic(getGlobalStatePath(), JSON.stringify(globalState, null, 2));

    const secrets = (await readJson(getSecretsPath())) || {};
    delete secrets.openAiApiKey;
    await writeConfigAtomic(getSecretsPath(), JSON.stringify(secrets, null, 2));

    return NextResponse.json({ success: true, message: "DurinDoor settings removed from Cline" });
  } catch (error) {
    console.log("Error resetting cline settings:", error);
    return NextResponse.json({ error: ["CLI_CONFIG_PARSE_ERROR", "CLI_CONFIG_FOREIGN_OWNER"].includes(error?.code) ? error.message : "Failed to reset cline settings" }, { status: ["CLI_CONFIG_PARSE_ERROR", "CLI_CONFIG_FOREIGN_OWNER"].includes(error?.code) ? 409 : 500 });
  }
}
