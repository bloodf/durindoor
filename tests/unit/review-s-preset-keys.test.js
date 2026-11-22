import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENDPOINT_PRESETS_STORAGE_KEY,
  buildEndpointPreset,
  migrateEndpointPresets,
  readEndpointPresets,
  resolveEndpointPresetSecret,
  sanitizeEndpointPreset,
  writeEndpointPresets,
} from "../../src/app/(dashboard)/dashboard/cli-tools/components/cliEndpointPresets.js";

// Stubs localStorage for endpoint-preset helpers (#2252).
function stubBrowser() {
  const values = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  };
  return values;
}

describe("CLI endpoint presets never persist raw API secrets (#2252)", () => {
  let storage;

  beforeEach(() => {
    storage = stubBrowser();
  });

  it("buildEndpointPreset stores apiKeyId + masked label for a known DurinDoor key, never apiKey", () => {
    const known = [{ id: "key-1", key: "sk-machine-keyId-crc8-long", maskedKey: "sk-••••••••" }];
    const preset = buildEndpointPreset(
      { name: "Prod", baseUrl: "https://router.example/v1", apiKey: "sk-machine-keyId-crc8-long" },
      known,
    );
    expect(preset).toEqual({
      name: "Prod",
      baseUrl: "https://router.example/v1",
      apiKeyId: "key-1",
      maskedLabel: "sk-••••••••",
    });
    expect(preset).not.toHaveProperty("apiKey");
    writeEndpointPresets([preset]);
    const raw = JSON.parse(storage.get(ENDPOINT_PRESETS_STORAGE_KEY));
    expect(raw).toEqual([preset]);
    expect(JSON.stringify(raw)).not.toContain("sk-machine-keyId-crc8-long");
  });

  it("buildEndpointPreset drops secrets that are not DurinDoor keys", () => {
    const preset = buildEndpointPreset(
      { name: "External", baseUrl: "https://other.example/v1", apiKey: "sk-foreign-provider-secret" },
      [{ id: "key-1", key: "sk-machine-keyId-crc8-long" }],
    );
    expect(preset).toEqual({
      name: "External",
      baseUrl: "https://other.example/v1",
      maskedLabel: expect.stringContaining("…"),
    });
    expect(preset).not.toHaveProperty("apiKey");
    expect(preset).not.toHaveProperty("apiKeyId");
    writeEndpointPresets([preset]);
    expect(JSON.stringify(JSON.parse(storage.get(ENDPOINT_PRESETS_STORAGE_KEY)))).not.toContain("sk-foreign-provider-secret");
  });

  it("migrateEndpointPresets strips legacy apiKey and maps matching secrets to apiKeyId", () => {
    const legacy = [
      { name: "Match", baseUrl: "https://a.example/v1", apiKey: "sk-known-secret-value" },
      { name: "Drop", baseUrl: "https://b.example/v1", apiKey: "sk-unknown-secret-value" },
      { name: "UrlOnly", baseUrl: "https://c.example/v1" },
    ];
    const known = [{ id: "id-match", key: "sk-known-secret-value", maskedKey: "sk-••••••••" }];
    const migrated = migrateEndpointPresets(legacy, known);
    expect(migrated).toEqual([
      { name: "Match", baseUrl: "https://a.example/v1", apiKeyId: "id-match", maskedLabel: "sk-••••••••" },
      { name: "Drop", baseUrl: "https://b.example/v1", maskedLabel: expect.any(String) },
      { name: "UrlOnly", baseUrl: "https://c.example/v1" },
    ]);
    expect(migrated.every((preset) => !Object.hasOwn(preset, "apiKey"))).toBe(true);
  });

  it("readEndpointPresets rewrites localStorage when legacy apiKey secrets are present", () => {
    storage.set(
      ENDPOINT_PRESETS_STORAGE_KEY,
      JSON.stringify([{ name: "Old", baseUrl: "https://old.example/v1", apiKey: "sk-legacy-plaintext" }]),
    );
    const presets = readEndpointPresets([{ id: "legacy-id", key: "sk-legacy-plaintext", maskedKey: "sk-••••••••" }]);
    expect(presets).toEqual([
      { name: "Old", baseUrl: "https://old.example/v1", apiKeyId: "legacy-id", maskedLabel: "sk-••••••••" },
    ]);
    const rewritten = JSON.parse(storage.get(ENDPOINT_PRESETS_STORAGE_KEY));
    expect(rewritten).toEqual(presets);
    expect(JSON.stringify(rewritten)).not.toContain("sk-legacy-plaintext");
  });

  it("sanitizeEndpointPreset never returns an apiKey field", () => {
    expect(sanitizeEndpointPreset({ name: "X", baseUrl: "https://x.test/v1", apiKey: "sk-abc" })).not.toHaveProperty("apiKey");
    expect(sanitizeEndpointPreset(null)).toBeNull();
    expect(sanitizeEndpointPreset({ name: "", baseUrl: "https://x.test/v1" })).toBeNull();
  });

  it("resolveEndpointPresetSecret reveals DurinDoor keys and clears non-DurinDoor presets", async () => {
    const reveal = vi.fn(async (id) => (id === "key-1" ? "sk-revealed-secret" : null));
    await expect(resolveEndpointPresetSecret({ apiKeyId: "key-1" }, { reveal })).resolves.toBe("sk-revealed-secret");
    await expect(resolveEndpointPresetSecret({ name: "External", baseUrl: "https://x.test/v1" }, { reveal })).resolves.toBe("");
    expect(reveal).toHaveBeenCalledTimes(1);
  });
});
