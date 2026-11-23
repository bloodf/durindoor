import { describe, expect, it, vi } from "vitest";
import { PROVIDER_MODELS_CONFIG } from "../../src/app/api/providers/[id]/models/modelsConfig.js";
import { loadLiveAntigravityModels } from "../../src/app/(dashboard)/dashboard/providers/[id]/liveAntigravityModels.js";

describe("Antigravity account catalog", () => {
  it("uses the Hub identity and parses public models with their capabilities", () => {
    const config = PROVIDER_MODELS_CONFIG.antigravity;
    expect(config.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels");
    expect(config.method).toBe("POST");
    expect(config.headers).toMatchObject({ "User-Agent": "antigravity/hub/2.33.0 darwin/arm64", "X-Client-Name": "antigravity", "X-Client-Version": "2.33.0" });
    expect(config.parseResponse({ models: {
      alpha: { displayName: "Alpha", maxTokens: 100, maxOutputTokens: 20, supportsImages: true, supportsThinking: true },
      internal: { isInternal: true }, "foo-disabled": {}, tab_test: {}, beta: {}
    } })).toEqual([
      { id: "alpha", name: "Alpha", contextLength: 100, maxOutputTokens: 20, supportsVision: true, supportsReasoning: true },
      { id: "beta", name: "beta", contextLength: undefined, maxOutputTokens: undefined, supportsVision: false, supportsReasoning: false }
    ]);
  });

  it("merges active account catalogs, deduplicates, and falls back on failure", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes("bad")) return { ok: false };
      return { ok: true, json: async () => ({ models: url.includes("one") ? [{ id: "a" }, { id: "shared" }] : [{ id: "shared" }, { id: "b" }] }) };
    });
    const connections = [{ id: "one" }, { id: "two" }, { id: "bad" }, { id: "off", isActive: false }];
    expect(await loadLiveAntigravityModels(connections, { fetchImpl })).toEqual([{ id: "a" }, { id: "shared" }, { id: "b" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(await loadLiveAntigravityModels([{ id: "bad" }], { fetchImpl })).toBeNull();
    expect(await loadLiveAntigravityModels([], { fetchImpl })).toBeNull();
  });
});
