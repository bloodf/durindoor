/**
 * Unit tests for the CommandCode per-connection health-check probe in
 * testApiKeyConnection (src/app/api/providers/[id]/test/testUtils.js),
 * exercised via the exported testSingleConnection.
 *
 * Regression coverage for: the dashboard's per-connection "Test" button
 * routes through testApiKeyConnection's provider switch. Before this PR,
 * neither `case "commandcode"` nor `case "command-code"` existed here
 * (unlike /api/providers/validate, which already had a probe), so every
 * saved CommandCode/command-code connection reported "Provider test not
 * supported" even for a valid key. This PR adds `case "commandcode"` plus
 * the `case "command-code"` alias so both saved ids route through the same
 * probe. See open-sse/providers/registry/commandcode.js and command-code.js.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    vercelRelayUrl: "",
  }),
}));

const originalFetch = global.fetch;

describe("CommandCode connection health check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("probes the CommandCode endpoint and reports valid on a 200 (happy path)", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-cc",
      provider: "commandcode",
      authType: "apikey",
      apiKey: "user_test",
      providerSpecificData: {},
    });
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url, options) => {
      expect(String(url)).toBe("https://api.commandcode.ai/alpha/generate");
      expect(options.headers.Authorization).toBe("Bearer user_test");
      return new Response("{}", { status: 200 });
    });

    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const result = await testSingleConnection("conn-cc");

    expect(result.valid).toBe(true);
    expect(result.error).not.toBe("Provider test not supported");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reports invalid on a 401 from the probe", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-cc",
      provider: "commandcode",
      authType: "apikey",
      apiKey: "bad-key",
      providerSpecificData: {},
    });
    global.fetch = vi.fn(async () => new Response("", { status: 401 }));

    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const result = await testSingleConnection("conn-cc");

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid API key");
  });

  it("reports invalid on a 403 from the probe for the hyphenated 'command-code' id", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-cc2",
      provider: "command-code",
      authType: "apikey",
      apiKey: "bad-key",
      providerSpecificData: {},
    });
    global.fetch = vi.fn(async () => new Response("", { status: 403 }));

    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const result = await testSingleConnection("conn-cc2");

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid API key");
  });

  it("does not fall through to the generic 'not supported' default for either id", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-cc3",
      provider: "command-code",
      authType: "apikey",
      apiKey: "user_test",
      providerSpecificData: {},
    });
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const result = await testSingleConnection("conn-cc3");

    expect(result.error).not.toBe("Provider test not supported");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.commandcode.ai/alpha/generate",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
