import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), proxy: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.get, updateProviderConnection: mocks.update, getSettings: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.proxy }));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: vi.fn() }));
vi.mock("open-sse/services/oauthCredentialManager.js", () => ({ refreshProviderCredentials: mocks.refresh, shouldRefreshCredentials: () => false }));
import { __setProviderTestFetchForTesting, testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

afterEach(() => { __setProviderTestFetchForTesting(null); vi.clearAllMocks(); });

it.each([401, 403, 500, "throw"])("persists rotated Cline credentials after retry %s", async (status) => {
  const proxy = { marker: "route" };
  mocks.get.mockResolvedValue({ id: "c", provider: "cline", accessToken: "old", refreshToken: "old-refresh" });
  mocks.proxy.mockResolvedValue(proxy);
  let calls = 0;
  __setProviderTestFetchForTesting(async (_url, _options, route) => {
    expect(route).toEqual(proxy);
    calls++;
    if (calls === 1) return { ok: false, status: 401 };
    if (calls === 2) return { ok: true, json: async () => ({ accessToken: "new", refreshToken: "new-refresh" }) };
    if (status === "throw") throw new Error("secret-token");
    return { ok: false, status };
  });
  const result = await testSingleConnection("c");
  expect(result).toMatchObject({ valid: false, refreshed: true });
  expect(result.error).not.toContain("secret-token");
  expect(mocks.update).toHaveBeenCalledWith("c", expect.objectContaining({ accessToken: "new", refreshToken: "new-refresh" }));
  if (status === 401) expect(result.error).toContain("after refresh");
});

it.each([401, 403, 500, "throw"])("persists generic rotated credentials after retry %s", async (status) => {
  mocks.get.mockResolvedValue({ id: "g", provider: "grok-cli", accessToken: "old", refreshToken: "old-refresh" });
  mocks.proxy.mockResolvedValue({});
  mocks.refresh.mockResolvedValue({ accessToken: "new", refreshToken: "new-refresh" });
  let calls = 0;
  __setProviderTestFetchForTesting(async () => {
    if (++calls === 1) return { ok: false, status: 401 };
    if (status === "throw") throw new Error("secret-token");
    return { ok: false, status };
  });
  const result = await testSingleConnection("g");
  expect(result).toMatchObject({ valid: false, refreshed: true });
  expect(result.error).not.toContain("secret-token");
  expect(mocks.update).toHaveBeenCalledWith("g", expect.objectContaining({ accessToken: "new", refreshToken: "new-refresh" }));
  if (status === 500) expect(mocks.update.mock.calls[0][1]).not.toHaveProperty("testStatus");
});
