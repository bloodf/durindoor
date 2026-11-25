import { describe, expect, it, vi } from "vitest";
import { redactHeaders, redactValue } from "../../src/lib/observability/redact.js";

const { undiciFetchMock, proxyAgentMock, socksDispatcherMock } = vi.hoisted(() => ({
  undiciFetchMock: vi.fn(),
  socksDispatcherMock: vi.fn(() => ({ close: vi.fn() })),
  proxyAgentMock: vi.fn(function ProxyAgentMock() { return { close: vi.fn() }; }),
}));
vi.mock("undici", () => ({ ProxyAgent: proxyAgentMock, fetch: (...args) => undiciFetchMock(...args) }));
vi.mock("../../open-sse/utils/socksDispatcher.js", () => ({
  createSocksDispatcher: socksDispatcherMock,
  isSocksDispatcherUrl: (url) => url.startsWith("socks"),
}));

const { testProxyUrl } = await import("../../src/lib/network/proxyTest.js");

describe("review regressions: redaction and proxy URL parsing", () => {
  it("redacts sensitive key substrings, relay headers, URL userinfo and OAuth query params", () => {
    const value = redactValue({
      password: "hunter2", client_secret: "abc", secret: "s", sudoPassword: "p",
      proxyUrl: "http://u:p@h:1", url: "https://x/y?code=AUTH&client_secret=zzz&access_token=t",
    });
    expect(value).toEqual({
      password: "[redacted]", client_secret: "[redacted]", secret: "[redacted]", sudoPassword: "[redacted]",
      proxyUrl: "http://[redacted]@h:1", url: "https://x/y?code=%5Bredacted%5D&client_secret=%5Bredacted%5D&access_token=%5Bredacted%5D",
    });
    expect(redactHeaders({ "x-relay-key": "d" })).toEqual({ "x-relay-key": "[redacted]" });
  });

  it("preserves https and socks schemes and uses the final @ in proxy credentials", async () => {
    undiciFetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK", headers: { get: () => null } });
    proxyAgentMock.mockClear();
    await testProxyUrl({ proxyUrl: "https://alice:p@ss@proxy.example:8080" });
    expect(proxyAgentMock.mock.calls.at(-1)[0].uri).toMatch(/^https:\/\/alice:p%40ss@proxy\.example:8080\/?$/);
    await testProxyUrl({ proxyUrl: "socks5://alice:secret@proxy.example:1080" });
    expect(socksDispatcherMock.mock.calls.at(-1)[0]).toMatch(/^socks5:\/\/alice:secret@proxy\.example:1080\/?$/);
  });
});
