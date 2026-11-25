// Port of OmniRoute #15307: discover each Xiaomi API catalog using its own key.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), proxy: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.get }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.proxy }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => Response.json(body, init) } }));
import { GET } from "../../src/app/api/providers/[id]/models/route.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.proxy.mockResolvedValue({ strictProxy: true });
  mocks.fetch.mockResolvedValue(Response.json({ data: [{ id: "mimo-v2.6-pro" }] }));
});

it.each([
  ["xiaomi-mimo", "sk-synthetic", {}, "https://api.xiaomimimo.com/v1/models"],
  ["xiaomi-mimo-token-plan", "tp-other-synthetic", {}, "https://token-plan-sgp.xiaomimimo.com/v1/models"],
  ["xiaomi-tokenplan", "tp-synthetic", { region: "cn" }, "https://token-plan-cn.xiaomimimo.com/v1/models"],
])("discovers %s models with only that connection's credential and proxy", async (provider, key, data, url) => {
  mocks.get.mockResolvedValue({ id: provider, provider, apiKey: key, providerSpecificData: data });
  const response = await GET(new Request(`http://localhost/api/providers/${provider}/models`), { params: { id: provider } });
  expect(response.status).toBe(200);
  expect((await response.json()).models).toEqual(expect.arrayContaining([expect.objectContaining({ id: "mimo-v2.6-pro" })]));
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.fetch.mock.calls[0][0]).toBe(url);
  expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${key}`);
  expect(mocks.fetch.mock.calls[0][2]).toEqual({ strictProxy: true });
});

it("does not send a session-only credential to the cloud model endpoint", async () => {
  mocks.get.mockResolvedValue({ id: "session", provider: "xiaomi-mimo", providerSpecificData: { mimoPassToken: "synthetic-session" } });
  const response = await GET(new Request("http://localhost/api/providers/session/models"), { params: { id: "session" } });
  expect(response.status).toBe(401);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
