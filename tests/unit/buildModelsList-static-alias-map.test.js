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

function stubEmpty(connections = [], combos = []) {
  localDb.getProviderConnections.mockResolvedValue(connections);
  localDb.getCombos.mockResolvedValue(combos);
  localDb.getCustomModels.mockResolvedValue([]);
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
    // Upstream #3267: a healthy DB with zero connections no longer publishes
    // built-in rows; combo aggregation still resolves their static metadata.
    expect(models.find((m) => m.id === "cbcn/glm-5.2")).toBeUndefined();
  });
});
