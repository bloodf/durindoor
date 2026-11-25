import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn().mockResolvedValue([]),
  getSettings: vi.fn().mockResolvedValue({ providerStrategies: { mimocode: { rotateStrategy: "session" } } }),
  getProxyPools: vi.fn().mockResolvedValue([
    { id: "a", proxyUrl: "http://a.test", isActive: true },
    { id: "b", proxyUrl: "http://b.test", isActive: true },
    { id: "c", proxyUrl: "http://c.test", isActive: true },
  ]),
}));

vi.mock("@/lib/localDb", () => ({
  getProxyPoolById: async (id) => (await mocks.getProxyPools()).find((pool) => pool.id === id),
  ...mocks,
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn()}));

import { pickProxyPoolId } from "../../src/lib/network/connectionProxy.js";
import { getProviderCredentials } from "../../src/sse/services/auth.js";

describe("OmniRoute #21104 b0acbc121d04 and 16f86647f3b7 session proxy rotation", () => {
  it("keeps assignments across reorder and only remaps sessions assigned to a removed pool", () => {
    const pools = ["a", "b", "c", "d"];
    const keys = Array.from({ length: 100 }, (_, i) => `session-${i}`);
    const before = keys.map((key) => pickProxyPoolId(pools, "session", "provider", key));
    expect(new Set(before).size).toBeGreaterThan(1);
    for (const [i, key] of keys.entries()) {
      expect(pickProxyPoolId([...pools].reverse(), "session", "provider", key)).toBe(before[i]);
      const after = pickProxyPoolId(pools.filter((id) => id !== "b"), "session", "provider", key);
      if (before[i] === "b") expect(after).not.toBe("b");
      else expect(after).toBe(before[i]);
      expect(pickProxyPoolId(pools, "session", "provider", key)).toBe(before[i]);
    }
  });

  it("uses round-robin without a session", () => {
    expect(Array.from({ length: 3 }, () => pickProxyPoolId(["a", "b"], "session", "no-session-test"))).toEqual(["a", "b", "a"]);
  });

  it("passes the chat routing session through to active public proxy pools", async () => {
    const sessionId = "routing-session";
    const expected = pickProxyPoolId(["a", "b", "c"], "session", "mimocode", sessionId);
    const credential = await getProviderCredentials("mimocode", null, null, { sessionId });
    expect(credential.providerSpecificData.connectionProxyPoolId).toBe(expected);
  });
});
