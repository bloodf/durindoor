import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { projectModelPresentation } from "../../open-sse/providers/models/presentation.js";
import { parseModel } from "../../src/sse/services/model.js";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({})) }));

beforeEach(() => {
  vi.clearAllMocks();
  db.getProviderConnections.mockResolvedValue([]);
  db.getCombos.mockResolvedValue([]);
  db.getCustomModels.mockResolvedValue([]);
  db.getModelAliases.mockResolvedValue({});
});

describe("additive model display metadata", () => {
  it("keeps callable identity unchanged while enriching /v1/models", async () => {
    db.getProviderConnections.mockRejectedValueOnce(new Error("DB unavailable"));
    const { buildModelsList } = await import("../../src/app/api/v1/models/buildModelsList.js");
    const models = await buildModelsList(["llm"]);
    const model = models.find((entry) => entry.id === "cx/gpt-5.6-sol");

    expect(model).toMatchObject({
      id: "cx/gpt-5.6-sol",
      object: "model",
      owned_by: "cx",
      name: "GPT 5.6 Sol",
      provider_name: "OpenAI",
      provider_alias: "cx",
      gateway_provider: "OpenAI Codex",
    });
    expect(parseModel(model.id)).toMatchObject({
      provider: "codex",
      providerAlias: "cx",
      model: "gpt-5.6-sol",
    });
    expect(getModelUpstreamId("cx", "gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(getModelUpstreamId("cx", "gpt-5.6-sol-review")).toBe("gpt-5.6-sol");
  });

  it("keeps registry /v1/models/info name (does not overwrite with derived presentation)", async () => {
    const { GET } = await import("../../src/app/api/v1/models/info/route.js");
    const response = await GET(new Request("http://localhost/v1/models/info?id=cx/gpt-5.6-sol"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      id: "cx/gpt-5.6-sol",
      owned_by: "cx",
      name: "GPT 5.6 Sol",
      provider_name: "OpenAI",
      provider_alias: "cx",
      gateway_provider: "OpenAI Codex",
    });
    // Regression guard: #563 briefly rewrote this to the hyphenated form.
    expect(body.name).not.toBe("GPT-5.6 Sol");
  });

  it("preserves an explicit registry name in projectModelPresentation", () => {
    expect(projectModelPresentation({
      model: { id: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
      modelId: "gpt-5.6-sol",
      providerId: "codex",
      outputAlias: "cx",
    }).name).toBe("GPT 5.6 Sol");
  });

  it("keeps custom model names and callable ids while using registry provider metadata", async () => {
    db.getCustomModels.mockResolvedValueOnce([{
      id: "customer-gpt",
      providerAlias: "blackbox",
      name: "Customer GPT",
      type: "llm",
    }]);
    const { buildModelsList } = await import("../../src/app/api/v1/models/buildModelsList.js");
    const models = await buildModelsList(["llm"]);
    expect(models.find((entry) => entry.id === "blackbox/customer-gpt")).toMatchObject({
      id: "blackbox/customer-gpt",
      owned_by: "blackbox",
      name: "Customer GPT",
      provider_name: "Blackbox AI",
      provider_alias: "blackbox",
      gateway_provider: "Blackbox AI",
    });
  });
});
