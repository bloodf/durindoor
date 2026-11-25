import { describe, expect, it, vi } from "vitest";
import {
  OPENCODE_GO_DEEPSEEK_EFFORT_TIERS,
  getOpencodeGoEffortTiers,
  getThinkingLevels,
} from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

// Model-scoped effort tiers for OpenCode Go, as declared by the OmniRoute
// provider catalog at upstream commit 2b14379604d466005bb18640a898c2811757ef67
// (#20436 / PR #20465):
//   deepseek-v4-pro / deepseek-v4-flash / deepseek-v4-flash-vision-exp
//     -> none | low | high | max
//   deepseek-v4.1-flash / deepseek-flash (the 1M DeepSeek V4.1 Flash)
//     -> low | high | max
const DECLARED = OPENCODE_GO_DEEPSEEK_EFFORT_TIERS;

// The OpenCode Go provider id and its `ocg` alias resolve the same rows.
const GO_PROVIDERS = ["opencode-go", "ocg"];

// Rows the OpenCode Go registry serves statically. The two V4.1 Flash ids are
// discovered from the live catalog, so they are covered through the shared
// declaration and the request path.
const SERVED_ROWS = ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"];

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getSyncedModelCatalogs: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/buildModelsList.js");

/** Normalized OpenAI-lane request body for one requested effort tier. */
function normalize(provider, model, effort) {
  const body = { model, messages: [{ role: "user", content: "hi" }], reasoning_effort: effort };
  applyThinking("openai", model, body, provider);
  return body;
}

async function catalogEntries(providerId, modelIds) {
  db.getProviderConnections.mockResolvedValue([{
    id: 1,
    provider: providerId,
    isActive: true,
    providerSpecificData: { enabledModels: modelIds },
  }]);
  const models = await buildModelsList(["llm"]);
  return models.filter((model) => modelIds.some((id) => model.id.endsWith(`/${id}`)));
}

describe("OpenCode Go DeepSeek effort tiers — catalog output", () => {
  it("advertises the declared tiers for every served OpenCode Go DeepSeek row", async () => {
    const entries = await catalogEntries("opencode-go", SERVED_ROWS);
    expect(entries.map((entry) => entry.id).sort()).toEqual(
      SERVED_ROWS.map((id) => `ocg/${id}`).sort(),
    );
    for (const entry of entries) {
      const modelId = entry.id.slice(entry.id.indexOf("/") + 1);
      expect(entry.thinking_levels, modelId).toEqual(DECLARED[modelId]);
      expect(entry.thinking_levels, modelId).toEqual(getThinkingLevels("opencode-go", modelId));
    }
  });

  it("advertises the declared tiers for the dynamically discovered V4.1 Flash ids", () => {
    for (const modelId of ["deepseek-v4.1-flash", "deepseek-flash"]) {
      expect(getThinkingLevels("opencode-go", modelId), modelId).toEqual(DECLARED[modelId]);
      expect(getThinkingLevels("ocg", modelId), modelId).toEqual(DECLARED[modelId]);
      expect(getOpencodeGoEffortTiers("opencode-go", modelId), modelId).toEqual(DECLARED[modelId]);
    }
  });

  it("keeps the catalog free of tiers the model does not declare", () => {
    for (const provider of GO_PROVIDERS) {
      for (const [modelId, tiers] of Object.entries(DECLARED)) {
        const levels = getThinkingLevels(provider, modelId);
        expect(levels, `${provider}/${modelId}`).toEqual(tiers);
        for (const tier of tiers) expect(levels, `${provider}/${modelId}`).toContain(tier);
        // "none" is only offered where the model can switch thinking off.
        expect(levels.includes("none"), `${provider}/${modelId}`).toBe(tiers.includes("none"));
      }
    }
  });
});

describe("OpenCode Go DeepSeek effort tiers — accepted tiers reach the wire", () => {
  it("forwards every declared tier verbatim", () => {
    for (const provider of GO_PROVIDERS) {
      for (const [modelId, tiers] of Object.entries(DECLARED)) {
        for (const tier of tiers) {
          const body = normalize(provider, modelId, tier);
          expect(body.reasoning_effort, `${provider}/${modelId} ${tier}`).toBe(tier);
          expect(body.thinking, `${provider}/${modelId} ${tier}`).toEqual({
            type: tier === "none" ? "disabled" : "enabled",
          });
        }
      }
    }
  });

  it("keeps the native DeepSeek V4 'max' tier on the OpenCode Go rows", () => {
    for (const modelId of ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
      expect(normalize("opencode-go", modelId, "max").reasoning_effort).toBe("max");
      expect(normalize("opencode-go", modelId, "low").reasoning_effort).toBe("low");
    }
  });

  it("carries the same tier on the Claude Messages and Responses lanes", () => {
    const model = "deepseek-v4-flash-vision-exp";
    for (const tier of ["low", "high", "max"]) {
      const claude = { model, messages: [], reasoning_effort: tier };
      applyThinking("claude", model, claude, "opencode-go");
      expect(claude.output_config?.effort, `claude ${tier}`).toBe(tier);

      const responses = { model, messages: [], reasoning_effort: tier };
      applyThinking("openai-responses", model, responses, "opencode-go");
      expect(responses.reasoning?.effort, `responses ${tier}`).toBe(tier);
    }
  });
});

describe("OpenCode Go DeepSeek effort tiers — rejected tiers never reach the wire", () => {
  it("folds an undeclared tier onto the nearest declared rung", () => {
    // (requested tier, tier the OpenCode Go rows must send)
    const rejected = [
      ["minimal", "low"],
      ["medium", "high"],
      ["xhigh", "max"],
      ["ultra", "max"],
    ];
    for (const provider of GO_PROVIDERS) {
      for (const [modelId, tiers] of Object.entries(DECLARED)) {
        for (const [requested, expected] of rejected) {
          const body = normalize(provider, modelId, requested);
          expect(body.reasoning_effort, `${provider}/${modelId} ${requested}`).toBe(expected);
          expect(tiers, `${provider}/${modelId} ${requested}`).toContain(body.reasoning_effort);
        }
      }
    }
  });

  it("never sends a tier outside the declared set", () => {
    for (const provider of GO_PROVIDERS) {
      for (const [modelId, tiers] of Object.entries(DECLARED)) {
        for (const requested of ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "auto"]) {
          const body = normalize(provider, modelId, requested);
          expect(tiers, `${provider}/${modelId} ${requested}`).toContain(body.reasoning_effort);
        }
      }
    }
  });

  it("keeps thinking on for a model that declares no disable tier", () => {
    for (const modelId of ["deepseek-v4.1-flash", "deepseek-flash"]) {
      const body = normalize("opencode-go", modelId, "none");
      expect(body.reasoning_effort).toBe("low");
      expect(body.thinking).toEqual({ type: "enabled" });
    }
  });
});

describe("OpenCode Go DeepSeek effort tiers — other providers are untouched", () => {
  it("keeps the native DeepSeek provider on its own effort contract", () => {
    expect(getThinkingLevels("deepseek", "deepseek-v4-pro")).toEqual(["none", "high", "max"]);
    expect(getThinkingLevels("deepseek", "deepseek-v4.1-flash")).toEqual(
      ["none", "low", "medium", "high", "xhigh", "max"],
    );
    // The native DeepSeek wire still collapses "low" to "high" and keeps "max".
    expect(normalize("deepseek", "deepseek-v4-pro", "low").reasoning_effort).toBe("high");
    expect(normalize("deepseek", "deepseek-v4-pro", "max").reasoning_effort).toBe("max");
    expect(normalize("deepseek", "deepseek-v4.1-flash", "max").reasoning_effort).toBe("high");
  });

  it("keeps the OpenCode free lane on its own effort contract", () => {
    expect(getThinkingLevels("opencode", "deepseek-v4.1-flash-free")).toEqual(["low", "high", "max"]);
    expect(normalize("opencode", "deepseek-v4.1-flash-free", "low").reasoning_effort).toBe("low");
    expect(normalize("opencode", "deepseek-v4.1-flash-free", "medium").reasoning_effort).toBe("medium");
    expect(normalize("opencode", "deepseek-v4.1-flash-free", "max").reasoning_effort).toBe("max");
  });

  it("does not leak the OpenCode Go tiers onto another gateway serving the same id", () => {
    expect(getOpencodeGoEffortTiers("deepseek", "deepseek-v4-pro")).toBeNull();
    expect(getOpencodeGoEffortTiers("opencode-zen", "deepseek-v4-flash")).toBeNull();
    expect(getThinkingLevels("codebuddy-cn", "deepseek-v4.1-flash")).toEqual(["low", "high", "max"]);
    expect(normalize("codebuddy-cn", "deepseek-v4.1-flash", "xhigh").reasoning_effort).toBe("high");
  });
});
