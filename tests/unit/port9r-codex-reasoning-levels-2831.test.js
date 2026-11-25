import { expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => [{ id: "codex-test", provider: "codex", isActive: true }]),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => []),
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("../../open-sse/services/usage/codex.js", () => ({ getCodexModels: vi.fn(async () => null) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({})) }));

import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";

it("advertises only the resolved Codex model effort levels", async () => {
  const models = await buildModelsList([LLM_KIND]);
  const codex = models.find((model) => model.owned_by === "cx" && model.id.includes("codex") && model.thinking_levels?.length);
  expect(codex).toBeDefined();
  expect(codex.supported_reasoning_levels.map((level) => level.effort)).toEqual(codex.thinking_levels);
  expect(codex.supported_reasoning_levels).toContainEqual({ effort: "xhigh", description: "Extra High" });
  expect(codex.supported_reasoning_levels.map((level) => level.effort)).not.toContain("ultra");
});
