import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock localDb and fetch before importing httpClient + oauthRefresh.
const updateInstance = vi.fn();
const getInstanceById = vi.fn();

vi.mock("@/lib/localDb", () => ({
  updateInstance,
  getInstanceById,
}));

global.fetch = vi.fn();

const { mcpRequest } = await import("../../src/lib/mcp/gateway/httpClient");
const { refreshToken, ensureFreshToken, oauthMetaFromTokens } = await import("../../src/lib/mcp/gateway/oauthRefresh");

function makeOAuthInstance(id = "oauth-1", slug = "test-oauth") {
  return {
    id,
    slug,
    url: "https://mcp.example.com/mcp",
    oauth: true,
    headers: {},
    oauthTokens: {
      access_token: "stale-token",
      refresh_token: "refresh-1",
      token_type: "Bearer",
      expires_at: Date.now() + 3_600_000,
      token_endpoint: "https://auth.example.com/token",
      client_id: "client-1",
      client_secret: "secret-1",
    },
  };
}

function mockFetchResponse(status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) => headers[k.toLowerCase()] || null,
    },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

beforeEach(() => {
  updateInstance.mockReset();
  updateInstance.mockResolvedValue({});
  getInstanceById.mockReset();
  global.fetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("httpClient — MCP OAuth 401 retry", () => {
  it("force-refreshes and retries once on 401 with refreshed access token", async () => {
    const instance = makeOAuthInstance();

    let refreshCalls = 0;
    global.fetch.mockImplementation(async (url, init) => {
      if (String(url).includes("/token")) {
        refreshCalls++;
        return mockFetchResponse(200, {
          access_token: "new-token",
          refresh_token: "refresh-2",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }

      const headers = init.headers ?? {};
      const auth = headers.Authorization ?? headers.authorization;
      if (auth === "Bearer stale-token") {
        return mockFetchResponse(401, "Unauthorized");
      }
      if (auth === "Bearer new-token") {
        return mockFetchResponse(200, { jsonrpc: "2.0", id: 1, result: { tools: [] } });
      }
      return mockFetchResponse(403, "Forbidden");
    });

    const result = await mcpRequest(
      instance,
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }
    );

    const mcpCalls = global.fetch.mock.calls.filter(([url]) => !String(url).includes("/token"));
    expect(mcpCalls).toHaveLength(2);
    expect(mcpCalls[0][1].headers.Authorization).toBe("Bearer stale-token");
    expect(mcpCalls[1][1].headers.Authorization).toBe("Bearer new-token");

    expect(result.result).toEqual({ tools: [] });
    expect(refreshCalls).toBe(1);
    expect(updateInstance).toHaveBeenCalled();
    const persisted = updateInstance.mock.calls.find(([_, patch]) => patch?.oauthTokens?.access_token === "new-token")?.[1];
    expect(persisted?.oauthTokens?.access_token).toBe("new-token");
  });

  it("does not retry 401 when refresh fails", async () => {
    const instance = makeOAuthInstance();

    global.fetch.mockImplementation(async (url) => {
      if (String(url).includes("/token")) {
        return mockFetchResponse(400, "invalid_grant");
      }
      return mockFetchResponse(401, "Unauthorized");
    });

    await expect(
      mcpRequest(instance, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    ).rejects.toThrow(/upstream 401/);
  });

  it("does not retry 401 for non-oauth instance", async () => {
    const instance = {
      id: "plain-1",
      slug: "plain",
      url: "http://fake-mcp.example.com/mcp",
      oauth: false,
      headers: {},
    };

    global.fetch.mockResolvedValue(mockFetchResponse(401, "Unauthorized"));

    await expect(
      mcpRequest(instance, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    ).rejects.toThrow(/upstream 401/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("oauthRefresh — forced refresh deduplication", () => {
  it("shares one refresh request across concurrent forced refreshes", async () => {
    const instance = makeOAuthInstance();
    let refreshCalls = 0;
    global.fetch.mockImplementation(async (url) => {
      if (String(url).includes("/token")) {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 50));
        return mockFetchResponse(200, {
          access_token: "shared-token",
          refresh_token: "refresh-shared",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      return mockFetchResponse(401, "Unauthorized");
    });

    const [a, b] = await Promise.all([
      refreshToken(instance),
      refreshToken(instance),
    ]);

    expect(a?.oauthTokens?.access_token).toBe("shared-token");
    expect(b?.oauthTokens?.access_token).toBe("shared-token");
    expect(refreshCalls).toBe(1);
  });
});

describe("oauthRefresh — preflight refresh failure", () => {
  it("persists needsReauth: true when a preflight refresh fails", async () => {
    const instance = makeOAuthInstance();
    // Expired token will trigger ensureFreshToken → refresh.
    instance.oauthTokens.expires_at = Date.now() - 1_000;

    global.fetch.mockImplementation(async (url) => {
      if (String(url).includes("/token")) {
        return mockFetchResponse(400, "invalid_grant");
      }
      return mockFetchResponse(200, { ok: true });
    });

    const refreshed = await ensureFreshToken(instance, oauthMetaFromTokens(instance.oauthTokens));

    expect(refreshed.oauthTokens.needsReauth).toBe(true);
    expect(updateInstance).toHaveBeenCalledWith(
      instance.id,
      expect.objectContaining({
        oauthTokens: expect.objectContaining({ needsReauth: true }),
      })
    );
  });
});
