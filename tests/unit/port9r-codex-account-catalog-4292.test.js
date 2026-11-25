// Port of upstream 9router #4292: a Codex account's live catalog decides which
// chat models are listed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  getSettings: vi.fn(),
  getCodexModels: vi.fn(),
  getSyncedModelCatalogs: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getSyncedModelCatalogs: mocks.getSyncedModelCatalogs,
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("../../open-sse/services/usage/codex.js", () => ({ getCodexModels: mocks.getCodexModels }));

import { clearLiveModelLimitsCache } from "../../open-sse/services/liveModelLimits.js";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function connection(provider, overrides = {}) {
  return {
    id: `${provider}-connection`,
    provider,
    apiKey: `${provider}-key`,
    accessToken: `${provider}-token`,
    isActive: true,
    providerSpecificData: {},
    ...overrides,
  };
}

function model(models, id) {
  return models.find((entry) => entry.id === id);
}

beforeEach(() => {
  clearLiveModelLimitsCache();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.getCombos.mockResolvedValue([]);
  mocks.getCustomModels.mockResolvedValue([]);
  mocks.getModelAliases.mockResolvedValue({});
  mocks.getDisabledModels.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
  mocks.getCodexModels.mockResolvedValue([]);
  mocks.getSyncedModelCatalogs.mockResolvedValue({});
});

describe("upstream 9router #4292: account-scoped Codex model listing", () => {
  const ids = async (kinds) => (await buildModelsList(kinds)).map((entry) => entry.id);

  it("does not advertise static chat models absent from the account catalog", async () => {
    mocks.getCodexModels.mockResolvedValue([{ slug: "gpt-5.6-sol" }]);
    mocks.getProviderConnections.mockResolvedValue([connection("codex")]);

    const listed = await ids([LLM_KIND]);

    expect(listed.filter((id) => id.startsWith("cx/")).sort()).toEqual(["cx/gpt-5.6-sol", "cx/gpt-5.6-sol-review"]);
  });

  it("keeps image and transcription rows the Codex catalog never lists", async () => {
    mocks.getCodexModels.mockResolvedValue([{ slug: "gpt-5.6-sol" }]);
    mocks.getProviderConnections.mockResolvedValue([connection("codex")]);

    const listed = await ids(["image", "stt"]);

    expect(listed).toEqual(expect.arrayContaining(["cx/gpt-image-2.5", "cx/transcribe"]));
  });

  it("falls back to the static catalog when discovery returns nothing", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("codex")]);

    expect(await ids([LLM_KIND])).toEqual(expect.arrayContaining(["cx/gpt-5.6-sol", "cx/gpt-5.6-terra"]));
  });

  it("keeps an operator allowlist authoritative", async () => {
    mocks.getCodexModels.mockResolvedValue([{ slug: "gpt-5.6-sol" }]);
    mocks.getProviderConnections.mockResolvedValue([
      connection("codex", { providerSpecificData: { enabledModels: ["gpt-5.6-terra"] } }),
    ]);

    expect((await ids([LLM_KIND])).filter((id) => id.startsWith("cx/"))).toEqual(["cx/gpt-5.6-terra"]);
  });
});
