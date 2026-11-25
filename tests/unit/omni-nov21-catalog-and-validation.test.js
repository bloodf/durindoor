import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const operator = vi.hoisted(() => ({ value: true }));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: vi.fn(async () => operator.value),
}));
vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(async () => []),
  getProviderConnectionById: vi.fn(),
  getProviderNodes: vi.fn(() => []),
  getProxyPoolById: vi.fn(),
  getProviderNodeById: vi.fn(),
  createProviderConnection: vi.fn(async (data) => ({ id: "c1", ...data })),
  updateProviderConnection: vi.fn(),
  deleteProviderConnection: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn() }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn().mockResolvedValue({ hidePaidModels: false }),
}));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));

import { AI_PROVIDERS } from "@/shared/constants/providers.js";
import { registryAllowsKeylessCredential } from "@/lib/providers/validation/registryCredentials.js";
import { POST as validateProvider } from "@/app/api/providers/validate/route.js";
import { POST as createProvider } from "@/app/api/providers/route.js";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";
import { materializeSyncedModel } from "../../src/lib/modelAutoSync/catalog.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { PROVIDER_MODELS_CONFIG } from "@/app/api/providers/[id]/models/modelsConfig.js";
import { CODEX_CLI_VERSION } from "../../open-sse/config/appConstants.js";
import { mergeSyncedCatalog } from "../../src/lib/modelAutoSync/catalog.js";
import * as localDb from "@/lib/localDb";
import * as disabledModelsDb from "@/lib/disabledModelsDb";
import * as models from "@/models";

const jsonRequest = (url, body) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ---------------------------------------------------------------------------
// #20458: keyless credentials only where the local registry says so
// ---------------------------------------------------------------------------
describe("#20458 registry-driven keyless credentials", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    operator.value = true;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const id of ["fixture-optional", "fixture-none", "fixture-required", "fixture-bad"]) delete AI_PROVIDERS[id];
  });

  it("accepts a provider the registry marks optional or none", () => {
    for (const id of ["kilo-gateway", "ovhcloud", "naga-ac"]) {
      expect(AI_PROVIDERS[id].authType).toBe("optional");
      expect(registryAllowsKeylessCredential(id)).toBe(true);
    }
    AI_PROVIDERS["fixture-none"] = { id: "fixture-none", authType: "none" };
    expect(registryAllowsKeylessCredential("fixture-none")).toBe(true);
  });

  it("keeps a provider that requires a credential strict", () => {
    expect(registryAllowsKeylessCredential("groq")).toBe(false);
    AI_PROVIDERS["fixture-required"] = { id: "fixture-required", authType: "required" };
    expect(registryAllowsKeylessCredential("fixture-required")).toBe(false);
    expect(registryAllowsKeylessCredential("definitely-not-a-provider")).toBe(false);
  });

  it("treats malformed optional metadata as not optional", () => {
    for (const authType of ["Optional", " optional", ["optional"], { optional: true }, true, 1, null]) {
      AI_PROVIDERS["fixture-bad"] = { id: "fixture-bad", authType };
      expect(registryAllowsKeylessCredential("fixture-bad")).toBe(false);
    }
    for (const input of [null, undefined, 42, {}, ""]) {
      expect(registryAllowsKeylessCredential(input)).toBe(false);
    }
  });

  it("validates an optional-registry provider without a credential and does not probe", async () => {
    global.fetch = vi.fn();
    const res = await validateProvider(jsonRequest("http://localhost/api/providers/validate", { provider: "kilo-gateway" }));
    expect(await res.json()).toEqual({ valid: true, error: null });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("still requires a credential to validate a required-key provider", async () => {
    global.fetch = vi.fn();
    const res = await validateProvider(jsonRequest("http://localhost/api/providers/validate", { provider: "groq" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Provider and API key required");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("runs the real probe when a key is supplied to an optional-registry provider", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    const res = await validateProvider(
      jsonRequest("http://localhost/api/providers/validate", { provider: "kilo-gateway", apiKey: "bad-key" }),
    );
    expect(global.fetch).toHaveBeenCalled();
    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.stringify(options.headers)).toContain("bad-key");
    expect((await res.json()).valid).toBe(false);
  });

  it("creates a keyless connection for an optional-registry provider only", async () => {
    const ok = await createProvider(jsonRequest("http://localhost/api/providers", { provider: "ovhcloud", name: "anon" }));
    expect(ok.status).toBe(201);
    expect(models.createProviderConnection).toHaveBeenCalledTimes(1);

    models.createProviderConnection.mockClear();
    const refused = await createProvider(jsonRequest("http://localhost/api/providers", { provider: "groq", name: "anon" }));
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe("API Key is required");
    expect(models.createProviderConnection).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #20601: a passthrough provider's placeholder context is not advertised
// ---------------------------------------------------------------------------
describe("#20601 passthrough placeholder context in /v1/models", () => {
  const hackclub = AI_PROVIDERS.hackclub;

  function stub(customModels) {
    localDb.getProviderConnections.mockResolvedValue([
      { id: "conn-hc", provider: "hackclub", isActive: true, apiKey: "sk-test", providerSpecificData: {} },
    ]);
    localDb.getCombos.mockResolvedValue([]);
    localDb.getCustomModels.mockResolvedValue(customModels);
    localDb.getModelAliases.mockResolvedValue({});
    disabledModelsDb.getDisabledModels.mockResolvedValue({});
  }

  beforeEach(() => vi.clearAllMocks());

  it("uses a passthrough registry with a provider-wide default context length", () => {
    expect(hackclub.passthroughModels).toBe(true);
  });

  it("omits context_length for an uncataloged passthrough model", async () => {
    stub([{ id: "acme/brand-new-model-1017", providerAlias: hackclub.alias }]);
    const list = await buildModelsList([LLM_KIND]);
    const row = list.find((m) => m.id === `${hackclub.alias}/acme/brand-new-model-1017`);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("context_length");
    expect(row.capabilities.contextWindow).toBeUndefined();
  });

  it("keeps a genuine per-model context value", async () => {
    stub([{
      id: "acme/known-model",
      providerAlias: hackclub.alias,
      capabilities: { contextWindow: 262144, maxOutput: 8192 },
    }]);
    const list = await buildModelsList([LLM_KIND]);
    const row = list.find((m) => m.id === `${hackclub.alias}/acme/known-model`);
    expect(row.context_length).toBe(262144);
    expect(row.max_completion_tokens).toBe(8192);
  });

  it("keeps the proven registry limits of a non-passthrough catalog model", async () => {
    localDb.getProviderConnections.mockResolvedValue([]);
    localDb.getCombos.mockResolvedValue([]);
    localDb.getCustomModels.mockResolvedValue([]);
    localDb.getModelAliases.mockResolvedValue({});
    disabledModelsDb.getDisabledModels.mockResolvedValue({});
    const list = await buildModelsList([LLM_KIND]);
    const row = list.find((m) => m.id === "aug/claude-sonnet-4.6");
    expect(AI_PROVIDERS.auggie?.passthroughModels).not.toBe(true);
    expect(row).toBeDefined();
    expect(row.context_length).toBe(1000000);
  });
});

// ---------------------------------------------------------------------------
// #20899: image rows do not inherit chat-only limits or capabilities
// ---------------------------------------------------------------------------
describe("#20899 image catalog rows next to a chat sibling", () => {
  const IMAGE_IDS = ["gpt-6.1-sol-image", "gpt-5.6-sol-image", "gpt-6-sol-image"];

  beforeEach(() => vi.clearAllMocks());

  it("an unregistered image id resolves no chat capabilities", () => {
    const chatLeak = getCapabilitiesForModel("codex", "gpt-6.1-sol-image");
    expect(chatLeak.tools).toBe(true); // the chat-family match the image row must not take
    const caps = getCapabilitiesForModel("codex", "gpt-6.1-sol-image", "image");
    expect(caps).toMatchObject({ tools: false, reasoning: false, vision: false, imageOutput: true });
    expect(caps.contextWindow ?? null).toBeNull();
    expect(caps.maxOutput ?? null).toBeNull();
  });

  it("a materialized image row keeps no chat token limits", () => {
    for (const id of IMAGE_IDS) {
      const { capabilities } = materializeSyncedModel("codex", { id, kind: "image" });
      expect(capabilities.tools).toBe(false);
      expect(capabilities.reasoning).toBe(false);
      expect(capabilities.imageOutput).toBe(true);
      expect(capabilities.contextWindow ?? null).toBeNull();
      expect(capabilities.maxOutput ?? null).toBeNull();
      expect(capabilities.maxInput ?? null).toBeNull();
    }
  });

  it("a capability the image row declares itself is kept", () => {
    const { capabilities } = materializeSyncedModel("codex", {
      id: "gpt-6.1-sol-image",
      kind: "image",
      capabilities: { imageOutput: true, vision: true },
    });
    expect(capabilities.vision).toBe(true);
    expect(capabilities.tools).toBe(false);
  });

  it("the chat sibling keeps its chat capabilities and limits", () => {
    const { capabilities } = materializeSyncedModel("codex", { id: "gpt-6-sol" });
    expect(capabilities.tools).toBe(true);
    expect(capabilities.reasoning).toBe(true);
    expect(capabilities.contextWindow).toBe(1050000);
    expect(capabilities.maxOutput).toBe(128000);
  });

  it("lists a custom image row beside its chat sibling with only the sibling carrying chat facts", async () => {
    localDb.getProviderConnections.mockResolvedValue([
      { id: "conn-cx", provider: "codex", isActive: true, accessToken: "t", providerSpecificData: {} },
    ]);
    localDb.getCombos.mockResolvedValue([]);
    localDb.getCustomModels.mockResolvedValue([
      { id: "gpt-6.1-sol", providerAlias: "cx" },
      { id: "gpt-6.1-sol-image", providerAlias: "cx", kind: "image" },
    ]);
    localDb.getModelAliases.mockResolvedValue({});
    disabledModelsDb.getDisabledModels.mockResolvedValue({});

    const list = await buildModelsList([LLM_KIND, "image"]);
    const image = list.find((m) => m.id === "cx/gpt-6.1-sol-image");
    const chat = list.find((m) => m.id === "cx/gpt-6.1-sol");
    expect(image).toBeDefined();
    expect(image.kind).toBe("image");
    expect(image).not.toHaveProperty("context_length");
    expect(image).not.toHaveProperty("max_completion_tokens");
    expect(image.capabilities.tools).toBe(false);
    expect(image.capabilities.reasoning).toBe(false);
    expect(image.capabilities.contextWindow ?? null).toBeNull();
    expect(chat.context_length).toBe(1050000);
    expect(chat.capabilities.tools).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #20606: Codex discovery never runs on a degraded client version
// ---------------------------------------------------------------------------
describe("#20606 Codex discovery keeps a single authoritative client version", () => {
  it("always requests the catalog with the pinned registry client version", () => {
    // There is no version refresh that can fail into a "fallback" source: the
    // pinned version is the only source, so a smaller live list is authoritative.
    expect(PROVIDER_MODELS_CONFIG.codex.url).toBe(
      `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLI_VERSION}`,
    );
  });

  it("a smaller authoritative list replaces the stored catalog for the same connection only", () => {
    const now = 1_700_000_000_000;
    const first = mergeSyncedCatalog(
      null,
      [{ id: "gpt-a", name: "a" }, { id: "gpt-b", name: "b" }, { id: "gpt-c", name: "c" }],
      { now, connectionId: "conn-1" },
    );
    const second = mergeSyncedCatalog(first, [{ id: "gpt-a", name: "a" }], { now: now + 1, connectionId: "conn-1" });
    expect(second.models.map((m) => m.id)).toEqual(["gpt-a"]);
    expect(second.removedModelIds.sort()).toEqual(["gpt-b", "gpt-c"]);
  });
});
