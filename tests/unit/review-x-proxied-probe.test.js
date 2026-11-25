import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch as undiciFetch } from "undici";

const mocks = vi.hoisted(() => ({ proxyFetch: vi.fn(), lookup: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyFetch }));
vi.mock("node:dns", () => ({ lookup: (...args) => mocks.lookup(...args) }));

import { probeConnectionHealth } from "../../src/lib/providerHealthProbe.js";

const connection = {
  provider: "openai-compatible-probe",
  providerSpecificData: { baseUrl: "https://provider.example.test/v1" },
};
const proxyConfig = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example.test:8080" };

describe("proxied health probes", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([proxyConfig, { vercelRelayUrl: "https://relay.example.test" }])(
    "reaches configured egress and returns the upstream status: %j", async (config) => {
      mocks.proxyFetch.mockResolvedValue({ ok: false, status: 401 });
      const result = await probeConnectionHealth(connection, { proxyConfig: config });
      expect(result).toMatchObject({ valid: false, status: 401 });
      expect(mocks.proxyFetch.mock.calls[0][1]).not.toHaveProperty("dispatcher");
      expect(mocks.proxyFetch).toHaveBeenCalledWith(
        "https://provider.example.test/v1/models",
        expect.objectContaining({ redirect: "manual" }),
        expect.objectContaining({ ...config, strictProxy: true }),
      );
    },
  );

  it("reports a strict proxy failure as blocked without a direct request", async () => {
    mocks.proxyFetch.mockRejectedValue(new Error("proxy unavailable"));
    const direct = vi.spyOn(globalThis, "fetch");
    try {
      const result = await probeConnectionHealth(connection, { proxyConfig });
      expect(result).toMatchObject({ valid: false, status: null, blocked: true });
      expect(mocks.proxyFetch).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ strictProxy: true }));
      expect(direct).not.toHaveBeenCalled();
    } finally {
      direct.mockRestore();
    }
  });

  it("validates DNS addresses on the unproxied path", async () => {
    mocks.lookup.mockImplementation((_host, _options, callback) => callback(null, [{ address: "169.254.169.254", family: 4 }]));
    const result = await probeConnectionHealth(connection, { proxyConfig: null, fetcher: undiciFetch });
    expect(result).toMatchObject({ valid: false, status: null, blocked: true });
    expect(mocks.lookup).toHaveBeenCalled();
    expect(mocks.proxyFetch).not.toHaveBeenCalled();
  });
});
