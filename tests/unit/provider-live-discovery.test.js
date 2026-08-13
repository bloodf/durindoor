import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  getSettings: vi.fn(),
  getCodexModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));
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
});

describe("provider live model discovery", () => {
  it("uses Anthropic limits and capability flags while skipping malformed entries", async () => {
    const fetchSpy = vi.fn(async () => response({
      data: [
        {
          id: "claude-opus-5",
          max_input_tokens: 777_777,
          max_tokens: 33_333,
          capabilities: {
            image_input: { supported: false },
            pdf_input: { supported: true },
            thinking: {
              types: {
                enabled: { supported: true },
                adaptive: { supported: false },
              },
            },
          },
        },
        { max_input_tokens: 123_456 },
      ],
    }));
    vi.stubGlobal("fetch", fetchSpy);
    mocks.getProviderConnections.mockResolvedValue([connection("claude")]);

    const models = await buildModelsList([LLM_KIND]);
    const live = model(models, "cc/claude-opus-5");

    expect(live.capabilities).toMatchObject({
      contextWindow: 777_777,
      maxOutput: 33_333,
      vision: false,
      pdf: true,
      reasoning: true,
      thinkingCanDisable: true,
      thinkingFormat: "claude-budget",
    });
    expect(live.context_length).toBe(777_777);
    expect(live.max_completion_tokens).toBe(33_333);
    expect(models.some((entry) => entry.id.includes("undefined"))).toBe(false);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models?limit=100",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer claude-token",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );
  });

  it("enriches an explicitly enabled Anthropic model without adding live siblings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      data: [
        { id: "claude-opus-5", max_input_tokens: 333_333, max_tokens: 22_222 },
        { id: "claude-live-sibling", max_input_tokens: 444_444, max_tokens: 11_111 },
      ],
    })));
    mocks.getProviderConnections.mockResolvedValue([connection("claude", {
      providerSpecificData: { enabledModels: ["claude-opus-5"] },
    })]);

    const models = await buildModelsList([LLM_KIND]);

    expect(model(models, "cc/claude-opus-5").capabilities.contextWindow).toBe(333_333);
    expect(model(models, "cc/claude-live-sibling")).toBeUndefined();
  });

  it("lets live Anthropic metadata disable stale static reasoning flags", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      data: [{
        id: "claude-opus-5",
        max_input_tokens: 222_222,
        max_tokens: 12_345,
        capabilities: { thinking: { supported: false } },
      }],
    })));
    mocks.getProviderConnections.mockResolvedValue([connection("claude")]);

    const models = await buildModelsList([LLM_KIND]);
    const live = model(models, "cc/claude-opus-5");

    expect(live.capabilities.reasoning).toBe(false);
    expect(live.capabilities.thinkingFormat).toBeNull();
  });

  it("falls back to Anthropic static catalog when live discovery fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: "offline" }, 503)));
    mocks.getProviderConnections.mockResolvedValue([connection("claude")]);

    const models = await buildModelsList([LLM_KIND]);

    expect(model(models, "cc/claude-opus-5")).toBeDefined();
    expect(model(models, "cc/claude-fable-5")).toBeDefined();
  });

  it("enriches Cloudflare string context windows without deleting a short-page omission", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      result: [
        {
          name: "@cf/meta/llama-3.2-1b-instruct",
          properties: [{ property_id: "context_window", value: "65432" }],
        },
        {
          name: "@cf/meta/llama-3.2-3b-instruct",
          properties: [],
        },
      ],
      result_info: { total_count: 287, count: 2 },
    })));
    mocks.getProviderConnections.mockResolvedValue([
      connection("cloudflare-ai", { providerSpecificData: { accountId: "account-123" } }),
    ]);

    const models = await buildModelsList([LLM_KIND]);

    expect(model(models, "cf/@cf/meta/llama-3.2-1b-instruct").capabilities.contextWindow).toBe(65_432);
    expect(model(models, "cf/@cf/meta/llama-3.2-3b-instruct").capabilities.contextWindow).toBe(80_000);
    expect(model(models, "cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast")).toBeDefined();
  });

  it("keeps every Cloudflare static model when the live page is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      result: [],
      result_info: { total_count: 287, count: 0 },
    })));
    mocks.getProviderConnections.mockResolvedValue([
      connection("cloudflare-ai", { providerSpecificData: { accountId: "account-123" } }),
    ]);

    const models = await buildModelsList([LLM_KIND]);

    expect(model(models, "cf/@cf/meta/llama-3.2-1b-instruct")).toBeDefined();
    expect(model(models, "cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast")).toBeDefined();
  });

  it("adds MiniMax live IDs without inventing limits and preserves known static capabilities", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      data: [{ id: "MiniMax-M3" }, { id: "MiniMax-New" }],
    })));
    mocks.getProviderConnections.mockResolvedValue([connection("minimax")]);

    const models = await buildModelsList([LLM_KIND]);
    const known = model(models, "minimax/MiniMax-M3");
    const unknown = model(models, "minimax/MiniMax-New");

    expect(known.capabilities).toMatchObject({ reasoning: true, contextWindow: 1_000_000 });
    expect(unknown).toBeDefined();
    expect(unknown.capabilities.contextWindow).toBeUndefined();
    expect(unknown.capabilities.maxOutput).toBeUndefined();
    expect(unknown.context_length).toBeUndefined();
    expect(unknown.max_completion_tokens).toBeUndefined();
  });

  it("enumerates GLM from the coding-plan list despite a stored chat-quota 429", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      data: [{ id: "glm-5.2" }, { id: "glm-new-live" }],
    })));
    mocks.getProviderConnections.mockResolvedValue([
      connection("glm", { lastError: "429 Weekly/Monthly Limit Exhausted" }),
    ]);

    const models = await buildModelsList([LLM_KIND]);
    const unknown = model(models, "glm/glm-new-live");

    expect(model(models, "glm/glm-5.2").capabilities.reasoning).toBe(true);
    expect(unknown).toBeDefined();
    expect(unknown.capabilities.contextWindow).toBeUndefined();
    expect(unknown.capabilities.maxOutput).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "https://api.z.ai/api/coding/paas/v4/models",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("uses the shared Codex catalog fetcher and only trusts its context window", async () => {
    mocks.getCodexModels.mockResolvedValue([
      { slug: "gpt-5.6-sol", context_window: 345_678 },
      { slug: "gpt-new-codex", context_window: 456_789 },
    ]);
    mocks.getProviderConnections.mockResolvedValue([connection("codex")]);

    const models = await buildModelsList([LLM_KIND]);
    const known = model(models, "cx/gpt-5.6-sol");
    const unknown = model(models, "cx/gpt-new-codex");

    expect(known.capabilities.contextWindow).toBe(345_678);
    expect(known.capabilities.maxOutput).toBe(128_000);
    expect(unknown.capabilities.contextWindow).toBe(456_789);
    expect(unknown.capabilities.maxOutput).toBeUndefined();
    expect(mocks.getCodexModels).toHaveBeenCalledWith(
      "codex-token",
      expect.anything(),
      {},
      undefined,
    );
  });
});
