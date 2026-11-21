/**
 * #1073: the Reka provider model route serves the existing curated catalog.
 *
 * Port of OmniRoute #1956 ("chore(provider): Add reka models list"), head
 * b4a3324898d32442c987eb492f0d0e43b828ffcf, merge
 * 4dc959c1f2b4d2c63032e361ff65bba004172e7e.
 *
 * Reka publishes no list-models endpoint, so its discovery answer is the
 * bundled registry catalog. Every assertion below is offline: the connection
 * is mocked, the outbound seam is a spy that must stay untouched, and no
 * provider traffic, credential or paid API is involved.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const routedFetch = vi.hoisted(() => vi.fn());
const resolveConnectionProxyConfig = vi.hoisted(() => vi.fn());

vi.mock("@/models", () => ({
  getProviderConnectionById: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig,
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: routedFetch,
}));

import { getProviderConnectionById } from "@/models";
import { GET } from "../../src/app/api/providers/[id]/models/route.js";
import { canDiscoverModels } from "@/lib/providerRouteHandlers.js";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { PROVIDER_MODELS_CONFIG } from "../../src/app/api/providers/[id]/models/modelsConfig.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";

const REKA = "reka";
const REKA_CONNECTION = "reka-connection";
const REKA_API_KEY = "reka-secret-key";
const UNKNOWN_PROVIDER = "provider-that-has-no-catalog";

const getRequest = (connectionId) =>
  new Request(`http://localhost/api/providers/${connectionId}/models`, { method: "GET" });

const getParams = (connectionId) => Promise.resolve({ id: connectionId });

describe("Reka provider model route serves the existing curated catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routedFetch.mockRejectedValue(new Error("no provider traffic is allowed in this test"));
  });

  it("keeps the premise: Reka has no list-models endpoint of its own", () => {
    // The curated registry list is the only catalog Reka has, which is why the
    // route answers from it instead of calling a provider endpoint.
    expect(PROVIDER_MODELS_CONFIG[REKA]).toBeUndefined();
    expect(AI_PROVIDERS[REKA]?.modelsFetcher?.url).toBeUndefined();
    expect(getProviderModels(REKA).map((model) => model.id)).toEqual([
      "reka-flash-3",
      "reka-flash",
      "reka-edge-2603",
    ]);
  });

  it("returns the curated catalog for a Reka connection without contacting the provider", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: REKA_CONNECTION,
      provider: REKA,
      apiKey: REKA_API_KEY,
      providerSpecificData: {},
    });

    const res = await GET(getRequest(REKA_CONNECTION), { params: getParams(REKA_CONNECTION) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.provider).toBe(REKA);
    expect(body.connectionId).toBe(REKA_CONNECTION);
    expect(body.source).toBe("local_catalog");
    // The registry order is the listing order.
    expect(body.models.map((model) => model.id)).toEqual([
      "reka-flash-3",
      "reka-flash",
      "reka-edge-2603",
    ]);
    expect(body.models.map((model) => model.name)).toEqual([
      "Reka Flash 3",
      "Reka Flash",
      "Reka Edge 2603",
    ]);
    // Every row names the provider that owns it.
    expect(body.models.every((model) => model.owned_by === REKA)).toBe(true);

    // The catalog is local: no request leaves the gateway and the stored key
    // is never read, sent or echoed.
    expect(routedFetch).not.toHaveBeenCalled();
    expect(resolveConnectionProxyConfig).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(REKA_API_KEY);
  });

  it("keeps the existing discovery failure for a provider without any catalog", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "unknown-connection",
      provider: UNKNOWN_PROVIDER,
      apiKey: "k",
      providerSpecificData: {},
    });

    const res = await GET(getRequest("unknown-connection"), { params: getParams("unknown-connection") });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("does not support models listing");
    expect(routedFetch).not.toHaveBeenCalled();
  });

  it("reports Reka as listable and leaves other providers unchanged", () => {
    expect(canDiscoverModels({ provider: REKA, apiKey: REKA_API_KEY })).toBe(true);
    expect(canDiscoverModels({ provider: UNKNOWN_PROVIDER, apiKey: "k" })).toBe(false);
  });

  it("leaves the Reka namespace and model capabilities untouched", () => {
    // `/v1/models` keeps publishing Reka rows under the provider alias, and
    // the capability table keeps declaring the vision-capable Reka model.
    expect(PROVIDER_ID_TO_ALIAS[REKA]).toBe(REKA);
    expect(getCapabilitiesForModel(REKA, "reka-edge-2603").vision).toBe(true);
  });
});
