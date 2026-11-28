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
  // register-auth-02 wired the staged Qwen handler, which reports a fixed
  // message and protocol state instead of upstream text (#2034 no-leak rule).
  it("surfaces a device authorization failure", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const promise = requestDeviceCode("qwen", "challenge");
    await expect(promise).rejects.toThrow("Qwen device authorization failed");
    const error = await promise.catch((caught) => caught);
    expect(error.message).toBe("Qwen device authorization failed");
    expect(error.message).not.toContain("unavailable");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("returns the provider's slow-down response without issuing tokens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "slow_down", error_description: "wait" }), { status: 400 })));
    const result = await pollForToken("qwen", "device", "verifier");
    expect(result).toMatchObject({ success: false, error: "slow_down" });
    expect(result).not.toHaveProperty("tokens");
    expect(JSON.stringify(result)).not.toContain("wait");
  });

  it("fails closed when refresh is rejected", async () => {
    proxyAwareFetch.mockResolvedValue(new Response("invalid grant", { status: 400 }));
    expect(await refreshQwenToken("fake-refresh")).toBeNull();
    expect(proxyAwareFetch).toHaveBeenCalledOnce();
  });
});
