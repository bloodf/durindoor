import { beforeEach, describe, expect, it, vi } from "vitest";

// #1363: /v1/models lists claude-haiku-5-5 with its documented default effort and flags the
// legacy Haiku 4.5 rows as deprecated (kept in the catalog, never removed).
const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: mocks.getSettings }));

const project = (m) => ({
  id: m.id,
  name: m.name,
  deprecated: m.deprecated,
  defaultEffort: m.capabilities?.defaultEffort,
  thinkingFormat: m.capabilities?.thinkingFormat,
  contextWindow: m.capabilities?.contextWindow,
  maxOutput: m.capabilities?.maxOutput,
});

describe("/v1/models Claude Haiku catalog (#1363)", () => {
  let models;
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getSettings.mockResolvedValue({ disabledFreeProviders: [], hidePaidModels: false });
    mocks.getProviderConnections.mockResolvedValue([
      { id: "a1", provider: "anthropic", isActive: true, authType: "apikey", apiKey: "sk-ant-test" },
      { id: "c1", provider: "claude", isActive: true, authType: "oauth", accessToken: "tok" },
    ]);
    const { buildModelsList } = await import("../../src/app/api/v1/models/buildModelsList.js");
    models = await buildModelsList(["llm"]);
  }, 60000);

  it.each(["anthropic/claude-haiku-5-5", "cc/claude-haiku-5-5"])("%s is current with medium default effort", (id) => {
    const row = models.find((m) => m.id === id);
    expect(row, id).toBeTruthy();
    expect(project(row)).toEqual({
      id,
      name: "Claude Haiku 5.5",
      deprecated: undefined,
      defaultEffort: "medium",
      thinkingFormat: "claude-adaptive",
      contextWindow: 1000000,
      maxOutput: 128000,
    });
  });

  // Marked legacy on platform.claude.com/docs/en/models/overview ("Legacy models (still available)")
  // or Deprecated in the lifecycle table of .../about-claude/model-deprecations.
  const LEGACY = {
    anthropic: [
      "claude-fable-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
      "claude-opus-4-5-20251101", "claude-opus-4-5", "claude-sonnet-5", "claude-sonnet-4-6",
      "claude-sonnet-4-5-20250929", "claude-sonnet-4-5", "claude-mythos-preview",
      "claude-haiku-4-5-20251001", "claude-haiku-4-5",
    ],
    cc: ["claude-fable-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
  };
  // Active per both pages: never flagged.
  const CURRENT = {
    anthropic: ["claude-fable-5-1", "claude-mythos-5-1", "claude-mythos-5", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    cc: ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  };

  it.each(Object.entries(LEGACY).flatMap(([p, ids]) => ids.map((id) => `${p}/${id}`)))(
    "%s stays listed and is flagged deprecated",
    (id) => {
      const row = models.find((m) => m.id === id);
      expect(row, id).toBeTruthy();
      expect(row.deprecated).toBe(true);
    },
  );

  it.each(Object.entries(CURRENT).flatMap(([p, ids]) => ids.map((id) => `${p}/${id}`)))(
    "%s is listed and not flagged",
    (id) => {
      const row = models.find((m) => m.id === id);
      expect(row, id).toBeTruthy();
      expect(row.deprecated).toBeUndefined();
    },
  );
});
