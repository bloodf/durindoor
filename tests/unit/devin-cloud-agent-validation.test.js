import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  probeRegistryProvider,
  validateDevinCloudAgentProvider,
} from "../../src/app/api/providers/providerProbe.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// OmniRoute #6894 (diegosouzapw#6142): wire the Devin cloud-agent provider into
// the generic provider validation flow and the static model catalog, mirroring
// the `jules` cloud-agent pattern. `devin` has no chat transport
// (`transport: null`), so without the specialty validator the generic
// registry probe returns null and the route reports "Provider validation not
// supported".

const okResponse = () => ({ ok: true, status: 200, text: async () => "" });
const authFailResponse = (status) => ({ ok: false, status, text: async () => "unauthorized" });

// /v1/models exclusion assertions: the Devin placeholder must never surface in
// the LLM catalog (it has no chat transport), but stays direct-lookupable.
const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

describe("validateDevinCloudAgentProvider (OmniRoute #6894)", () => {
  it("accepts a key when Devin lists sessions (200)", async () => {
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url, options });
      return okResponse();
    };

    const result = await validateDevinCloudAgentProvider({ apiKey: "cog_token", fetcher });

    expect(result).toMatchObject({ valid: true, status: 200 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.devin.ai/v1/sessions?limit=1");
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers.Authorization).toBe("Bearer cog_token");
  });

  it.each([401, 403])("rejects with Invalid API key on HTTP %i", async (status) => {
    const fetcher = async () => authFailResponse(status);
    const result = await validateDevinCloudAgentProvider({ apiKey: "bad", fetcher });
    expect(result).toMatchObject({ valid: false, status, error: "Invalid API key" });
  });

  it("rejects without leaking raw network error text on fetch failure", async () => {
    const fetcher = async () => {
      throw new Error("getaddrinfo ENOTFOUND secret.internal.host");
    };
    const result = await validateDevinCloudAgentProvider({ apiKey: "k", fetcher });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Provider unavailable - network request failed");
    expect(result.error).not.toContain("ENOTFOUND");
  });

  it("rejects on other non-OK statuses without treating them as auth failures", async () => {
    const fetcher = async () => ({ ok: false, status: 500, text: async () => "boom" });
    const result = await validateDevinCloudAgentProvider({ apiKey: "k", fetcher });
    expect(result).toMatchObject({ valid: false, status: 500 });
    expect(result.error).toBe("Provider validation failed (HTTP 500)");
  });
});

describe("devin provider wiring (OmniRoute #6894)", () => {
  it("routes the generic validation dispatcher through the specialty validator", async () => {
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push(url);
      return okResponse();
    };

    const result = await probeRegistryProvider("devin", "cog_token", fetcher);

    expect(result).toMatchObject({ valid: true, status: 200 });
    expect(calls).toEqual(["https://api.devin.ai/v1/sessions?limit=1"]);
  });

  it("returns Invalid API key through the dispatcher on 401", async () => {
    const result = await probeRegistryProvider("devin", "bad", async () => authFailResponse(401));
    expect(result).toMatchObject({ valid: false, status: 401, error: "Invalid API key" });
  });

  it("keeps the placeholder out of the default LLM catalog but direct-lookupable", async () => {
    // The model carries kind:"agent" and the provider serviceKinds:["agent"]:
    // without either, buildModelsList/providerMatchesKinds default to "llm"
    // and the unroutable placeholder leaks into /v1/models + LLM selectors.
    const { AI_PROVIDERS } = await import("../../src/shared/constants/providers.js");
    const { PROVIDER_ID_TO_ALIAS } = await import("../../open-sse/config/providerModels.js");
    expect(AI_PROVIDERS.devin.serviceKinds).toEqual(["agent"]);
    const models = getModelsByProviderId("devin");
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toMatchObject({ id: "devin", name: "Devin (Cognition cloud agent)", kind: "agent" });
    expect(PROVIDER_ID_TO_ALIAS.devin).toBe("devin");
  });

  it("marks the placeholder model as toolless so combo never expects tool calls", () => {
    const caps = getCapabilitiesForModel("devin", "devin");
    expect(caps.tools).toBe(false);
  });

  it("keeps the ACP devin-cli provider out of the specialty dispatch", async () => {
    // devin-cli has a registry transport of devin://acp/stdio (non-HTTP). The
    // specialty map is keyed exactly to the cloud-agent id, so devin-cli falls
    // through to the generic probe, whose SSRF guard blocks the non-HTTP(S)
    // scheme before any network call — no Devin sessions fetch is made.
    let fetched = false;
    const fetcher = async () => {
      fetched = true;
      return okResponse();
    };
    const result = await probeRegistryProvider("devin-cli", "token", fetcher);
    expect(fetched).toBe(false);
    expect(result).toMatchObject({
      valid: false,
      blocked: true,
      status: null,
    });
  });
});

describe("devin /v1/models exclusion (OmniRoute #6894)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([
      { provider: "devin", isActive: true, apiKey: "cog_token" },
    ]);
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("omits devin from the root LLM models list even with an active connection", async () => {
    const { buildModelsList, LLM_KIND } = await import(
      "../../src/app/api/v1/models/buildModelsList.js"
    );
    const ids = (await buildModelsList([LLM_KIND])).map((m) => m.id);
    expect(ids.some((id) => id.startsWith("devin/"))).toBe(false);
  });
});

describe("devin direct dispatch fail-closed (OmniRoute #6894)", () => {
  // Direct model:"devin/devin" chat requests bypass the catalog/selector
  // exclusion above. Before this guard, getExecutor("devin") fell through to
  // DefaultExecutor, whose constructor substitutes PROVIDERS.openai when
  // PROVIDERS["devin"] is undefined (transport:null), which dispatched the
  // saved Devin API key as a Bearer token to api.openai.com — cross-provider
  // credential disclosure. The blocked-provider executor returns a synthetic
  // 501 with ZERO upstream fetch, so the credential never leaves the process.
  it("getExecutor('devin') returns the fail-closed executor, not DefaultExecutor", async () => {
    const { getExecutor, hasSpecializedExecutor } = await import(
      "../../open-sse/executors/index.js"
    );
    expect(hasSpecializedExecutor("devin")).toBe(true);
    expect(getExecutor("devin").constructor.name).toBe(
      "UnsupportedOmniRouteWebSessionExecutor"
    );
  });

  it("execute() returns 501 and performs ZERO upstream fetch even with credentials", async () => {
    const { getExecutor } = await import("../../open-sse/executors/index.js");
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy;
    try {
      const result = await getExecutor("devin").execute({
        credentials: { apiKey: "cog_token_secret" },
        body: { model: "devin/devin", messages: [{ role: "user", content: "hi" }] },
      });
      expect(result.response.status).toBe(501);
      const payload = JSON.parse(await result.response.text());
      expect(payload.error.type).toBe("provider_port_pending");
      expect(payload.error.provider).toBe("devin");
      expect(payload.error.message).toContain("no chat transport");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("buildUrl()/buildHeaders() THROW without disclosing the credential (route bypass path)", async () => {
    // translator/translate step 3 calls buildUrl/buildHeaders DIRECTLY on the
    // resolved executor and returns the result without ever invoking execute().
    // BaseExecutor.buildHeaders would attach the saved Devin key as an
    // Authorization Bearer header (it ignores config.noAuth) — a cross-provider
    // credential disclosure. The overrides must throw fail-loud and the thrown
    // error must carry NO credential material.
    const { getExecutor } = await import("../../open-sse/executors/index.js");
    const SECRET = "cog_token_secret";
    const executor = getExecutor("devin");

    expect(() => executor.buildHeaders({ apiKey: SECRET })).toThrow(/no chat transport/);
    expect(() => executor.buildUrl("devin/devin", false, 0, { apiKey: SECRET })).toThrow(/no chat transport/);

    let thrown;
    try { executor.buildHeaders({ apiKey: SECRET }); } catch (error) { thrown = error; }
    expect(thrown).toBeDefined();
    expect(String(thrown.message)).not.toContain(SECRET);
    expect(String(thrown.message)).not.toContain("api.openai.com");
  });
});
