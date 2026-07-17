import { describe, it, expect, beforeEach, vi } from "vitest";
import { doRefresh } from "../../src/lib/mcp/gateway/oauthRefresh.js";
import { updateInstance, getInstanceById } from "../../src/lib/localDb";

vi.mock("open-sse/utils/outboundUrlGuard.js", () => ({
  assertOutboundUrlAllowed: () => {},
  OutboundUrlGuardError: class OutboundUrlGuardError extends Error {},
}));

vi.mock("../../src/lib/localDb", () => ({
  updateInstance: vi.fn(),
  getInstanceById: vi.fn(),
}));

function makeInstance() {
  return {
    id: "inst-refresh",
    slug: "refresh-test",
    oauthTokens: {
      access_token: "old-token",
      refresh_token: "refresh-1",
      token_endpoint: "https://auth.example.com/token",
      client_id: "client",
      client_secret: "secret",
      expires_at: Date.now() - 1_000,
    },
  };
}

function mockRedirectResponse(location, origin = "https://auth.example.com") {
  return {
    ok: false,
    status: 302,
    headers: {
      get: (k) => (k.toLowerCase() === "location" ? location : null),
    },
    text: async () => "",
    json: async () => null,
  };
}

function mockTokenResponse(token = "new-token") {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify({ access_token: token, expires_in: 3600 }),
    json: async () => ({ access_token: token, expires_in: 3600 }),
  };
}

describe("doRefresh — redirect limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateInstance.mockResolvedValue({});
  });

  it("defaults to 10 hops and follows valid same-origin redirects", async () => {
    const instance = makeInstance();
    let hopCount = 0;
    global.fetch = vi.fn(async () => {
      hopCount++;
      if (hopCount < 3) {
        return mockRedirectResponse(`https://auth.example.com/token${hopCount + 1}`);
      }
      return mockTokenResponse("final-token");
    });

    const result = await doRefresh(instance, {
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "client",
      clientSecret: "secret",
    });

    expect(result.access_token).toBe("final-token");
    expect(hopCount).toBe(3);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(updateInstance).toHaveBeenCalledWith(instance.id, expect.objectContaining({
      oauthTokens: expect.objectContaining({ access_token: "final-token" }),
    }));
  });

  it("throws when redirects exceed the configured max", async () => {
    const instance = makeInstance();
    global.fetch = vi.fn(async () => mockRedirectResponse("https://auth.example.com/loop"));

    await expect(doRefresh(instance, {
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "client",
      clientSecret: "secret",
      maxRedirects: 2,
    })).rejects.toThrow(/exceeded maximum 2 redirect/);
  });

  it("throws when a redirect crosses origin", async () => {
    const instance = makeInstance();
    global.fetch = vi.fn(async () => mockRedirectResponse("https://evil.example.com/token"));

    await expect(doRefresh(instance, {
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "client",
      clientSecret: "secret",
    })).rejects.toThrow(/crossed origin/);
  });

  it("forwards maxRedirects from oauthMetaFromTokens", async () => {
    const { oauthMetaFromTokens } = await import("../../src/lib/mcp/gateway/oauthRefresh.js");
    const meta = oauthMetaFromTokens({
      token_endpoint: "https://auth.example.com/token",
      client_id: "client",
      maxRedirects: 5,
    });
    expect(meta.maxRedirects).toBe(5);
  });
});
