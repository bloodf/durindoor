import { afterEach, describe, expect, it, vi } from "vitest";
import { pollForToken, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { refreshQwenToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("retained Qwen OAuth error paths", () => {
  it("surfaces a device authorization failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(requestDeviceCode("qwen", "challenge")).rejects.toThrow("Device code request failed: unavailable");
  });

  it("returns the provider's slow-down response without issuing tokens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "slow_down", error_description: "wait" }), { status: 400 })));
    expect(await pollForToken("qwen", "device", "verifier")).toEqual({ success: false, error: "slow_down", errorDescription: "wait" });
  });

  it("fails closed when refresh is rejected", async () => {
    proxyAwareFetch.mockResolvedValue(new Response("invalid grant", { status: 400 }));
    expect(await refreshQwenToken("fake-refresh")).toBeNull();
    expect(proxyAwareFetch).toHaveBeenCalledOnce();
  });
});
