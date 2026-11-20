import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "../../src/lib/oauth/providers.js";

afterEach(() => vi.unstubAllGlobals());

describe("Kiro device registration", () => {
  it("retains the configured issuer for Builder ID", async () => {
    const provider = getProvider("kiro");
    const fetchMock = vi.fn(async (url, init) => {
      if (url === "https://oidc.us-east-1.amazonaws.com/client/register") {
        expect(JSON.parse(init.body).issuerUrl).toBe(provider.config.issuerUrl);
        return Response.json({ clientId: "fake-client", clientSecret: "fake-secret" });
      }
      if (url === "https://oidc.us-east-1.amazonaws.com/device_authorization") {
        return Response.json({ deviceCode: "fake-device", userCode: "fake-code" });
      }
      throw new Error(`Unexpected outbound request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await provider.requestDeviceCode(provider.config, null, {});
    expect(result._authMethod).toBe("builder-id");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not bind an IAM Identity Center client to the Builder ID issuer", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      if (url === "https://oidc.eu-north-1.amazonaws.com/client/register") {
        expect(body).not.toHaveProperty("issuerUrl");
        return Response.json({ clientId: "fake-client", clientSecret: "fake-secret" });
      }
      if (url === "https://oidc.eu-north-1.amazonaws.com/device_authorization") {
        expect(body.startUrl).toBe("https://example.awsapps.com/start");
        return Response.json({ deviceCode: "fake-device", userCode: "fake-code" });
      }
      throw new Error(`Unexpected outbound request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = getProvider("kiro");
    const result = await provider.requestDeviceCode(provider.config, null, {
      authMethod: "idc", region: "eu-north-1", startUrl: "https://example.awsapps.com/start"
    });
    expect(result._authMethod).toBe("idc");
    expect(result._region).toBe("eu-north-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
