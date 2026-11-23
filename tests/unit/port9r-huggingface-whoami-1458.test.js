import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), proxy: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.get, updateProviderConnection: mocks.update }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.proxy }));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: vi.fn() }));
import { POST } from "@/app/api/providers/validate/route.js";
import { __setProviderTestFetchForTesting, testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; __setProviderTestFetchForTesting(null); vi.clearAllMocks(); });

it.each([200, 401, 403, 500, 0])("checks whoami consistently for status %s", async (status) => {
  const fetcher = vi.fn(async () => { if (!status) throw new Error("offline"); return { ok: status === 200, status }; });
  global.fetch = fetcher;
  const response = await POST(new Request("http://localhost/api/providers/validate", { method: "POST", body: JSON.stringify({ provider: "huggingface", apiKey: "test" }) }));
  const result = await response.json();
  expect(result.valid).toBe(status === 200);
  expect(!!result.unavailable).toBe(status === 500 || status === 0);
  expect(fetcher.mock.calls[0][0]).toBe("https://huggingface.co/api/whoami-v2");
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer test");

  const proxy = { connectionProxyEnabled: false, marker: "proxy" };
  mocks.get.mockResolvedValue({ id: "hf", provider: "huggingface", authType: "apikey", apiKey: "test" });
  mocks.proxy.mockResolvedValue(proxy);
  mocks.update.mockResolvedValue(undefined);
  __setProviderTestFetchForTesting(fetcher);
  const saved = await testSingleConnection("hf");
  expect(saved.valid).toBe(status === 200);
  expect(!!saved.unavailable).toBe(status === 500 || status === 0);
  expect(fetcher.mock.calls[1][2]).toEqual(proxy);
  if (saved.unavailable) expect(mocks.update).not.toHaveBeenCalled();
});
