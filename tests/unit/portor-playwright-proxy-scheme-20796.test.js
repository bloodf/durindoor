import { describe, expect, it, vi } from "vitest";

const launch = vi.hoisted(() => vi.fn());
vi.mock("playwright", () => ({ chromium: { launch, connectOverCDP: vi.fn() } }));

const { acquireBrowserContext, resolvePlaywrightProxy } = await import("../../open-sse/services/browserPool.js");

describe("OmniRoute #20796 — unsupported browser proxy schemes fail closed", () => {
  it.each([
    ["socks", "socks5"], ["socks5", "socks5"], ["SOCKS5H", "socks5"],
    ["socks4", "socks4"], ["socks4a", "socks4"],
    ["http", "http"], ["https", "https"],
  ])("maps %s:// to %s://", (scheme, expected) => {
    expect(resolvePlaywrightProxy(`${scheme}://proxy.test:1080`)).toEqual({ server: `${expected}://proxy.test:1080` });
  });

  it.each(["socks6://proxy.test:1080", "socksx://proxy.test:1080", "ftp://proxy.test:21", "secretuser:pw@proxy.test:1080"])(
    "rejects %s without echoing it", (proxyUrl) => {
      expect(() => resolvePlaywrightProxy(proxyUrl)).toThrow(/^Unsupported browser proxy scheme; refusing to use this proxy$/);
    });

  it("launches no browser for a pooled context with a rejected proxy", async () => {
    await expect(acquireBrowserContext("scheme-test", { proxyUrl: "socks6://proxy.test:1080" }))
      .rejects.toThrow("Unsupported browser proxy scheme");
    expect(launch).not.toHaveBeenCalled();
  });
});
