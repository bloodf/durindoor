"use server";

/**
 * ForgeCode (antinomyhq/forge) settings route — ported from decolua/9router 6c9fe6f.
 *
 * Writes the `[openai]` table (`api_key`, `base_url`, `model`) in `~/.forge/config.toml`
 * under a "managed by DurinDoor" header. Other tables are preserved. Reset only removes
 * `[openai]` when it is DurinDoor-managed (current or legacy 9Router header, or a DurinDoor URL).
 */

import path from "path";
import os from "os";
import { createSettingsRoute, withV1 } from "@/lib/cliTools/settingsRoute";

const MANAGED_MARKERS = ["managed by DurinDoor", "managed by 9Router"];

const route = createSettingsRoute({
  id: "forge",
  displayName: "ForgeCode",
  format: "toml",
  header: "# ForgeCode config - managed by DurinDoor\n\n",
  secretFields: ["api_key"],
  resolvePath: () => path.join(os.homedir(), ".forge", "config.toml"),
  isConfigured: (raw, config) =>
    MANAGED_MARKERS.some((marker) => String(raw ?? "").includes(marker))
    || String(config?.openai?.base_url ?? "").includes("20128"),
  apply: (existing, { baseUrl, apiKey, model }) => ({
    ...existing,
    openai: {
      api_key: apiKey || "sk_durindoor",
      base_url: withV1(baseUrl),
      model: model || "provider/model-id",
    },
  }),
  // Drop the DurinDoor-managed `[openai]` table; the file is deleted if nothing else remains.
  reset: ({ openai: _removed, ...rest }) => rest,
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
