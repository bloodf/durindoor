import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";
import { GET as getProviderModels } from "../../src/app/api/providers/[id]/models/route.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn() }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/models", () => ({ getProviderConnectionById: vi.fn() }));

import * as localDb from "@/lib/localDb";
import * as disabledModelsDb from "@/lib/disabledModelsDb";
import { getProviderConnectionById } from "@/models";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
const originalFetch = global.fetch;


function connection(provider, prefix, providerSpecificData = {}) {
  return {
    id: `connection-${prefix}`,
    provider,
    apiKey: `key-${prefix}`,
    isActive: true,
    providerSpecificData: { prefix, ...providerSpecificData },
  };
}

function stubCatalog({ connections, customModels = [], modelAliases = {}, disabledModels = {} }) {
  localDb.getProviderConnections.mockResolvedValue(connections);
  localDb.getCombos.mockResolvedValue([]);
  localDb.getCustomModels.mockResolvedValue(customModels);
  localDb.getModelAliases.mockResolvedValue(modelAliases);
  disabledModelsDb.getDisabledModels.mockResolvedValue(disabledModels);
}

async function providerIds(prefix) {
  return (await buildModelsList([LLM_KIND]))
    .map((model) => model.id)
    .filter((id) => id.startsWith(`${prefix}/`));
}

describe("buildModelsList — compatible provider public allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllGlobals();
  });


  it("exposes configured OpenAI-compatible models and aliases only", async () => {
    const provider = "openai-compatible-chat-allowlist";
    stubCatalog({
      connections: [connection(provider, "allowed", {
        baseUrl: "https://compatible.example/v1",
        enabledModels: ["stale-model"],
      })],
      customModels: ["one", "two", "three"].map((id) => ({ id, providerAlias: provider, type: "llm" })),
      modelAliases: { legacy: `${provider}/aliased` },
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });

    expect(await providerIds("allowed")).toEqual([
      "allowed/one",
      "allowed/two",
      "allowed/three",
      "allowed/aliased",
    ]);
    expect(global.fetch.mock.calls.some(([url]) => url === "https://compatible.example/v1/models")).toBe(false);
  });

  it("removes raw storage-alias duplicates when a compatible output prefix is configured", async () => {
    const provider = "openai-compatible-chat-storage-alias";
    stubCatalog({
      connections: [connection(provider, "allowed")],
      customModels: [{ id: "configured", providerAlias: provider, type: "llm" }],
    });

    const ids = (await buildModelsList([LLM_KIND])).map((model) => model.id);

    expect(ids).toContain("allowed/configured");
    expect(ids.every((id) => !id.startsWith(`${provider}/`))).toBe(true);
  });

  it("keeps custom rows stored under a stale compatible prefix", async () => {
    const provider = "openai-compatible-chat-renamed-prefix";
    stubCatalog({
      connections: [connection(provider, "allowed")],
      customModels: [{ id: "legacy", providerAlias: "previous-prefix", type: "llm" }],
    });

    expect(await providerIds("previous-prefix")).toEqual(["previous-prefix/legacy"]);
  });

  it("omits compatible rows disabled under the provider id", async () => {
    const provider = "openai-compatible-chat-disabled-row";
    stubCatalog({
      connections: [connection(provider, "allowed")],
      customModels: [
        { id: "visible", providerAlias: provider, type: "llm" },
        { id: "disabled", providerAlias: provider, type: "llm" },
      ],
      disabledModels: { [provider]: ["disabled"] },
    });

    const ids = (await buildModelsList([LLM_KIND])).map((model) => model.id);

    expect(ids).toContain("allowed/visible");
    expect(ids).not.toContain("allowed/disabled");
    expect(ids.every((id) => !id.startsWith(`${provider}/`))).toBe(true);
  });

  it("exposes configured Anthropic-compatible models and aliases only", async () => {
    const provider = "anthropic-compatible-allowlist";
    stubCatalog({
      connections: [connection(provider, "anthropic-custom", { baseUrl: "https://anthropic.example/v1" })],
      customModels: [{ id: "claude-configured", providerAlias: provider, type: "llm" }],
      modelAliases: { legacy: `${provider}/claude-aliased` },
    });
    global.fetch = vi.fn();

    expect(await providerIds("anthropic-custom")).toEqual([
      "anthropic-custom/claude-configured",
      "anthropic-custom/claude-aliased",
    ]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns no compatible models for an empty allowlist without live discovery", async () => {
    const provider = "openai-compatible-chat-empty";
    stubCatalog({ connections: [connection(provider, "empty", { baseUrl: "https://empty.example/v1" })] });
    global.fetch = vi.fn();

    expect(await providerIds("empty")).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps legacy custom rows stored under the display prefix", async () => {
    const provider = "openai-compatible-chat-legacy";
    stubCatalog({
      connections: [connection(provider, "display-prefix")],
      customModels: [{ id: "legacy-model", providerAlias: "display-prefix", type: "llm" }],
    });

    expect(await providerIds("display-prefix")).toEqual(["display-prefix/legacy-model"]);
  });

  it("keeps compatible aliases when no custom rows exist", async () => {
    const provider = "openai-compatible-chat-alias-only";
    stubCatalog({
      connections: [connection(provider, "alias-only")],
      modelAliases: { shortcut: `${provider}/alias-target` },
    });

    expect(await providerIds("alias-only")).toEqual(["alias-only/alias-target"]);
  });

  it("ignores stale enabledModels from a previous provider", async () => {
    const provider = "openai-compatible-chat-stale";
    stubCatalog({
      connections: [connection(provider, "stale", { enabledModels: ["old-one", "old-two"] })],
      customModels: [{ id: "saved", providerAlias: provider, type: "llm" }],
    });

    expect(await providerIds("stale")).toEqual(["stale/saved"]);
  });

  it("preserves registry-backed live model fetchers", async () => {
    stubCatalog({ connections: [connection("hcnsec", "hcnsec")] });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "hcnsec-live" }] }),
    });

    expect(await providerIds("hcnsec")).toContain("hcnsec/hcnsec-live");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.hcnsec.cn/v1/models",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer key-hcnsec" }) }),
    );
  });

  it("preserves Kimi live model merging", async () => {
    stubCatalog({ connections: [connection("kimi", "kimi")] });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "k3", context_length: 999_999 }] }),
    });

    const models = await buildModelsList([LLM_KIND]);
    expect(models.find((model) => model.id === "kimi/k3")?.capabilities.contextWindow).toBe(999_999);
  });

  it("preserves local passthrough discovery", async () => {
    stubCatalog({
      connections: [connection("lm-studio", "lmstudio", { baseUrl: "http://localhost:1234/v1" })],
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "local-model" }] }),
    });

    expect(await providerIds("lmstudio")).toContain("lmstudio/local-model");
  });

  it("keeps dashboard import discovery for compatible providers", async () => {
    getProviderConnectionById.mockResolvedValue(connection(
      "openai-compatible-chat-import",
      "imported",
      { baseUrl: "https://import.example" },
    ));
    proxyAwareFetch.mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "upstream-one" }, { id: "upstream-two" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await getProviderModels(
      new Request("http://localhost/api/providers/connection-imported/models"),
      { params: Promise.resolve({ id: "connection-imported" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: [{ id: "upstream-one" }, { id: "upstream-two" }] });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://import.example/v1/models",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer key-imported" }) }),
      {},
    );
  });
});
