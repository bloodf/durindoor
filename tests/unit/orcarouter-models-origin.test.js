import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock.proxyAwareFetch }));

const { PROVIDER_MODELS_CONFIG } = await import("../../src/app/api/providers/[id]/models/modelsConfig.js");
const { mergeOrcaCatalogResults } = await import("../../src/shared/utils/orcaCatalogPicker.js");
const { orcaApiKeySaveRequest, orcaApiKeyTargetId } = await import("../../src/shared/utils/orcaApiKeySave.js");

function okCatalog() {
  return new Response(JSON.stringify({ data: [{ id: "openai/gpt-5.5", supported_endpoint_types: ["openai"] }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OrcaRouter catalog origin", () => {
  beforeEach(() => {
    fetchMock.proxyAwareFetch.mockReset();
    fetchMock.proxyAwareFetch.mockResolvedValue(okCatalog());
    delete process.env.ORCA_API_BASE_URL;
    delete process.env.ORCA_BASE_URL;
  });

  it("never sends the stored key to a connection-supplied baseUrl", async () => {
    const connection = {
      provider: "orcarouter",
      accessToken: "sk-orca-secret",
      providerSpecificData: { baseUrl: "https://attacker.example" },
    };
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.test:8080" };

    const result = await PROVIDER_MODELS_CONFIG.orcarouter.customResolver(
      connection, proxyOptions, "http://localhost/api/providers/x/models?capability=chat",
    );

    expect(result.source).toBe("live");
    expect(fetchMock.proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, init, passedProxy] = fetchMock.proxyAwareFetch.mock.calls[0];
    expect(new URL(url).origin).toBe("https://api.orcarouter.ai");
    expect(init.headers.Authorization).toBe("Bearer sk-orca-secret");
    // The connection's proxy route is honoured, not skipped.
    expect(passedProxy).toBe(proxyOptions);
  });

  it("uses the operator-configured origin", async () => {
    process.env.ORCA_API_BASE_URL = "https://orca.internal.example";
    await PROVIDER_MODELS_CONFIG.orcarouter.customResolver(
      { provider: "orcarouter", apiKey: "sk-orca-secret", providerSpecificData: {} }, null, null,
    );
    expect(new URL(fetchMock.proxyAwareFetch.mock.calls[0][0]).origin).toBe("https://orca.internal.example");
    delete process.env.ORCA_API_BASE_URL;
  });
});

describe("OrcaRouter multi-account catalog merge", () => {
  it("drops fallback seed payloads once any account answered live", () => {
    const merged = mergeOrcaCatalogResults([
      { source: "live", degraded: false, models: [{ id: "a/live" }] },
      { source: "fallback", degraded: true, models: [{ id: "orcarouter/auto" }] },
      null,
    ]);
    expect(merged.models.map((m) => m.id)).toEqual(["a/live"]);
    expect(merged.source).toBe("live");
    expect(merged.degraded).toBe(false);
  });

  it("falls back to the seed only when nobody answered live", () => {
    const merged = mergeOrcaCatalogResults([
      { source: "fallback", degraded: true, models: [{ id: "orcarouter/auto" }] },
      { source: "fallback", degraded: true, models: [{ id: "orcarouter/auto" }] },
    ]);
    expect(merged.models.map((m) => m.id)).toEqual(["orcarouter/auto"]);
    expect(merged.degraded).toBe(true);
  });
});

describe("OrcaRouter API-key save", () => {
  it("replaces the existing API-key row instead of creating a duplicate", () => {
    const id = orcaApiKeyTargetId([
      { id: "oauth-1", provider: "orcarouter", authType: "oauth" },
      { id: "key-1", provider: "orcarouter", authType: "apikey" },
    ]);
    expect(id).toBe("key-1");
    expect(orcaApiKeySaveRequest(id, "sk-orca-new")).toEqual({
      url: "/api/providers/key-1",
      method: "PUT",
      body: { apiKey: "sk-orca-new", isActive: true, testStatus: "active" },
    });
  });

  it("creates a row when no API-key row exists yet", () => {
    const id = orcaApiKeyTargetId([{ id: "oauth-1", provider: "orcarouter", authType: "oauth" }]);
    expect(id).toBeNull();
    expect(orcaApiKeySaveRequest(id, "sk-orca-new")).toMatchObject({ url: "/api/providers", method: "POST" });
  });
});
