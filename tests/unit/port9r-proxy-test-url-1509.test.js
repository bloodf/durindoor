import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), agent: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", async (original) => ({
  ...(await original()),
  ProxyAgent: vi.fn().mockImplementation(function (options) { mocks.agent(options); return { close: async () => {} }; }),
  fetch: mocks.fetch,
}));
const { testProxyUrl } = await import("../../src/lib/network/proxyTest.js");
describe("custom proxy test destinations", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("pins public DNS to the proxy and preserves TLS identity", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK", headers: new Headers() });
    const result = await testProxyUrl({ proxyUrl: "http://proxy:8080", testUrl: "https://example.com/path" });
    expect(result.url).toBe("https://example.com/path");
    expect(String(mocks.fetch.mock.calls[0][0])).toBe("https://93.184.216.34/path");
    expect(mocks.fetch.mock.calls[0][1].headers.Host).toBe("example.com");
    expect(mocks.agent).toHaveBeenLastCalledWith(expect.objectContaining({ requestTls: { servername: "example.com" } }));
  });
  it("rejects mixed public and private DNS answers before connecting", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    const result = await testProxyUrl({ proxyUrl: "http://proxy:8080", testUrl: "https://example.com/" });
    expect(result.ok).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects a redirect to a private target", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mocks.fetch.mockResolvedValue({ status: 302, headers: new Headers({ location: "https://127.0.0.1/" }) });
    const result = await testProxyUrl({ proxyUrl: "http://proxy:8080", testUrl: "https://example.com/" });
    expect(result.ok).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("rechecks DNS on a redirect and blocks rebinding", async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    mocks.fetch.mockResolvedValue({ status: 302, headers: new Headers({ location: "https://example.com/again" }) });
    const result = await testProxyUrl({ proxyUrl: "http://proxy:8080", testUrl: "https://example.com/" });
    expect(result.ok).toBe(false);
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

});
