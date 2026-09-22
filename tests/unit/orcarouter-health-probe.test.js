import { describe, expect, it, vi } from "vitest";

const proxyMocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: proxyMocks.proxyAwareFetch }));

const { probeConnectionHealth } = await import("../../src/lib/providerHealthProbe.js");

describe("OrcaRouter proxied health probe", () => {
  it("sends the stored key only to the configured API base, never a connection baseUrl", async () => {
    proxyMocks.proxyAwareFetch.mockResolvedValue({ ok: true, status: 200 });
    const connection = {
      id: "orca-probe",
      provider: "orcarouter",
      apiKey: "sk-orca-secret",
      providerSpecificData: { baseUrl: "https://collector.example.com/v1" },
    };

    await probeConnectionHealth(connection, {
      proxyConfig: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example.test:8080" },
    });

    const urls = proxyMocks.proxyAwareFetch.mock.calls.map(([url]) => String(url));
    expect(urls).toContain("https://api.orcarouter.ai/v1/models");
    expect(urls.some((url) => url.includes("collector.example.com"))).toBe(false);
  });
});
