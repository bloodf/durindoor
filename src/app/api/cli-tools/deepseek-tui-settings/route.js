"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { writeConfigAtomic } from "@/lib/cliTools/readExistingConfig";
import path from "path";
import os from "os";
import { redactSecrets } from "@/shared/utils/secretRedaction";
import { parseTOML, stringifyTOML } from "confbox";
import { isObject, isString } from "@/shared/utils/typeChecks";

const execAsync = promisify(exec);

const PROVIDER_NAME = "9router";

const getDeepSeekDir = () => path.join(os.homedir(), ".deepseek");
const getDeepSeekConfigPath = () => path.join(getDeepSeekDir(), "config.toml");

const parseConfig = (content) => {
    const parsed = parseTOML(content);
    if (parsed === null || !isObject(parsed) || Array.isArray(parsed)) throw new Error("Invalid TOML config");
    return parsed;
};
const containsControlCharacters = (value) => /[\x00-\x1F\x7F]/.test(value);

// Default DeepSeek config (reset state)
const DEFAULT_CONFIG = `provider = "deepseek"
`;

const checkDeepSeekInstalled = async () => {
    try {
        const isWindows = os.platform() === "win32";
        const command = isWindows ? "where deepseek" : "which deepseek";
        await execAsync(command, { windowsHide: true });
        return true;
    } catch {
        try {
            await fs.access(getDeepSeekConfigPath());
            return true;
        } catch {
            return false;
        }
    }
};

const readConfigToml = async () => {
    try {
        return await fs.readFile(getDeepSeekConfigPath(), "utf-8");
    } catch (error) {
        if (error.code === "ENOENT") return "";
        throw error;
    }
};

// Detect DurinDoor by checking if provider is "openai" and base_url points to localhost/127.0.0.1
const has9RouterConfig = (config) => {
    if (!config) return false;
    const provider = config.provider;
    if (provider !== "openai") return false;
    const openaiSection = config["providers.openai"];
    if (!openaiSection?.base_url) return false;
    return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(openaiSection.base_url);
};

export async function GET() {
    try {
        const installed = await checkDeepSeekInstalled();
        if (!installed) {
            return NextResponse.json({ installed: false, settings: null, message: "DeepSeek TUI is not installed" });
        }
        const toml = await readConfigToml();
        const config = parseConfig(toml);
        return NextResponse.json({
            installed: true,
            settings: redactSecrets(config),
            has9Router: has9RouterConfig(config),
            configPath: getDeepSeekConfigPath(),
        });
    } catch (error) {
        console.log("Error checking deepseek-tui settings:", error);
        return NextResponse.json({ error: "Failed to check deepseek-tui settings" }, { status: 500 });
    }
}

/** Merge the managed provider into valid TOML and serialize every value safely. */
export async function POST(request) {
    try {
        const { baseUrl, apiKey, model } = await request.json();
        if (!isString(baseUrl) || !baseUrl || !isString(model) || !model) {
            return NextResponse.json({ error: "baseUrl and model are required" }, { status: 400 });
        }
        if ([baseUrl, model, ...(apiKey == null ? [] : [apiKey])].some((value) => !isString(value) || containsControlCharacters(value))) {
            return NextResponse.json({ error: "Settings must not contain control characters" }, { status: 400 });
        }

        const dir = getDeepSeekDir();
        await fs.mkdir(dir, { recursive: true });

        const existing = parseConfig(await readConfigToml());
        const providers = isObject(existing.providers) && !Array.isArray(existing.providers) ? existing.providers : {};
        const existingProvider = isObject(providers.openai) && !Array.isArray(providers.openai) ? providers.openai : {};
        const updated = {
            ...existing,
            provider: "openai",
            providers: {
                ...providers,
                openai: {
                    ...existingProvider,
                    base_url: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
                    api_key: apiKey || existingProvider.api_key || "sk_durindoor",
                    model,
                },
            },
        };
        await writeConfigAtomic(getDeepSeekConfigPath(), stringifyTOML(updated), "utf-8");

        return NextResponse.json({
            success: true,
            message: "DeepSeek TUI settings applied successfully!",
            configPath: getDeepSeekConfigPath(),
        });
    } catch (error) {
        console.log("Error updating deepseek-tui settings:", error);
        return NextResponse.json({ error: "Failed to update deepseek-tui settings" }, { status: 500 });
    }
}

export async function DELETE() {
    try {
        const configPath = getDeepSeekConfigPath();
        try {
            await fs.access(configPath);
        } catch {
            return NextResponse.json({ success: true, message: "No config file to reset" });
        }

        await writeConfigAtomic(configPath, DEFAULT_CONFIG);
        return NextResponse.json({ success: true, message: `${PROVIDER_NAME} config reset to DeepSeek defaults` });
    } catch (error) {
        console.log("Error resetting deepseek-tui settings:", error);
        return NextResponse.json({ error: "Failed to reset deepseek-tui settings" }, { status: 500 });
    }
}
