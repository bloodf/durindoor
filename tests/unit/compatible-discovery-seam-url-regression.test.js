import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), get: vi.fn(), proxy: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));
// Registry imports must not start Kimchi's release lookup in this offline fixture.
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "kimchi/offline-fixture" }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.proxy }));
vi.mock("@/models", () => ({ getProviderConnectionById: mocks.get }));
vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshGoogleToken: vi.fn(), updateProviderCredentials: vi.fn(), checkAndRefreshToken: vi.fn(),
}));

import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { GET } from "../../src/app/api/providers/[id]/models/route.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const origin = "https://gateway.example.invalid";
const models = [{ id: "offline-model" }];
const proxy = { source: "offline-direct", disableEnvProxy: true };
const families = [
  { provider: "openai-compatible-chat-private", apiType: "chat", endpoint: "/chat/completions" },
  { provider: "openai-compatible-responses-private", apiType: "responses", endpoint: "/responses" },
  { provider: "anthropic-compatible-private", endpoint: "/messages" },
];
const connection = (family, baseUrl = `${origin}/v1`, extra = {}) => ({
  id: "offline-connection", provider: family.provider, apiKey: "offline-key",
  providerSpecificData: { baseUrl, apiType: family.apiType }, ...extra,
});
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const discover = async (stored) => {
  mocks.get.mockResolvedValue(stored);
  return GET(new Request("http://localhost:20127/api/providers/offline-connection/models"), {
    params: Promise.resolve({ id: "offline-connection" }),
  });
};
const headers = (family, token) => family.provider.startsWith("anthropic-") ? {
  "x-api-key": token, "anthropic-version": "2023-06-01", "Content-Type": "application/json",
} : { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.proxy.mockResolvedValue(proxy);
  mocks.fetch.mockImplementation(async () => { throw new Error("Unexpected offline transport call"); });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe.each(families)("compatible discovery API base: $provider", (family) => {
  it.each(["", "/", "/v1", "/v1/", "/tenant/api/"])("joins models relative to stored base %s, like native chat", async (path) => {
    const stored = connection(family, `${origin}${path}`);
    const base = stored.providerSpecificData.baseUrl.replace(/\/$/, "");
    mocks.fetch.mockImplementation(async (url) => url === `${base}/models`
      ? response({ data: models }) : response({ error: "Wrong discovery endpoint" }, 404));
    const result = await discover(stored);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ models });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(stored.id);
    expect(mocks.proxy).toHaveBeenCalledExactlyOnceWith(stored.providerSpecificData);
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(`${base}/models`, {
      method: "GET", headers: headers(family, stored.apiKey), cache: "no-store",
    }, proxy);
    expect(new DefaultExecutor(family.provider).buildUrl("offline-model", false, 0, stored))
      .toBe(`${base}${family.endpoint}`);
  });

  it.each([
    ["offline-access", "offline-key", "offline-access"],
    ["", "offline-key", "offline-key"],
  ])("keeps accessToken || apiKey precedence (%s)", async (accessToken, apiKey, token) => {
    mocks.fetch.mockResolvedValue(response(models));
    expect(await fetchConnectionModels(connection(family, `${origin}/v1`, { accessToken, apiKey })))
      .toEqual({ models });
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(`${origin}/v1/models`, {
      method: "GET", headers: headers(family, token), cache: "no-store",
    }, proxy);
  });

  it("keeps missing-key rejection at 401 without transport", async () => {
    const result = await discover(connection(family, `${origin}/v1`, { apiKey: "" }));
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ error: "No valid token found" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps missing-base rejection at 400 without transport", async () => {
    const result = await discover(connection(family, undefined, { providerSpecificData: {} }));
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "Missing custom base URL" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 429, 503])("forwards upstream status %i without fallback", async (status) => {
    mocks.fetch.mockResolvedValue(new Response("Offline upstream rejection", { status }));
    const result = await discover(connection(family));
    expect(result.status).toBe(status);
    expect(await result.json()).toEqual({ error: "Offline upstream rejection" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not reinterpret a full native endpoint as an API base", async () => {
    const baseUrl = `${origin}/v1${family.endpoint}`;
    mocks.fetch.mockResolvedValue(new Response("Invalid API base fixture", { status: 404 }));
    const stored = connection(family, baseUrl);
    const result = await discover(stored);
    expect(result.status).toBe(404);
    expect(mocks.fetch.mock.calls[0][0]).toBe(`${baseUrl}/models`);
    expect(new DefaultExecutor(family.provider).buildUrl("offline-model", false, 0, stored))
      .toBe(`${baseUrl}${family.endpoint}`);
  });
});

it("keeps each selected account's base, key and proxy isolated", async () => {
  const first = connection(families[0]);
  const second = connection(families[0], "https://second.example.invalid/api", {
    id: "offline-second", apiKey: "offline-second-key",
  });
  const secondProxy = { source: "offline-second", disableEnvProxy: true };
  mocks.proxy.mockResolvedValueOnce(proxy).mockResolvedValueOnce(secondProxy);
  mocks.fetch.mockImplementation(async () => response({ data: models }));
  await fetchConnectionModels(first);
  await fetchConnectionModels(second);
  expect(mocks.fetch.mock.calls).toEqual([
    [`${origin}/v1/models`, { method: "GET", headers: headers(families[0], first.apiKey), cache: "no-store" }, proxy],
    ["https://second.example.invalid/api/models", { method: "GET", headers: headers(families[0], second.apiKey), cache: "no-store" }, secondProxy],
  ]);
});
