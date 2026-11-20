import { beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: network.fetch }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));

import { requestDeviceCode, pollForToken } from "../../src/lib/oauth/providers.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

describe("enterprise Copilot model discovery", () => {
  beforeEach(() => network.fetch.mockReset());

  it("uses the connection's scoped Copilot token and API host", async () => {
    network.fetch.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "tenant-model" }] })));
    const result = await fetchConnectionModels({ id: "tenant", provider: "ghe-copilot", accessToken: "fake-oauth", providerSpecificData: {
      gheUrl: "https://tenant.example.test", copilotApiUrl: "https://api.tenant.example.test", copilotToken: "fake-scoped",
    } });
    expect(result.models).toEqual([{ id: "tenant-model" }]);
    expect(network.fetch).toHaveBeenCalledWith("https://api.tenant.example.test/models", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer fake-scoped" }),
    }), {});
  });

  it("never sends an OAuth credential as a scoped model token", async () => {
    const result = await fetchConnectionModels({ id: "tenant", provider: "ghe-copilot", accessToken: "fake-oauth", providerSpecificData: { gheUrl: "https://tenant.example.test" } });
    expect(result.error).toBeTruthy();
    expect(network.fetch).not.toHaveBeenCalled();
  });
});

describe("enterprise OAuth entry points", () => {
  it("keeps two tenant identities and scoped tokens separate", async () => {
    const outbound = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const host = new URL(url).hostname;
      const tenant = host.split(".")[0];
      if (url.endsWith("/login/device/code")) return Response.json({ device_code: `device-${tenant}` });
      if (url.endsWith("/login/oauth/access_token")) return Response.json({ access_token: `oauth-${tenant}` });
      if (url.endsWith("/copilot_internal/v2/token")) return Response.json({ token: `scoped-${tenant}`, endpoints: { api: `https://api.${host}` } });
      if (url.endsWith("/api/v3/user")) return Response.json({ login: tenant });
      throw new Error(`Unexpected outbound request: ${url}`);
    });
    try {
      for (const tenant of ["alpha", "beta"]) {
        const url = `https://${tenant}.example.test`;
        const started = await requestDeviceCode("ghe-copilot", null, { gheUrl: url });
        const result = await pollForToken("ghe-copilot", started.device_code, null, { _gheUrl: started._gheUrl });
        expect(result.tokens).toMatchObject({ accessToken: `oauth-${tenant}`, providerSpecificData: {
          gheUrl: url, copilotToken: `scoped-${tenant}`, copilotApiUrl: `https://api.${tenant}.example.test`, githubLogin: tenant,
        } });
      }
      expect(outbound.mock.calls.every(([url]) => new URL(url).hostname.endsWith(".example.test"))).toBe(true);
    } finally { outbound.mockRestore(); }
  });
});
