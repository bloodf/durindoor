import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { SETTINGS_SCHEMA, validateSettingsPatch } from "../../src/lib/settings/settingsSchema.js";

const root = resolve(import.meta.dirname, "../..");
// These names refer to external tool configs, API responses, filenames, or derived GET fields.
const allowlist = {
  agents: "OpenClaw configuration", attemptedAt: "quota response metadata", data: "HTTP response data",
  debug: "third-party configuration", env: "third-party configuration", excerpt_settings: "search request settings",
  id: "third-party configuration", json: "settings.json filename", location: "search request settings",
  model: "third-party configuration", models: "OpenClaw configuration", ok: "HTTP response status",
  openAiBaseUrl: "third-party configuration", openAiModelId: "third-party configuration",
  organization_id: "Claude usage response", organization_name: "Claude usage response", plan: "Claude usage response",
  secrets: "masking example", source_policy: "search request settings", stream: "third-party configuration",
  usage: "third-party configuration", customModels: "Droid configuration", hasPassword: "derived GET field",
  mfaBackupCodesRemaining: "derived GET field", oidcConfigured: "derived GET field", error: "HTTP error response",
};
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe("settings schema coverage", () => {
  it("covers static settings reads and literal API patch bodies", () => {
    const missing = [];
    for (const path of ["src", "open-sse", "cli/src"].flatMap((dir) => files(resolve(root, dir)))) {
      const source = readFileSync(path, "utf8");
      const keys = [...source.matchAll(/\bsettings(?:Data)?\??\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
      // Literal object bodies are checked separately; dynamic patch variables are covered by their call sites.
      for (const match of source.matchAll(/(?:fetch|requestJSON)\(\s*["']\/api\/settings["'][\s\S]{0,300}?method:\s*["'](?:PATCH|POST)["'][\s\S]{0,300}?JSON\.stringify\(\s*\{\s*([A-Za-z_$][\w$]*)/g)) keys.push(match[1]);
      for (const key of keys) if (!Object.hasOwn(SETTINGS_SCHEMA, key) && !Object.hasOwn(allowlist, key)) missing.push(`${relative(root, path)}: ${key}`);
    }
    expect(missing).toEqual([]);
  });
  it("accepts the Claude naming toggle and provider thinking map", () => {
    expect(validateSettingsPatch({ ccFilterNaming: true, providerThinking: { openai: { mode: "off" } } })).toEqual([]);
    expect(validateSettingsPatch({ ccFilterNaming: "true", providerThinking: [] })).toEqual(["ccFilterNaming", "providerThinking"]);
  });
});
