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
