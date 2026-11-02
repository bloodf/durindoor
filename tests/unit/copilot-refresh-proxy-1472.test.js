// #1472: the src token-refresh wrapper must hand the connection proxy to the
// open-sse Copilot refresh in the proxyOptions slot, not the log slot.
import { describe, expect, it, vi } from "vitest";

const refreshCopilotToken = vi.fn(async () => ({ token: "copilot-token", expiresAt: 1 }));
vi.mock("open-sse/services/tokenRefresh.js", async (importOriginal) => ({
  ...(await importOriginal()),
  refreshCopilotToken,
}));
vi.mock("@/lib/localDb.js", () => ({ updateProviderConnection: vi.fn(async () => {}) }));

const { refreshCopilotToken: wrapper } = await import("@/sse/services/tokenRefresh.js");

describe("#1472 Copilot refresh proxy slot", () => {
  it("passes the proxy as the third argument after the logger", async () => {
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080" };
    await wrapper("gh-token", proxyOptions);
    const [token, log, proxy] = refreshCopilotToken.mock.calls[0];
    expect(token).toBe("gh-token");
    expect(typeof log?.info).toBe("function");
    expect(proxy).toBe(proxyOptions);
  });
});
