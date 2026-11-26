"use server";

/**
 * Crush (charmbracelet/crush) settings route — ported from decolua/9router 6c9fe6f.
 *
 * Writes an `openai-compat` `providers.durindoor` entry into
 * `$XDG_CONFIG_HOME/crush/crush.json` (default `~/.config/crush/crush.json`).
 * A legacy `providers.9router` entry counts as configured and is replaced on apply.
 */

import path from "path";
import os from "os";
import { createSettingsRoute, isPlainObject, withV1 } from "@/lib/cliTools/settingsRoute";

const PROVIDER_ID = "durindoor";
const LEGACY_PROVIDER_ID = "9router";

const route = createSettingsRoute({
  id: "crush",
  displayName: "Crush",
  format: "json",
  secretFields: ["api_key"],
  resolvePath: () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "crush", "crush.json"),
  isConfigured: (_raw, config) => {
    const providers = config?.providers;
    if (!isPlainObject(providers)) return false;
    if (providers[PROVIDER_ID]?.base_url || providers[LEGACY_PROVIDER_ID]?.base_url) return true;
    return Object.values(providers).some((p) => String(p?.base_url ?? "").includes("20128"));
  },
  apply: (existing, { baseUrl, apiKey, model }) => {
    const providers = isPlainObject(existing.providers) ? { ...existing.providers } : {};
    delete providers[LEGACY_PROVIDER_ID];
    const modelId = model || "provider/model-id";
    providers[PROVIDER_ID] = {
      type: "openai-compat",
      base_url: withV1(baseUrl),
      api_key: apiKey || "sk_durindoor",
      models: [{ id: modelId, name: modelId, context_window: 128000 }],
    };
    return { ...existing, providers };
  },
  // Remove the DurinDoor (and legacy 9router) provider, keep everything else.
  reset: (existing) => {
    if (!isPlainObject(existing.providers)) return null;
    const providers = { ...existing.providers };
    delete providers[PROVIDER_ID];
    delete providers[LEGACY_PROVIDER_ID];
    const next = { ...existing, providers };
    if (Object.keys(providers).length === 0) delete next.providers;
    return next;
  },
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
