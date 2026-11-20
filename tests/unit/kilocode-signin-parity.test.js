import { afterEach, describe, expect, it, vi } from "vitest";
import { pollForToken, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { getExecutor } from "../../open-sse/executors/index.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

describe("Kilo Code device sign-in", () => {
  it("initiates and polls the device flow, preserving the approved credential", async () => {
    const fetch = vi.fn(async (url, options = {}) => {
      if (url === "https://api.kilo.ai/api/device-auth/codes" && options.method === "POST") return json({ code: "fake-code", verificationUrl: "https://example.test/verify", expiresIn: 120 });
      if (url === "https://api.kilo.ai/api/device-auth/codes/fake-code") return json({ status: "approved", token: "fake-oauth", userEmail: "user@example.test" });
      if (url === "https://api.kilo.ai/api/profile") {
        expect(options.headers.Authorization).toBe("Bearer fake-oauth");
        return json({ organizations: [{ id: "fake-org" }] });
      }
      throw new Error(`Unexpected outbound request: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    expect(await requestDeviceCode("kilocode")).toMatchObject({ device_code: "fake-code", expires_in: 120, interval: 3 });
    const result = await pollForToken("kilocode", "fake-code");
    expect(result).toEqual({ success: true, tokens: { accessToken: "fake-oauth", refreshToken: null, expiresIn: null, email: "user@example.test", providerSpecificData: { orgId: "fake-org" } } });
    const executor = getExecutor("kilocode");
    expect(executor.buildUrl("example/model", false)).toBe("https://api.kilo.ai/api/openrouter/chat/completions");
    expect(executor.buildHeaders(result.tokens, false)).toMatchObject({ Authorization: "Bearer fake-oauth", "X-Kilocode-OrganizationID": "fake-org" });
    expect(getExecutor("kilo-gateway").buildHeaders({ apiKey: "fake-key" }, false)).toMatchObject({ Authorization: "Bearer fake-key" });
    expect(getExecutor("kilo-gateway").buildHeaders({ apiKey: "fake-key" }, false)).not.toHaveProperty("X-Kilocode-OrganizationID");
  });

  it.each([[202, "authorization_pending"], [403, "access_denied"], [410, "expired_token"]])("maps poll status %i", async (status, error) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
    expect(await pollForToken("kilocode", "fake-code")).toMatchObject({ success: false, error });
  });
});
