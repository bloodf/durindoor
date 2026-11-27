import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));

import { clearKiroModelCache, resolveKiroModels } from "open-sse/services/catalogs/kiroModels.js";
import { effectiveSyncedModels, mergeSyncedCatalog, normalizeSyncedModels } from "@/lib/modelAutoSync/catalog.js";

describe("Kiro discovery context limits", () => {
  beforeEach(() => {
    clearKiroModelCache();
    mocks.fetch.mockReset();
  });

  it("only persists valid discovered limits and preserves catalog capabilities", async () => {
    const limits = [undefined, 0, -1, "invalid", Infinity, -Infinity, 1000000, "128000"];
    const fixtures = limits.map((limit, index) => ({
      modelId: `test-model-${index}`,
      ...(limit === undefined ? {} : { tokenLimits: { maxInputTokens: limit } }),
    }));
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ models: fixtures }) });
    const result = await resolveKiroModels({ accessToken: "offline-fixture" }, { forceRefresh: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    for (let index = 0; index < limits.length; index++) {
      const variants = result.models.filter((model) => model.upstreamModelId === `test-model-${index}`);
      expect(variants).toHaveLength(4);
      for (const variant of variants) {
        if (index < 6) expect(variant).not.toHaveProperty("contextLength");
        else expect(variant.contextLength).toBe(Number(limits[index]));
      }
    }

    // The resolver's mapped rows go through these same helpers before the
    // runner saves the catalog; JSON models the stored representation.
    const mapped = result.models.map((m) => ({ id: m.id, name: m.name, contextLength: m.contextLength }));
    const normalized = normalizeSyncedModels(mapped);
    const stored = JSON.parse(JSON.stringify(mergeSyncedCatalog(null, normalized, { now: 1 })));
    expect(stored.models.find((m) => m.id === "test-model-0")).not.toHaveProperty("capabilities.contextWindow");
    expect(stored.models.find((m) => m.id === "test-model-6").capabilities.contextWindow).toBe(1000000);
    const shared = { providers: { kiro: { "test-model-0": { contextWindow: 750000 } } } };
    const effective = effectiveSyncedModels(stored, [], "kiro", shared);
    expect(effective.find((m) => m.id === "test-model-0").capabilities.contextWindow).toBe(750000);
  });
});
