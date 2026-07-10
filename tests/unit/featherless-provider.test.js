import { describe, expect, it } from "vitest";
import featherless from "../../open-sse/providers/registry/featherless-ai.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

// Upstream 9router 0d4d4bc26 — featherless OpenAI-compatible presets.
// We fold the preset catalog into the existing `featherless-ai` entry
// (keeping its dynamic fetcher + passthrough + openai thinkingFormat)
// instead of adding a colliding `id:"featherless"` provider.
const UPSTREAM_PRESET_IDS = [
  "deepseek-ai/DeepSeek-V4-Pro",
  "deepseek-ai/DeepSeek-V4-Flash",
  "zai-org/GLM-5.2",
  "zai-org/GLM-5.1",
  "moonshotai/Kimi-K2.7-Code",
  "moonshotai/Kimi-K2.6",
  "moonshotai/Kimi-K2.5",
];

describe("Featherless provider presets (upstream 0d4d4bc26)", () => {
  it("registers all seven upstream preset model ids", () => {
    const ids = featherless.models.map((m) => m.id);
    for (const preset of UPSTREAM_PRESET_IDS) {
      expect(ids).toContain(preset);
    }
  });

  it("exposes presets through PROVIDER_MODELS under the featherless alias", () => {
    const catalog = PROVIDER_MODELS.featherless;
    expect(Array.isArray(catalog)).toBe(true);
    const ids = catalog.map((m) => m.id);
    for (const preset of UPSTREAM_PRESET_IDS) {
      expect(ids).toContain(preset);
    }
  });

  it("registers exactly one Featherless endpoint entry (no alias collision)", () => {
    const featherlessEntries = REGISTRY.filter(
      (e) => e.id === "featherless-ai" || e.id === "featherless" || e.alias === "featherless",
    );
    expect(featherlessEntries).toHaveLength(1);
    expect(featherlessEntries[0].id).toBe("featherless-ai");
  });

  it("resolves the fl short alias and the bare featherless alias to featherless-ai", () => {
    expect(resolveProviderAlias("fl")).toBe("featherless-ai");
    expect(resolveProviderAlias("featherless")).toBe("featherless-ai");
    expect(featherless.uiAlias).toBe("fl");
    expect(featherless.aliases).toContain("fl");
  });

  it("keeps the OpenAI-compatible transport, dynamic fetcher, passthrough and thinking format", () => {
    expect(featherless.transport.baseUrl).toBe("https://api.featherless.ai/v1/chat/completions");
    expect(featherless.transport.validateUrl).toBe("https://api.featherless.ai/v1/models");
    expect(featherless.transport.thinkingFormat).toBe("openai");
    expect(featherless.modelsFetcher).toEqual({
      url: "https://api.featherless.ai/v1/models",
      type: "openai",
    });
    expect(featherless.passthroughModels).toBe(true);
  });
});
