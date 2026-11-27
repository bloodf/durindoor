import { afterEach, describe, expect, it, vi } from "vitest";
import { pollForToken, requestDeviceCode } from "../../src/lib/oauth/providers.js";

afterEach(() => vi.unstubAllGlobals());

describe("Qoder regional device sign-in", () => {
  it("keeps simultaneous regional login credentials and profile requests separate", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const parsed = new URL(url);
      const cn = parsed.hostname.endsWith(".com.cn");
      if (parsed.pathname.endsWith("/deviceToken/poll")) {
        return Response.json({ token: cn ? "fake-cn" : "fake-intl", user_id: cn ? "cn-user" : "intl-user" });
      }
      if (parsed.pathname.endsWith("/userinfo")) {
        expect(init.headers.Authorization).toBe(`Bearer fake-${cn ? "cn" : "intl"}`);
        return Response.json({ email: cn ? "cn@example.invalid" : "intl@example.invalid" });
      }
      throw new Error(`Unexpected outbound request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const intl = await requestDeviceCode("qoder");
    const cn = await requestDeviceCode("qoder-cn");
    expect(new URL(intl.verification_uri_complete).hostname).toBe("qoder.com");
    expect(new URL(cn.verification_uri_complete).hostname).toBe("qoder.com.cn");
    expect(intl.device_code).not.toBe(cn.device_code);
    expect(intl.codeVerifier).not.toBe(cn.codeVerifier);
    const [a, b] = await Promise.all([
      pollForToken("qoder", intl.device_code, intl.codeVerifier, intl),
      pollForToken("qoder-cn", cn.device_code, cn.codeVerifier, cn),
    ]);
    expect(a.tokens.accessToken).toBe("fake-intl");
    expect(b.tokens.accessToken).toBe("fake-cn");
    expect(a.tokens.providerSpecificData).toMatchObject({ userId: "intl-user", machineId: intl._qoderMachineId });
    expect(b.tokens.providerSpecificData).toMatchObject({ userId: "cn-user", machineId: cn._qoderMachineId });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [url] of fetchMock.mock.calls.filter(([url]) => url.includes("deviceToken/poll"))) {
      const parsed = new URL(url);
      const flow = parsed.hostname.endsWith(".com.cn") ? cn : intl;
      expect(parsed.searchParams.get("nonce")).toBe(flow.device_code);
      expect(parsed.searchParams.get("verifier")).toBe(flow.codeVerifier);
    }
  });
});

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { clearQoderCatalog, resolveQoderModels } from "../../open-sse/services/catalogs/qoderModels.js";

describe("Qoder catalog credential isolation", () => {
  it("does not reuse a catalog for another credential with the same regional user ID", async () => {
    clearQoderCatalog();
    vi.mocked(proxyAwareFetch).mockReset();
    vi.mocked(proxyAwareFetch)
      .mockResolvedValueOnce(Response.json({ chat: [{ key: "account-a", display_name: "A" }] }))
      .mockResolvedValueOnce(Response.json({ chat: [{ key: "account-b", display_name: "B" }] }));
    const credentials = (accessToken) => ({ provider: "qoder", accessToken, providerSpecificData: { userId: "same-user" } });
    const a = await resolveQoderModels(credentials("fake-token-a"));
    const b = await resolveQoderModels(credentials("fake-token-b"));
    expect(a.rawConfigs.has("account-a")).toBe(true);
    expect(b.rawConfigs.has("account-b")).toBe(true);
    expect(b.rawConfigs.has("account-a")).toBe(false);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });
});

import { QoderExecutor } from "../../open-sse/executors/qoder.js";

describe("Qoder device token refresh", () => {
  it.each(["qoder", "qoder-cn"])("does not send a refresh request for %s", async (provider) => {
    const fetchMock = vi.fn(() => { throw new Error("Unexpected outbound request"); });
    vi.stubGlobal("fetch", fetchMock);
    const executor = new QoderExecutor(provider);
    expect(executor.needsRefresh({ accessToken: "fake", refreshToken: "fake-refresh" })).toBe(false);
    expect(await executor.refreshCredentials({ accessToken: "fake", refreshToken: "fake-refresh" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
