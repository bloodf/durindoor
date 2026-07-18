import { vi, describe, it, expect, beforeEach } from "vitest";
import { mcpRequest } from "../../src/lib/mcp/gateway/httpClient.js";
import { updateInstance, getInstanceById } from "../../src/lib/localDb";

vi.mock("open-sse/utils/outboundUrlGuard.js", () => ({
  assertOutboundUrlAllowed: () => {},
  OutboundUrlGuardError: class OutboundUrlGuardError extends Error {},
}));

vi.mock("../../src/lib/mcp/gateway/oauthRefresh.js", async () => {
  const actual = await vi.importActual("../../src/lib/mcp/gateway/oauthRefresh.js");
  return { ...actual, ensureFreshToken: (i) => i };
});

vi.mock("../../src/lib/localDb", async () => {
  const actual = await vi.importActual("../../src/lib/localDb");
  return {
    ...actual,
    getInstanceById: vi.fn(),
    updateInstance: vi.fn(),
  };
});

function makeOAuthInstance() {
  return {
    id: "inst-123",
    slug: "test",
    url: "https://example.com/mcp",
    oauth: true,
    oauthTokens: {
      access_token: "stale-token",
      refresh_token: "refresh-1",
      token_endpoint: "https://example.com/token",
      client_id: "client",
      expires_at: Date.now() + 60_000,
    },
  };
}

function mockFetchResponse(status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    headers: {
      get: (k) => (k.toLowerCase() === "content-type" ? "application/json" : headers[k] ?? null),
    },
    text: async () => text,
    ok: status >= 200 && status < 300,
  };
}

describe("httpClient — stale 401 token race", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete globalThis.__9routerGatewayHttpSessions;
  });

  it("does not clobber a newer token when a stale 401 arrives after a concurrent refresh", async () => {
    const instance = makeOAuthInstance();
    let dbTokens = { ...instance.oauthTokens };

    getInstanceById.mockImplementation(async (id) => ({ id, oauthTokens: dbTokens }));
    updateInstance.mockImplementation(async (id, patch) => {
      if (patch?.oauthTokens) {
        dbTokens = { ...dbTokens, ...patch.oauthTokens };
      }
      return {};
    });

    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("/token")) {
        return mockFetchResponse(400, "invalid_grant");
      }
      const auth = init.headers?.Authorization ?? init.headers?.authorization;
      if (auth === "Bearer stale-token") {
        // Simulate a concurrent refresh that succeeded before our 401 handler
        // reads the DB: updateInstance is called with a fresh access token.
        dbTokens = { ...dbTokens, access_token: "fresh-token", needsReauth: false };
        return mockFetchResponse(401, "Unauthorized");
      }
      if (auth === "Bearer fresh-token") {
        return mockFetchResponse(200, { jsonrpc: "2.0", id: 1, result: { tools: [] } });
      }
      return mockFetchResponse(403, "Forbidden");
    });

    const result = await mcpRequest(instance, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

    expect(result.result).toEqual({ tools: [] });
    expect(dbTokens.access_token).toBe("fresh-token");
    expect(dbTokens.needsReauth).not.toBe(true);
  });

  it("persists needsReauth after retry also fails with the same token", async () => {
    const instance = makeOAuthInstance();
    let dbTokens = { ...instance.oauthTokens };

    getInstanceById.mockResolvedValue({ id: instance.id, oauthTokens: dbTokens });
    updateInstance.mockImplementation(async (id, patch) => {
      if (patch?.oauthTokens) {
        dbTokens = { ...dbTokens, ...patch.oauthTokens };
      }
      return {};
    });

    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/token")) {
        return mockFetchResponse(400, "invalid_grant");
      }
      return mockFetchResponse(401, "Unauthorized", { "www-authenticate": "Bearer" });
    });

    await expect(
      mcpRequest(instance, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    ).rejects.toThrow(/upstream 401/);

    expect(dbTokens.needsReauth).toBe(true);
    expect(dbTokens._lastChallenge).toBe("Bearer");
  });
});
