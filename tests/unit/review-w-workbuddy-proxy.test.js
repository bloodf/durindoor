import { afterEach, describe, expect, it, vi } from "vitest";
import workbuddy from "../../src/lib/oauth/workbuddyProvider.js";

afterEach(() => vi.unstubAllGlobals());

describe("WorkBuddy OAuth proxy forwarding", () => {
  it("uses the selected proxy for device-code and token requests", async () => {
    const proxyOptions = { proxyUrl: "http://proxy.invalid:8080", strictProxy: true };
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 0, data: { state: "state", authUrl: "https://workbuddy.invalid/login" } }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { accessToken: "access" } }));
    vi.stubGlobal("fetch", fetch);

    await workbuddy.requestDeviceCode(workbuddy.config, undefined, {}, proxyOptions);
    await workbuddy.pollToken(workbuddy.config, "state", undefined, undefined, proxyOptions);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].proxyOptions).toBe(proxyOptions);
    expect(fetch.mock.calls[1][1].proxyOptions).toBe(proxyOptions);
  });
});
