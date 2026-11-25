import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ updateSettings: vi.fn(), getSettings: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, updateSettings: mocks.updateSettings }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn(), resetComboScoring: vi.fn() }));
vi.mock("@/lib/settings/settingsPatchAuth", async (importOriginal) => ({
  ...await importOriginal(), canModifySecurityCriticalSettings: vi.fn(async () => true),
}));
import {
  AUTH_CRITICAL_SETTING_KEYS,
  DEFAULT_SETTINGS_SCHEMA,
  REDACT_ON_GET_SETTING_KEYS,
  SCOPED_SETTING_KEYS,
  SECRET_SETTING_KEYS,
  SETTINGS_SCHEMA,
  validateSettingsPatch,
} from "../../src/lib/settings/settingsSchema.js";
import { mergeSettingsPatch } from "../../src/lib/db/repos/settingsRepo.js";
import useSettingsStore from "../../src/store/settingsStore.js";
import { PATCH } from "../../src/app/api/settings/route.js";

describe("settings schema regression (#2306)", () => {
  it("pins the existing authority, scope, and redaction lists", () => {
    expect([...SECRET_SETTING_KEYS].sort()).toEqual([
      "password", "passwordSessionEpoch", "mitmSudoEncrypted", "postgresUrl",
      "mfaEnabled", "mfaSecret", "mfaBackupCodes", "operatorWebhooks", "openrouterRouting",
    ].sort());
    expect([...AUTH_CRITICAL_SETTING_KEYS].sort()).toEqual([
      "comboPrompts", "exposeComboOnly", "requireLogin", "requireApiKey", "authMode", "ssoType",
      "oidcIssuerUrl", "oidcClientId", "oidcClientSecret", "oidcScopes", "oidcLoginLabel",
      "oidcAllowedSubjects", "oidcAllowedEmails", "oidcAllowedDomains", "tunnelDashboardAccess",
      "enableObservability", "logToolSources", "enableSessionCapture", "outboundProxyEnabled", "outboundProxyUrl",
      "outboundNoProxy", "headroomEnabled", "headroomUrl", "headroomCompressUserMessages",
      "mitmRouterBaseUrl", "claudeClassifierCompat", "lanDiscoveryEnabled",
    ].sort());
    expect([...SCOPED_SETTING_KEYS].sort()).toEqual(["claudeAutoPing", "codexAutoPing"].sort());
    expect([...REDACT_ON_GET_SETTING_KEYS].sort()).toEqual([
      "password", "passwordSessionEpoch", "oidcClientSecret", "mitmSudoEncrypted", "postgresUrl",
      "mfaSecret", "mfaBackupCodes", "operatorWebhooks", "openrouterRouting",
    ].sort());
  });

  it("rejects unknown keys and wrong primitive types and exposes defaults", () => {
    expect(validateSettingsPatch({ totallyBogus: { a: 1 }, stickyRoundRobinLimit: "abc" })).toEqual([
      "totallyBogus", "stickyRoundRobinLimit",
    ]);
    expect(SETTINGS_SCHEMA.comboStrategies.merge).toBe("keys");
    expect(DEFAULT_SETTINGS_SCHEMA.comboStrategies).toEqual({});
    expect(SETTINGS_SCHEMA.mfaSecret.secret).toBe(true);
    expect(SETTINGS_SCHEMA.mfaSecret.redactOnGet).toBe(true);
  });

  it("returns 400 with offending keys before persistence", async () => {
    const response = await PATCH(new Request("http://localhost/api/settings", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ totallyBogus: { a: 1 }, stickyRoundRobinLimit: "abc" }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid settings", keys: ["totallyBogus", "stickyRoundRobinLimit"] });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("merges object settings by nested key and deletes null entries", () => {
    const current = {
      comboStrategies: { alpha: { timeoutMs: 1000, fallbackStrategy: "fallback" }, beta: { timeoutMs: 2000 } },
      retryDelayByProvider: { openai: 20, claude: 30 },
    };
    const patch = {
      comboStrategies: { alpha: { timeoutMs: 1500 }, beta: null, gamma: { timeoutMs: 3000 } },
      retryDelayByProvider: { openai: null, codex: 15 },
    };
    expect(mergeSettingsPatch(current, patch)).toEqual({
      comboStrategies: { alpha: { timeoutMs: 1500, fallbackStrategy: "fallback" }, gamma: { timeoutMs: 3000 } },
      retryDelayByProvider: { claude: 30, codex: 15 },
    });
    expect(mergeSettingsPatch(current, { comboStrategies: {} }).comboStrategies).toEqual({});
  });

  it("keeps the server error body in the settings store", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Invalid settings", keys: ["bad"] }) })));
    useSettingsStore.setState({ error: null });
    await useSettingsStore.getState().patchSettings({ bad: true });
    expect(useSettingsStore.getState().error).toBe("Invalid settings");
    vi.unstubAllGlobals();
  });
});
