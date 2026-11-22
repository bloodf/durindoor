import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getModelAliases: vi.fn(async () => ({})),
  setModelAlias: vi.fn(async () => {}),
  deleteModelAlias: vi.fn(async () => {}),
  getEnabledModels: vi.fn(async () => ({})),
  setEnabledModels: vi.fn(async () => {}),
  getDisabledModels: vi.fn(async () => ({})),
  disableModels: vi.fn(async () => {}),
  enableModels: vi.fn(async () => {}),
  getCustomModels: vi.fn(async () => []),
  addCustomModel: vi.fn(async (model) => model),
  updateCustomModel: vi.fn(async (model) => model),
  deleteCustomModel: vi.fn(async () => {}),
  filterModelsForRequest: vi.fn(async (_request, models) => models.slice(0, 1)),
  handleChat: vi.fn(),
}));

vi.mock("@/models", () => ({
  getModelAliases: mocks.getModelAliases, setModelAlias: mocks.setModelAlias, deleteModelAlias: mocks.deleteModelAlias,
  getCustomModels: mocks.getCustomModels, addCustomModel: mocks.addCustomModel,
  updateCustomModel: mocks.updateCustomModel, deleteCustomModel: mocks.deleteCustomModel,
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: mocks.getEnabledModels, setEnabledModels: mocks.setEnabledModels }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels, disableModels: mocks.disableModels, enableModels: mocks.enableModels }));
vi.mock("@/sse/services/modelAccess.js", () => ({ filterModelsForRequest: mocks.filterModelsForRequest }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));

const modelsRoute = await import("../../src/app/api/models/route.js");
const aliasRoute = await import("../../src/app/api/models/alias/route.js");
const enabledRoute = await import("../../src/app/api/models/enabled/route.js");
const disabledRoute = await import("../../src/app/api/models/disabled/route.js");
const customRoute = await import("../../src/app/api/models/custom/route.js");
const messagesRoute = await import("../../src/app/api/v1/messages/route.js");
const betaModelsRoute = await import("../../src/app/api/v1beta/models/route.js");

function jsonRequest(url, method, body) {
  return new Request(`https://router.test${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("API review fixes", () => {
  it("stores model aliases as alias to model and rejects an alias used by another model", async () => {
    mocks.getModelAliases.mockResolvedValue({ short: "openai/old" });
    const conflict = await modelsRoute.PUT(jsonRequest("/api/models", "PUT", JSON.stringify({ model: "openai/new", alias: "short" })));
    expect(conflict.status).toBe(400);
    const ok = await modelsRoute.PUT(jsonRequest("/api/models", "PUT", JSON.stringify({ model: "openai/new", alias: "new" })));
    expect(ok.status).toBe(200);
    expect(mocks.setModelAlias).toHaveBeenCalledWith("new", "openai/new");
  });

  it("returns 400 for malformed management JSON and filters disabled ids", async () => {
    for (const handler of [modelsRoute.PUT, aliasRoute.PUT, enabledRoute.PUT, disabledRoute.POST, customRoute.POST, customRoute.PATCH]) {
      expect((await handler(jsonRequest("/api/models", "POST", "{"))).status).toBe(400);
    }
    const response = await disabledRoute.POST(jsonRequest("/api/models/disabled", "POST", JSON.stringify({ providerAlias: "openai", ids: ["a", 1, null, " b "] })));
    expect(response.status).toBe(200);
    expect(mocks.disableModels).toHaveBeenCalledWith("openai", ["a", "b"]);
  });

  it("uses Anthropic error shape for malformed /v1/messages JSON", async () => {
    const response = await messagesRoute.POST(jsonRequest("/v1/messages", "POST", "{"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ type: "error", error: { type: "invalid_request_error", message: expect.any(String) } });
    expect(mocks.handleChat).not.toHaveBeenCalled();
  });

  it("filters the Gemini v1beta model listing for the request", async () => {
    const response = await betaModelsRoute.GET(new Request("https://router.test/v1beta/models", { headers: { authorization: "Bearer key" } }));
    expect(mocks.filterModelsForRequest).toHaveBeenCalledOnce();
    const listed = (await response.json()).models;
    expect(listed.length).toBe(1);
    expect(listed[0].name).toMatch(/^models\//);
  });
});
