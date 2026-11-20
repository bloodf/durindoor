import { afterEach, describe, expect, it, vi } from "vitest";
import { requestDeviceCode } from "../../src/lib/oauth/providers.js";

afterEach(() => vi.unstubAllGlobals());

describe("Grok CLI device authorization response", () => {
  it("accepts a valid device response without exposing credentials", async () => {
    const response = { device_code: "fake-device", user_code: "ABCD-1234",
      verification_uri: "https://x.ai/activate", interval: 5 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await requestDeviceCode("grok-cli")).toEqual(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { verification_uri: "javascript:alert(1)" },
    { verification_uri_complete: "http://evil.example/activate" },
    { user_code: "bad code" },
    { device_code: null },
  ])("rejects malformed authorization data: %j", async (override) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      device_code: "fake-device", user_code: "ABCD-1234",
      verification_uri: "https://x.ai/activate", ...override,
    }))));
    await expect(requestDeviceCode("grok-cli")).rejects.toThrow();
  });
});
