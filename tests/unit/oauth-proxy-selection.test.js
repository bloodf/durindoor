import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProxyPoolById: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProxyPoolById: mocks.getProxyPoolById,
}));

import { mergeProviderSpecificData } from "@/lib/db/helpers/mergeProviderMetadata.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";
import {
  buildOAuthProxyMetadataPatch,
  parseOAuthProxySelection,
  resolveOAuthProxySelection,
} from "@/lib/oauth/proxySelection.js";

describe("OAuth proxy selection", () => {
  beforeEach(() => {
    mocks.getProxyPoolById.mockReset();
  });

  it("distinguishes omitted legacy routing from explicit direct routing", () => {
    expect(parseOAuthProxySelection()).toEqual({ mode: "legacy" });
    expect(parseOAuthProxySelection({})).toEqual({ mode: "legacy" });
    expect(parseOAuthProxySelection({ proxyPoolId: "" })).toEqual({ mode: "direct" });
    expect(parseOAuthProxySelection({ proxyPoolId: "   " })).toEqual({ mode: "direct" });
    expect(parseOAuthProxySelection({ proxyPoolId: "__none__" })).toEqual({ mode: "direct" });
    expect(parseOAuthProxySelection({ proxyMode: "direct", proxyPoolId: "stale-pool" }))
      .toEqual({ mode: "direct" });
  });

  it("normalizes a strict pool selection into an immutable, non-secret value", () => {
    const selection = parseOAuthProxySelection({
      proxyMode: "strict-pool",
      proxyPoolId: "pool-active",
      connectionProxyUrl: "http://user:secret@example.test:8080",
    });

    expect(selection).toEqual({ mode: "strict-pool", poolId: "pool-active" });
    expect(Object.isFrozen(selection)).toBe(true);
    expect(JSON.stringify(selection)).not.toContain("secret");
  });

  it.each([
    { proxyMode: null },
    { proxyMode: "" },
    { proxyMode: "transparent" },
    { proxyMode: "strict-pool" },
    { proxyMode: "strict-pool", proxyPoolId: "__none__" },
  ])("rejects an explicit invalid mode or incomplete strict selection (%j)", (input) => {
    expect(() => parseOAuthProxySelection(input)).toThrow(expect.objectContaining({
      code: "OAUTH_PROXY_SELECTION_INVALID",
    }));
  });

  it("disables environment proxies for explicit direct routing", async () => {
    const resolved = await resolveOAuthProxySelection({ proxyMode: "direct" });

    expect(resolved.proxyOptions).toEqual({
      disableEnvProxy: true,
      strictProxy: false,
    });
    expect(mocks.getProxyPoolById).not.toHaveBeenCalled();
  });

  it("resolves an active pool and makes OAuth pool routing fail closed", async () => {
    mocks.getProxyPoolById.mockResolvedValue({
      id: "pool-active",
      isActive: true,
      type: "http",
      proxyUrl: "http://proxy.example.test:8080",
      noProxy: "localhost",
      strictProxy: false,
    });

    const resolved = await resolveOAuthProxySelection({
      proxyMode: "strict-pool",
      proxyPoolId: "pool-active",
    });

    expect(resolved.proxyOptions).toEqual({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example.test:8080",
      connectionNoProxy: "localhost",
      vercelRelayUrl: "",
      proxyPoolId: "pool-active",
      disableEnvProxy: true,
      strictProxy: true,
    });
  });

  it("supports strict relay pools without exposing the pool object", async () => {
    mocks.getProxyPoolById.mockResolvedValue({
      id: "relay-active",
      isActive: true,
      type: "cloudflare",
      proxyUrl: "https://relay.example.test",
      secretDeploymentField: "must-not-escape",
    });

    const resolved = await resolveOAuthProxySelection({
      proxyMode: "strict-pool",
      proxyPoolId: "relay-active",
    });

    expect(resolved.proxyOptions).toMatchObject({
      connectionProxyEnabled: false,
      vercelRelayUrl: "https://relay.example.test",
      disableEnvProxy: true,
      strictProxy: true,
    });
    expect(JSON.stringify(resolved)).not.toContain("secretDeploymentField");
  });

  it.each([
    null,
    { id: "pool-active", isActive: false, type: "http", proxyUrl: "http://proxy.test" },
    { id: "pool-active", isActive: true, type: "http", proxyUrl: "" },
  ])("rejects an unavailable strict pool without falling back (%j)", async (pool) => {
    mocks.getProxyPoolById.mockResolvedValue(pool);

    await expect(resolveOAuthProxySelection({
      proxyMode: "strict-pool",
      proxyPoolId: "pool-active",
    })).rejects.toMatchObject({ code: "OAUTH_PROXY_POOL_UNAVAILABLE" });
  });

  it("clears a previous pool while preserving unrelated provider metadata", () => {
    const existing = {
      accountId: "account-1",
      proxyPoolId: "old-pool",
      nested: { keep: true },
      oauthProxy: { mode: "strict-pool", poolId: "old-pool", keep: "value" },
    };

    const merged = mergeProviderSpecificData(
      existing,
      buildOAuthProxyMetadataPatch({ proxyMode: "direct" })
    );

    expect(merged).toEqual({
      accountId: "account-1",
      proxyPoolId: null,
      nested: { keep: true },
      oauthProxy: { mode: "direct", poolId: null, keep: "value" },
    });
  });
});

describe("connection proxy OAuth metadata", () => {
  beforeEach(() => {
    mocks.getProxyPoolById.mockReset();
  });

  it("lets nested direct metadata override stale top-level pool data", async () => {
    const result = await resolveConnectionProxyConfig({
      proxyPoolId: "stale-pool",
      oauthProxy: { mode: "direct", poolId: "stale-pool" },
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://legacy.test:8080",
    });

    expect(result).toMatchObject({
      source: "direct",
      proxyPoolId: null,
      connectionProxyEnabled: false,
      disableEnvProxy: true,
      strictProxy: false,
    });
    expect(mocks.getProxyPoolById).not.toHaveBeenCalled();
  });

  it("keeps legacy top-level empty/null pool fields backward compatible", async () => {
    const legacy = await resolveConnectionProxyConfig({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://legacy.test:8080",
    });
    const blank = await resolveConnectionProxyConfig({
      proxyPoolId: "   ",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://legacy.test:8080",
    });
    const nullable = await resolveConnectionProxyConfig({
      proxyPoolId: null,
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://legacy.test:8080",
    });

    expect(legacy).toMatchObject({ source: "legacy", disableEnvProxy: false });
    expect(blank).toMatchObject({ source: "legacy", disableEnvProxy: false });
    expect(nullable).toMatchObject({ source: "legacy", disableEnvProxy: false });
  });

  it("returns a fail-closed result for unavailable nested strict-pool metadata", async () => {
    mocks.getProxyPoolById.mockResolvedValue(null);

    const result = await resolveConnectionProxyConfig({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://legacy.test:8080",
      oauthProxy: { mode: "strict-pool", poolId: "missing-pool" },
    });

    expect(result).toMatchObject({
      source: "error",
      reason: "proxy_pool_unavailable",
      proxyPoolId: "missing-pool",
      connectionProxyEnabled: false,
      disableEnvProxy: true,
      strictProxy: true,
    });
  });
});
