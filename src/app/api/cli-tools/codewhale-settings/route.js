"use server";

/**
 * CodeWhale (Hmbown/CodeWhale) settings route — ported from decolua/9router 6c9fe6f.
 *
 * Writes the `[openai]` table (`api_key`, `base_url`, `model`) in `~/.codewhale/config.toml`
 * under a "managed by DurinDoor" header. Other tables are preserved. Reset only removes
 * `[openai]` when it is DurinDoor-managed (current or legacy 9Router header, or a DurinDoor URL).
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { createSettingsRoute, isPlainObject, withV1 } from "@/lib/cliTools/settingsRoute";

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

const route = createSettingsRoute({
  id: "codewhale",
  displayName: "CodeWhale",
  format: "toml",
  header: "# CodeWhale config - managed by DurinDoor\n\n",
  secretFields: ["api_key"],
  messages: { notInstalled: "CodeWhale is not installed" },
  resolvePath: getActiveConfigPath,
  isConfigured: (raw, config) =>
    MANAGED_MARKERS.some((marker) => String(raw ?? "").includes(marker))
    || String(config?.openai?.base_url ?? config?.providers?.openai?.base_url ?? "").includes("20128"),
  // The legacy `[providers.openai]` table is folded into `[openai]`.
  apply: (existing, { baseUrl, apiKey, model }) => {
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
        base_url: withV1(baseUrl),
        model: model || "provider/model-id",
      },
    };
    if (providers && Object.keys(providers).length) updated.providers = providers;
    else if (providers) delete updated.providers;
    return updated;
  },
  // Drop the DurinDoor-managed `[openai]` (or legacy `[providers.openai]`) table.
  reset: (existing) => {
    const rest = { ...existing };
    if (existing.openai) delete rest.openai;
    else if (isPlainObject(rest.providers) && rest.providers.openai) {
      const { openai: _legacyRemoved, ...otherProviders } = rest.providers;
      if (Object.keys(otherProviders).length) rest.providers = otherProviders;
      else delete rest.providers;
    }
    return rest;
  },
  resetOnlyWhenConfigured: true,
  removeWhenEmpty: true,
});

export async function GET() {
  return route.GET();
}

export async function POST(request) {
  return route.POST(request);
}

export async function DELETE() {
  return route.DELETE();
}
