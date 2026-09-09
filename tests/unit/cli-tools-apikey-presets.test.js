import { beforeEach, describe, expect, it } from "vitest";
import {
  readKeyPresets,
  upsertKeyPreset,
  deleteKeyPreset,
  subscribeKeyPresets,
  maskApiKey,
  formatKeyPresetLabel,
} from "../../src/app/(dashboard)/dashboard/cli-tools/components/cliEndpointPresets.js";

// Stubs the browser surface (localStorage + storage-change event) used by the
// API key preset store ported from upstream c24a8542.
function stubBrowser() {
  const values = new Map();
  const listeners = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
    addEventListener: (event, handler) => {
      listeners.set(event, [...(listeners.get(event) || []), handler]);
    },
    removeEventListener: (event, handler) => {
      listeners.set(event, (listeners.get(event) || []).filter((h) => h !== handler));
    },
    dispatchEvent: (event) => {
      (listeners.get(event.type) || []).forEach((handler) => handler(event));
      return true;
    },
  };
  return values;
}

describe("CLI tool API key presets (upstream c24a8542)", () => {
  let storage;

  beforeEach(() => {
    storage = stubBrowser();
  });

  it("returns an empty list when storage is empty or malformed", () => {
    expect(readKeyPresets()).toEqual([]);
    storage.set("durindoor.cliToolApiKeyPresets", "not-json");
    expect(readKeyPresets()).toEqual([]);
    storage.set("durindoor.cliToolApiKeyPresets", JSON.stringify([{ name: "noKey" }, { key: "sk-noName" }, null]));
    expect(readKeyPresets()).toEqual([]);
  });

  it("saves a preset under an explicit name and reads it back sorted", () => {
    expect(upsertKeyPreset("sk-beta-key", "Beta")).toBe("Beta");
    expect(upsertKeyPreset("sk-alpha-key", "Alpha")).toBe("Alpha");
    expect(readKeyPresets()).toEqual([
      { name: "Alpha", key: "sk-alpha-key" },
      { name: "Beta", key: "sk-beta-key" },
    ]);
  });

  it("reuses the existing name when the same key is saved again without a name", () => {
    upsertKeyPreset("sk-same-key", "Work");
    expect(upsertKeyPreset("sk-same-key")).toBe("Work");
    expect(readKeyPresets()).toHaveLength(1);
  });

  it("replaces an existing preset on name or key collision", () => {
    upsertKeyPreset("sk-old-key", "Main");
    upsertKeyPreset("sk-new-key", "Main");
    expect(readKeyPresets()).toEqual([{ name: "Main", key: "sk-new-key" }]);
    upsertKeyPreset("sk-new-key", "Renamed");
    expect(readKeyPresets()).toEqual([{ name: "Renamed", key: "sk-new-key" }]);
  });

  it("skips empty keys and blank names", () => {
    expect(upsertKeyPreset("")).toBeNull();
    expect(upsertKeyPreset("   ", "Trimmed-away")).toBe("Trimmed-away"); // keys are stored verbatim (no URL normalization)
    expect(upsertKeyPreset("sk-key", "   ")).toBeNull();
    expect(readKeyPresets()).toEqual([{ name: "Trimmed-away", key: "   " }]);
  });

  it("deletes a preset by name and notifies subscribers on writes", () => {
    const seen = [];
    const unsubscribe = subscribeKeyPresets(() => seen.push(readKeyPresets().length));
    upsertKeyPreset("sk-one", "One");
    upsertKeyPreset("sk-two", "Two");
    deleteKeyPreset("One");
    expect(seen).toEqual([1, 2, 1]);
    expect(readKeyPresets()).toEqual([{ name: "Two", key: "sk-two" }]);
    unsubscribe();
    deleteKeyPreset("Two");
    expect(seen).toEqual([1, 2, 1]);
  });

  it("masks saved secrets in labels", () => {
    expect(maskApiKey("")).toBe("");
    expect(maskApiKey("sk-short")).toBe("sk-s…rt");
    expect(maskApiKey("sk-machine-keyId-crc8-long")).toBe("sk-machi…long");
    expect(formatKeyPresetLabel({ name: "Work", key: "sk-machine-keyId-crc8-long" })).toBe("Work (sk-machi…long)");
  });

  it("gives legacy sk-<8 hex> keys distinct masked default names", () => {
    // Legacy keys are only 11 chars; the mask must include the tail so two
    // keys sharing their first hex digit do not collide on the default name.
    expect(maskApiKey("sk-a1b2c3d4")).toBe("sk-a…d4");
    expect(maskApiKey("sk-a9f8e7d6")).toBe("sk-a…d6");
    expect(maskApiKey("sk-a1b2c3d4")).not.toBe(maskApiKey("sk-a9f8e7d6"));
  });

  it("degrades to a no-op when localStorage.setItem throws", () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    global.window.localStorage = throwing;
    expect(() => upsertKeyPreset("sk-key", "Name")).not.toThrow();
    expect(() => deleteKeyPreset("Name")).not.toThrow();
    expect(readKeyPresets()).toEqual([]);
  });
});
