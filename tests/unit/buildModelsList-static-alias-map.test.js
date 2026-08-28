import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn().mockResolvedValue({ hidePaidModels: false }),
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));

import * as localDb from "@/lib/localDb";
import * as disabledModelsDb from "@/lib/disabledModelsDb";

function stubEmpty(connections = [], combos = [], customModels = []) {
  localDb.getProviderConnections.mockResolvedValue(connections);
  localDb.getCombos.mockResolvedValue(combos);
  localDb.getCustomModels.mockResolvedValue(customModels);
  localDb.getModelAliases.mockResolvedValue({});
  disabledModelsDb.getDisabledModels.mockResolvedValue({});
}

describe("buildModelsList — static alias-to-provider mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("keeps static alias caps when a custom prefix is configured", async () => {
    stubEmpty(
      [
        {
          id: "conn-cbcn",
          provider: "codebuddy-cn",
          isActive: true,
          apiKey: "sk-test",
          providerSpecificData: { prefix: "mycodebuddy" },
        },
      ],
      [
        {
          name: "codebuddy-combo",
          models: ["cbcn/glm-5.2"],
        },
      ],
    );

    const models = await buildModelsList([LLM_KIND]);
    const combo = models.find((m) => m.id === "codebuddy-combo");
    expect(combo).toBeDefined();
    // CodeBuddy-cn specific override (1M context, 48k output), not generic GLM.
    expect(combo.capabilities.contextWindow).toBe(1000000);
    expect(combo.capabilities.maxOutput).toBe(48000);
    expect(combo.context_length).toBe(1000000);
    expect(combo.max_completion_tokens).toBe(48000);
  });

  it("uses custom prefix caps while preserving the static alias", async () => {
    stubEmpty(
      [
        {
          id: "conn-cbcn",
          provider: "codebuddy-cn",
          isActive: true,
          apiKey: "sk-test",
          providerSpecificData: { prefix: "mycodebuddy" },
        },
      ],
      [
        {
          name: "custom-prefix-combo",
          models: ["mycodebuddy/glm-5.2"],
        },
      ],
    );

    const models = await buildModelsList([LLM_KIND]);
    const combo = models.find((m) => m.id === "custom-prefix-combo");
    expect(combo).toBeDefined();
    expect(combo.capabilities.contextWindow).toBe(1000000);
    expect(combo.capabilities.maxOutput).toBe(48000);
    expect(combo.context_length).toBe(1000000);
    expect(combo.max_completion_tokens).toBe(48000);
  });

  it("falls back to static alias caps when there are no active connections", async () => {
    stubEmpty([], [
      {
        name: "static-combo",
        models: ["cbcn/glm-5.2"],
      },
    ]);

    const models = await buildModelsList([LLM_KIND]);
    const combo = models.find((m) => m.id === "static-combo");
    expect(combo).toBeDefined();
    expect(combo.capabilities.contextWindow).toBe(1000000);
    expect(combo.capabilities.maxOutput).toBe(48000);
    expect(combo.context_length).toBe(1000000);
    expect(combo.max_completion_tokens).toBe(48000);
    // Upstream #3267: a healthy DB with zero connections no longer publishes
    // built-in rows; combo aggregation still resolves their static metadata.
    expect(models.find((m) => m.id === "cbcn/glm-5.2")).toBeUndefined();
  });

  it("publishes member-safe limits for nested combos", async () => {
    stubEmpty([], [
      { name: "inner-combo", models: ["wide/model"] },
      { name: "outer-combo", models: ["inner-combo", "narrow/model"] },
    ], [
      { id: "model", providerAlias: "wide", capabilities: { contextWindow: 1_000_000, maxOutput: 128_000 } },
      { id: "model", providerAlias: "narrow", capabilities: { contextWindow: 128_000, maxOutput: 32_000 } },
    ]);

    const models = await buildModelsList([LLM_KIND]);
    const combo = models.find((model) => model.id === "outer-combo");

    expect(combo.capabilities).toMatchObject({ contextWindow: 128_000, maxOutput: 32_000 });
    expect(combo.context_length).toBe(128_000);
    expect(combo.max_completion_tokens).toBe(32_000);
  });

  it("omits a flat output ceiling when combo members publish none", async () => {
    stubEmpty([], [{ name: "unknown-output-combo", models: ["kimi/kimi-k2.6"] }]);

    const models = await buildModelsList([LLM_KIND]);
    const combo = models.find((model) => model.id === "unknown-output-combo");

    expect(combo.context_length).toBe(262_144);
    expect(combo.max_completion_tokens).toBeUndefined();
  });

  it("skips unknown member floors and omits all-unknown combo limits", async () => {
    stubEmpty([], [
      { name: "mixed-known-combo", models: ["cbcn/glm-5.2", "unknown/no-catalog-row"] },
      { name: "gpt-5.6-sol", models: ["unknown/no-catalog-row"] },
    ]);

    const models = await buildModelsList([LLM_KIND]);
    const mixed = models.find((model) => model.id === "mixed-known-combo");
    const unknown = models.find((model) => model.id === "gpt-5.6-sol");

    expect(mixed).toMatchObject({ context_length: 1_000_000, max_completion_tokens: 48_000 });
    expect(unknown.context_length).toBeUndefined();
    expect(unknown.max_completion_tokens).toBeUndefined();
  });

  it("does not invent output limits for context-only custom members", async () => {
    stubEmpty([], [{ name: "context-only-combo", models: ["custom/context-only"] }], [
      { id: "context-only", providerAlias: "custom", capabilities: { contextWindow: 1_000_000 } },
    ]);

    const models = await buildModelsList([LLM_KIND]);
    const combo = models.find((model) => model.id === "context-only-combo");

    expect(combo.context_length).toBe(1_000_000);
    expect(combo.max_completion_tokens).toBeUndefined();
  });

  it.each(["webSearch", "webFetch"])("keeps %s combos free of LLM limit fields", async (kind) => {
    stubEmpty([], [{ name: `${kind}-combo`, kind, models: ["cbcn/glm-5.2"] }]);

    const models = await buildModelsList([kind]);
    const combo = models.find((model) => model.id === `${kind}-combo`);

    expect(combo).toEqual({ id: `${kind}-combo`, object: "model", owned_by: "combo", kind });
  });
});
