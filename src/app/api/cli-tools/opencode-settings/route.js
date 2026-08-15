"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import { redactSecrets } from "@/shared/utils/secretRedaction";
import {
  modifyOpenCodeConfig,
  parseOpenCodeConfig,
  resolveOpenCodeConfigDir,
  resolveOpenCodeConfigPath,
} from "@/shared/services/opencodeConfig";

const execAsync = promisify(exec);

const getConfigDir = () => resolveOpenCodeConfigDir();
const getConfigPath = () => resolveOpenCodeConfigPath();

const checkOpenCodeInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where opencode" : "which opencode";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readConfig = async () => {
  try {
    return parseOpenCodeConfig(await fs.readFile(getConfigPath(), "utf-8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const has9RouterConfig = (config) => {
  if (!config?.provider) return false;
  return !!config.provider["9router"];
};

// GET - Check opencode CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkOpenCodeInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "OpenCode CLI is not installed",
      });
    }

    const config = await readConfig();
    const providerConfig = config?.provider?.["9router"];
    const modelMap = providerConfig?.models || {};

    return NextResponse.json({
      installed: true,
      config: redactSecrets(config),
      has9Router: has9RouterConfig(config),
      configPath: getConfigPath(),
        opencode: {
          models: Object.keys(modelMap),
          activeModel: config?.model?.startsWith("9router/") ? config.model.replace(/^9router\//, "") : null,
          baseURL: providerConfig?.options?.baseURL || null,
        },
    });
  } catch (error) {
    console.log("Error checking opencode settings:", error);
    return NextResponse.json({ error: "Failed to check opencode settings" }, { status: 500 });
  }
}

const readSource = async (configPath) => {
  try {
    return await fs.readFile(configPath, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
};

// POST - Apply DurinDoor as openai-compatible provider (multi-model support)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models, activeModel, subagentModel } = await request.json();

    const modelsArray = Array.isArray(models) ? models.slice() : (typeof model === "string" ? [model] : []);

    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl and at least one model are required" }, { status: 400 });
    }

    const configDir = getConfigDir();
    const configPath = getConfigPath();

    await fs.mkdir(configDir, { recursive: true });

    const source = await readSource(configPath);
    const config = source ? parseOpenCodeConfig(source) : {};

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const effectiveSubagentModel = subagentModel || modelsArray[0];
    const existingProvider = config.provider?.["9router"] || {};
    const keyToUse = apiKey || existingProvider.options?.apiKey || "sk_durindoor";

    let next = source || "{}";
    next = modifyOpenCodeConfig(next, ["provider", "9router", "npm"], existingProvider.npm || "@ai-sdk/openai-compatible");
    next = modifyOpenCodeConfig(next, ["provider", "9router", "options", "baseURL"], normalizedBaseUrl);
    next = modifyOpenCodeConfig(next, ["provider", "9router", "options", "apiKey"], keyToUse);
    for (const m of modelsArray) {
      if (!m || typeof m !== "string") continue;
      next = modifyOpenCodeConfig(next, ["provider", "9router", "models", m], {
        name: m,
        modalities: { input: ["text", "image"], output: ["text"] },
      });
    }
    if (activeModel === "") {
      next = modifyOpenCodeConfig(next, ["model"], "");
    } else {
      const finalActive = activeModel || modelsArray[0];
      if (finalActive) next = modifyOpenCodeConfig(next, ["model"], `9router/${finalActive}`);
    }
    next = modifyOpenCodeConfig(next, ["agent", "explorer"], {
      description: "Fast explorer subagent for codebase exploration",
      mode: "subagent",
      model: `9router/${effectiveSubagentModel}`,
    });

    await fs.writeFile(configPath, next);

    return NextResponse.json({
      success: true,
      message: "OpenCode settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.log("Error applying opencode settings:", error);
    const message = error instanceof Error && error.message.includes("invalid JSONC")
      ? error.message
      : "Failed to apply settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH - Update specific settings (e.g., clear active model)
export async function PATCH(request) {
  try {
    const { clearActiveModel } = await request.json();
    const configPath = getConfigPath();
    const source = await readSource(configPath);
    if (!source) return NextResponse.json({ success: true, message: "No config file found" });

    if (clearActiveModel === true) {
      const config = parseOpenCodeConfig(source);
      if (config.model?.startsWith("9router/")) {
        const next = modifyOpenCodeConfig(source, ["model"], "");
        await fs.writeFile(configPath, next);
      }
    }

    return NextResponse.json({ success: true, message: "Settings updated" });
  } catch (error) {
    console.log("Error patching opencode settings:", error);
    return NextResponse.json({ error: "Failed to patch settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router provider or specific models from config
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const modelToRemove = searchParams.get("model");
    const configPath = getConfigPath();
    const source = await readSource(configPath);
    if (!source) return NextResponse.json({ success: true, message: "No config file to reset" });

    const config = parseOpenCodeConfig(source);

    let next = source;
    let mutated = false;
    const provider = config.provider?.["9router"];
    if (modelToRemove) {
      if (provider?.models?.[modelToRemove]) {
        const remaining = Object.keys(provider.models).filter((model) => model !== modelToRemove);
        if (remaining.length === 0) {
          next = modifyOpenCodeConfig(next, ["provider", "9router"], undefined);
          if (config.model?.startsWith("9router/")) next = modifyOpenCodeConfig(next, ["model"], undefined);
          mutated = true;
        } else {
          next = modifyOpenCodeConfig(next, ["provider", "9router", "models", modelToRemove], undefined);
          if (config.model === `9router/${modelToRemove}`) {
            next = modifyOpenCodeConfig(next, ["model"], `9router/${remaining[0]}`);
          }
          mutated = true;
        }
      }
    } else {
      next = modifyOpenCodeConfig(next, ["provider", "9router"], undefined);
      if (config.model?.startsWith("9router/")) next = modifyOpenCodeConfig(next, ["model"], undefined);
      if (config.agent?.explorer?.model?.startsWith("9router/")) {
        next = modifyOpenCodeConfig(next, ["agent", "explorer"], undefined);
        if (Object.keys(config.agent).length === 1) next = modifyOpenCodeConfig(next, ["agent"], undefined);
      }
      mutated = true;
    }

    if (!mutated) {
      return NextResponse.json({ success: true, message: "Nothing to remove" });
    }

    await fs.writeFile(configPath, next);

    return NextResponse.json({
      success: true,
      message: modelToRemove ? `Model "${modelToRemove}" removed` : "DurinDoor settings removed from OpenCode",
    });
  } catch (error) {
    console.log("Error resetting opencode settings:", error);
    return NextResponse.json({ error: "Failed to reset opencode settings" }, { status: 500 });
  }
}
