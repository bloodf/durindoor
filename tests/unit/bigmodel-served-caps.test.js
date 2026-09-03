import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => [{
    id: "bigmodel-connection",
    provider: "bigmodel",
    authType: "apikey",
    apiKey: "key",
    isActive: true,
    testStatus: "active",
    priority: 1,
  }]),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => []),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));

import { LLM_KIND, buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";

describe("served BigModel catalog", () => {
  it("publishes BigModel's 131072-token output ceiling instead of the generic 64000", async () => {
    const models = await buildModelsList([LLM_KIND]);
    const glm53 = models.find((candidate) => candidate.id === "bigmodel/glm-5.3");
    const glm53Flash = models.find((candidate) => candidate.id === "bigmodel/glm-5.3-flash");
    expect(glm53).toBeDefined();
    expect(glm53Flash).toBeDefined();
    // Row-defined exact limits, not the generic DEFAULT_CAPABILITIES.maxOutput floor.
    expect(glm53.capabilities.maxOutput).toBe(131_072);
    expect(glm53.max_completion_tokens).toBe(131_072);
    expect(glm53Flash.capabilities.maxOutput).toBe(131_072);
    expect(glm53Flash.max_completion_tokens).toBe(131_072);
  });
});
