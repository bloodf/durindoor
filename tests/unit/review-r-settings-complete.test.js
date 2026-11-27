import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { parseExpression } from "@babel/parser";
import { settingsReadKeys } from "../../scripts/lib/settings-read-keys.mjs";
import { SETTINGS_SCHEMA, validateSettingsPatch } from "../../src/lib/settings/settingsSchema.js";

const mocks = vi.hoisted(() => ({ updateSettings: vi.fn(), getSettings: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, updateSettings: mocks.updateSettings }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn(), resetComboScoring: vi.fn() }));
vi.mock("@/lib/settings/settingsPatchAuth", async (importOriginal) => ({
  ...await importOriginal(), canModifySecurityCriticalSettings: vi.fn(async () => true),
}));
import { PATCH } from "../../src/app/api/settings/route.js";

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

// Parse literal payloads so every top-level key is checked, including shorthand keys.
function literalKeys(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
    } else if (char === "\"" || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try {
        return parseExpression(source.slice(start, i + 1)).properties
          .filter((property) => property.type === "ObjectProperty" && !property.computed)
          .map((property) => property.key.name ?? property.key.value);
      } catch (error) { throw new Error(`Cannot parse settings payload: ${error.message}`); }
    }
  }
  return [];
}

describe("settings schema coverage", () => {
  it("distinguishes local media payloads from stored settings in the same file", () => {
    expect(settingsReadKeys(`
      const settings = await getSettings();
      settings.missingStoredKey;
      function media() {
        const settings = { model_type: "upscale" };
        settings.scale_factor = 2;
        settings.creativity = 0.5;
        settings.mode = "upscale";
      }
      settings?.anotherMissingStoredKey;
    `)).toEqual(["missingStoredKey", "anotherMissingStoredKey"]);
  });
  it("keeps derived, reassigned and parameter settings reads under schema coverage", () => {
    expect(settingsReadKeys(`
      const settingsData = { ...await getSettings() };
      settingsData.missingDerivedKey;
      function fromAlias() {
        const stored = getSettingsSync();
        const settings = { ...stored };
        return settings.missingAliasedKey;
      }
      function read(settings) { return settings.missingParameterKey; }
      function reassigned() {
        let settings = {};
        settings = getSettingsSync();
        return settings.missingReassignedKey;
      }
    `)).toEqual(["missingDerivedKey", "missingAliasedKey", "missingParameterKey", "missingReassignedKey"]);
  });

  it("covers static settings reads and literal API patch bodies", () => {
    const missing = [];
    for (const path of ["src", "open-sse", "cli/src"].flatMap((dir) => files(resolve(root, dir)))) {
      const source = readFileSync(path, "utf8");
      const keys = settingsReadKeys(source);
      for (const match of source.matchAll(/(?:const|let)\s*(\{[^{}]*\})\s*=\s*(?:await\s+)?getSettings(?:Sync)?\s*\(/g)) {
        keys.push(...literalKeys(match[1], 0));
      }
      const payloads = /(?:fetch|requestJSON)\(\s*["']\/api\/settings["'][\s\S]{0,300}?method:\s*["'](?:PATCH|POST)["'][\s\S]{0,300}?JSON\.stringify\(\s*(?=\{)|\b(?:patchSettings|updateSettings)\(\s*(?=\{)/g;
      for (const match of source.matchAll(payloads)) keys.push(...literalKeys(source, match.index + match[0].length));
      for (const key of keys) if (!Object.hasOwn(SETTINGS_SCHEMA, key) && !Object.hasOwn(allowlist, key)) missing.push(`${relative(root, path)}: ${key}`);
    }
    expect(missing).toEqual([]);
  });
  it("accepts the Claude naming toggle and provider thinking map", async () => {
    expect(validateSettingsPatch({ ccFilterNaming: true, providerThinking: { openai: { mode: "off" } } })).toEqual([]);
    expect(validateSettingsPatch({ ccFilterNaming: "true", providerThinking: [] })).toEqual(["ccFilterNaming", "providerThinking"]);
    mocks.getSettings.mockResolvedValue({});
    mocks.updateSettings.mockImplementation(async (patch) => patch);
    for (const patch of [{ ccFilterNaming: true }, { providerThinking: { openai: { mode: "off" } } }]) {
      const response = await PATCH(new Request("http://localhost/api/settings", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
      }));
      expect(response.status).toBe(200);
      expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining(patch));
    }
  });
});
