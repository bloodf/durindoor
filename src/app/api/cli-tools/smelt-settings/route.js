"use server";

/**
 * Smelt settings route — ported from decolua/9router 6c9fe6f.
 *
 * Smelt reads a flat `~/.smelt/config.json` (`baseUrl`, `apiKey`, `model`).
 * Apply merges those keys plus a `_managedBy: "durindoor"` marker; reset only
 * strips them when the marker (or legacy `9router` marker) or a DurinDoor URL is present.
 */

import path from "path";
import os from "os";
import { createSettingsRoute, isPlainObject, withV1 } from "@/lib/cliTools/settingsRoute";

const MANAGED_BY = "durindoor";
const LEGACY_MANAGED_BY = "9router";
const MANAGED_KEYS = ["baseUrl", "apiKey", "model", "_managedBy"];

const route = createSettingsRoute({
  id: "smelt",
  displayName: "Smelt",
  format: "json",
  secretFields: ["apiKey"],
  messages: { notInstalled: "Smelt is not installed" },
  resolvePath: () => path.join(os.homedir(), ".smelt", "config.json"),
  isConfigured: (_raw, config) => {
    if (!isPlainObject(config)) return false;
    return config._managedBy === MANAGED_BY
      || config._managedBy === LEGACY_MANAGED_BY
      || String(config.baseUrl ?? "").includes("20128");
  },
  apply: (existing, { baseUrl, apiKey, model }) => ({
    ...existing,
    baseUrl: withV1(baseUrl),
    apiKey: apiKey || "sk_durindoor",
    model: model || existing.model || "provider/model-id",
    _managedBy: MANAGED_BY,
  }),
  // Strip DurinDoor-managed keys; the file is deleted only if nothing else remains.
  reset: (existing) => Object.fromEntries(Object.entries(existing).filter(([key]) => !MANAGED_KEYS.includes(key))),
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
