/**
 * Profile → Network → Firecrawl URL is the only dashboard control for the
 * self-hosted Firecrawl host, while a saved firecrawl_custom row's own baseUrl
 * wins at request time. Saving the setting must update the rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProviderConnections: vi.fn(), updateProviderConnection: vi.fn(async () => ({})) }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  createProviderConnection: vi.fn(),
  updateProviderConnection: mocks.updateProviderConnection
}));

const { syncFirecrawlCustomHost } = await import("../../src/lib/firecrawl/firecrawlConfig.js");

describe("syncFirecrawlCustomHost", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes the new setting onto saved rows with a different host", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "a", providerSpecificData: { baseUrl: "http://127.0.0.1:3002" } },
      { id: "b", providerSpecificData: { baseUrl: "http://192.168.1.40:3002" } }
    ]);
    await syncFirecrawlCustomHost("http://192.168.1.40:3002");
    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ provider: "firecrawl_custom" });
    expect(mocks.updateProviderConnection.mock.calls).toEqual([["a", { providerSpecificData: { baseUrl: "http://192.168.1.40:3002" } }]]);
  });

  it("clears the row host when the setting is cleared", async () => {
    mocks.getProviderConnections.mockResolvedValue([{ id: "a", providerSpecificData: { baseUrl: "http://127.0.0.1:3002" } }]);
    await syncFirecrawlCustomHost("");
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("a", { providerSpecificData: { baseUrl: "" } });
  });
});
