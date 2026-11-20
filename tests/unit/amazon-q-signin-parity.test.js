import { afterEach, describe, expect, it, vi } from "vitest";
import { pollForToken, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

const json = (data) => new Response(JSON.stringify(data), { status: 200 });

afterEach(() => vi.restoreAllMocks());

describe("Amazon Q synthetic device flow", () => {
  it.each([
    ["builder-id", "us-east-1", undefined],
    ["idc", "eu-central-1", "https://example.awsapps.com/start"],
  ])("registers, polls and selects a profile for %s", async (authMethod, region, startUrl) => {
    const calls = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
      calls.push([url, options]);
      if (url.endsWith("/client/register")) return json({ clientId: "client", clientSecret: "secret" });
      if (url.endsWith("/device_authorization")) return json({ deviceCode: "device", userCode: "code" });
      if (url.endsWith("/token")) return json({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresIn: 3600 });
      if (url === (region === "us-east-1" ? "https://codewhisperer.us-east-1.amazonaws.com" : `https://q.${region}.amazonaws.com`)) {
        return json({ profiles: [{ arn: `arn:aws:codewhisperer:${region}:123:profile/test` }] });
      }
      throw new Error(`Unexpected outbound URL: ${url}`);
    });
    const device = await requestDeviceCode("amazon-q", undefined, { authMethod, region, startUrl });
    const result = await pollForToken("amazon-q", device.device_code, null, device);
    expect(result.success).toBe(true);
    expect(result.tokens.providerSpecificData).toMatchObject({ authMethod, region, clientId: "client", profileArn: `arn:aws:codewhisperer:${region}:123:profile/test` });
    expect(calls.map(([url]) => url)).toEqual([
      `https://oidc.${region}.amazonaws.com/client/register`,
      `https://oidc.${region}.amazonaws.com/device_authorization`,
      `https://oidc.${region}.amazonaws.com/token`,
      region === "us-east-1" ? "https://codewhisperer.us-east-1.amazonaws.com" : `https://q.${region}.amazonaws.com`,
    ]);
    expect(JSON.parse(calls[1][1].body).startUrl).toBe(startUrl || "https://view.awsapps.com/start");
  });

  it("rejects a malformed region before outbound traffic", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("unexpected outbound"); });
    await expect(requestDeviceCode("amazon-q", undefined, { region: "evil.example" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the Amazon Q executor identity and regional bearer request separate", () => {
    const q = new KiroExecutor("amazon-q");
    const kiro = new KiroExecutor("kiro");
    const credentials = { accessToken: "synthetic-q", providerSpecificData: { authMethod: "idc", region: "eu-central-1" } };
    expect(q.provider).toBe("amazon-q");
    expect(kiro.provider).toBe("kiro");
    expect(q.getOrderedBaseUrls(credentials)).toEqual([
      "https://q.eu-central-1.amazonaws.com/generateAssistantResponse",
      "https://runtime.eu-central-1.kiro.dev/generateAssistantResponse",
    ]);
    expect(q.buildHeaders(credentials).Authorization).toBe("Bearer synthetic-q");
  });
});
