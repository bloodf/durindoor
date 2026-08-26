import { describe, it, expect, vi, beforeEach } from "vitest";
import { createControlProof } from "../../src/mitm/controlProof.js";

process.env.DURINDOOR_CONTROL_PROOF_SECRET = "a".repeat(64);

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  hasTrustedPeerHeaders: vi.fn(),
}));

vi.mock("next/server", () => {
  class MockNextResponse {
    constructor(body, init) {
      this.status = init?.status || 200;
      this.body = body;
      this.headers = new Headers(init?.headers);
    }
  }
  MockNextResponse.next = vi.fn(() => mocks.nextResponse);
  MockNextResponse.json = mocks.jsonResponse;
  MockNextResponse.redirect = vi.fn((url) => ({ status: 307, url }));
  return { NextResponse: MockNextResponse };
});

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
}));
vi.mock("@/lib/auth/trustedPeer", () => ({
  hasTrustedPeerHeaders: mocks.hasTrustedPeerHeaders,
}));
vi.mock("@/mitm/controlProof", async () => await import("../../src/mitm/controlProof.js"));

const { proxy, __test__ } = await import("../../src/dashboardGuard.js");

function request(pathname, headers = {}, method = "GET") {
  const normalizedHeaders = new Headers(headers);
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: normalizedHeaders,
    method,
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

describe("dashboard guard public LLM API access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.hasTrustedPeerHeaders.mockReturnValue(true);
  });

  it("allows loopback public LLM API without API key", async () => {
    const response = await proxy(request("/v1/chat/completions", { host: "localhost:20128" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("allows only OPTIONS preflight through remote public LLM auth", async () => {
    const headers = {
      host: "router.example.com",
      "access-control-request-headers": "authorization, content-type",
    };

    const preflight = await proxy(request("/v1/chat/completions", headers, "OPTIONS"));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(preflight.headers.get("access-control-allow-headers")).toBe("authorization, content-type");
    expect(preflight.headers.get("access-control-max-age")).toBe("86400");

    for (const method of ["GET", "POST"]) {
      const response = await proxy(request("/v1/chat/completions", headers, method));
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("API key required for remote API access");
    }
  });

  it("rejects remote Host-spoof when real peer IP is non-loopback", async () => {
    const response = await proxy(request("/v1/chat/completions", {
      host: "localhost",
      "x-9r-real-ip": "10.204.111.34",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("allows loopback peer IP regardless of Host", async () => {
    const response = await proxy(request("/v1/chat/completions", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote rewritten public LLM API without API key", async () => {
    const response = await proxy(request("/api/v1/chat/completions", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("allows loopback rewritten public LLM API without API key", async () => {
    const response = await proxy(request("/api/v1/chat/completions", { host: "localhost:20128" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("accepts a valid x-api-key alongside a stale Bearer credential", async () => {
    mocks.validateApiKey.mockImplementation(async (key) => key === "sk-valid");

    const response = await proxy(request("/v1/messages", {
      host: "router.example.com",
      authorization: "Bearer stale-session-token",
      "x-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("rejects all-invalid Anthropic credentials with its native error envelope", async () => {
    const response = await proxy(request("/v1/messages", {
      host: "router.example.com",
      authorization: "Bearer stale-session-token",
      "x-api-key": "sk-invalid",
    }));

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      type: "error",
      error: {
        type: "authentication_error",
        message: "API key required for remote API access",
      },
    });
  });

  it("allows a remote dashboard session (JWT cookie) to GET the model-list API", async () => {
    // The dashboard reads /api/v1/models/* to render provider/embedding grids;
    // those fetches carry the session cookie, not an API key, and a Tailscale
    // dashboard is not loopback. A valid dashboard JWT must pass for model reads.
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    const req = request("/api/v1/models/embedding", { host: "cortexos.example.ts.net" });
    req.cookies.get = vi.fn((name) => (name === "auth_token" ? { value: "valid-jwt" } : undefined));
    const response = await proxy(req);
    expect(response).toBe(mocks.nextResponse);
  });

  it("still rejects a dashboard JWT on remote chat/completions (API key only)", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    const req = request("/v1/chat/completions", { host: "router.example.com" });
    req.cookies.get = vi.fn((name) => (name === "auth_token" ? { value: "valid-jwt" } : undefined));
    const response = await proxy(req);
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("still rejects a remote POST to the model-list API with only a dashboard JWT", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    const req = request("/api/v1/models/embedding", { host: "router.example.com" }, "POST");
    req.cookies.get = vi.fn((name) => (name === "auth_token" ? { value: "valid-jwt" } : undefined));
    const response = await proxy(req);
    expect(response.status).toBe(401);
  });

  it("rejects remote beta public LLM API without API key", async () => {
    const response = await proxy(request("/v1beta/models", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects remote rewritten beta public LLM API without API key", async () => {
    const response = await proxy(request("/api/v1beta/models", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects remote codex rewrite without API key", async () => {
    const response = await proxy(request("/codex/x", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("allows remote codex rewrite with valid API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/codex/x", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote public LLM API with valid bearer API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/api/v1/chat/completions", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote public LLM API with valid x-api-key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1/web/fetch", {
      host: "router.example.com",
      "x-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote rewritten beta public LLM API with valid API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/api/v1beta/models", {
      host: "router.example.com",
      "x-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote beta public LLM API with valid Google API key header", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1beta/models", {
      host: "router.example.com",
      "x-goog-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote beta public LLM API with valid Google key query parameter", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1beta/models?key=sk-valid", {
      host: "router.example.com",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });
});

describe("dashboard guard local-only access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("rejects local-only route from non-loopback host without CLI token", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("allows an authenticated proxied dashboard to manage PXPIPE", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    const req = request("/api/pxpipe/status", {
      host: "llm.example.com",
      "x-9r-via-proxy": "1",
    });
    req.cookies.get = vi.fn((name) =>
      name === "auth_token" ? { value: "valid-jwt" } : undefined,
    );

    const response = await proxy(req);

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.verifyDashboardAuthToken).toHaveBeenCalledWith("valid-jwt");
  });

  it("rejects an unauthenticated remote PXPIPE request when login is disabled", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/pxpipe/status", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized");
  });

  it("preserves local PXPIPE access when login is disabled", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/pxpipe/status", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects cross-origin local-only mutations when login is disabled", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/tunnel/enable", {
      host: "localhost:20128",
      origin: "https://evil.example",
      "x-9r-real-ip": "127.0.0.1",
    }, "POST"));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("allows a machine-bound CLI token to manage proxied PXPIPE", async () => {
    const response = await proxy(request("/api/pxpipe/restart", {
      host: "llm.example.com",
      "x-9r-via-proxy": "1",
      "x-9r-cli-token": "cli-token",
    }, "POST"));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects an API-key-only proxied PXPIPE request with 401", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.validateApiKey.mockResolvedValue(true);
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);

    const response = await proxy(request("/api/pxpipe/start", {
      host: "llm.example.com",
      "x-9r-via-proxy": "1",
      authorization: "Bearer sk-valid",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized");
    expect(mocks.verifyDashboardAuthToken).toHaveBeenCalled();
  });

  it("rejects local-only route on loopback when requireLogin=true and no JWT", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("allows read-only MITM status on loopback when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects a loopback MITM mutation without an owner proof when login is disabled", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
    }, "POST"));

    expect(response.status).toBe(403);
  });

  it("allows a JWT-authenticated, same-owner loopback MITM mutation", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    const remotePort = 54321;
    const proof = createControlProof({
      method: "POST",
      pathname: "/api/cli-tools/antigravity-mitm",
      remotePort,
    });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-owner-port": String(remotePort),
      "x-9r-owner-proof": proof,
    }, "POST"));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects an owner-stamped mutation without an explicit loopback Origin", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    const remotePort = 54321;
    const proof = createControlProof({
      method: "POST",
      pathname: "/api/cli-tools/antigravity-mitm",
      remotePort,
    });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-owner-port": String(remotePort),
      "x-9r-owner-proof": proof,
    }, "POST"));

    expect(response.status).toBe(403);
  });

  it("rejects an owner proof without JWT or CLI authentication", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    const remotePort = 54321;
    const proof = createControlProof({
      method: "POST",
      pathname: "/api/cli-tools/antigravity-mitm",
      remotePort,
    });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-owner-port": String(remotePort),
      "x-9r-owner-proof": proof,
    }, "POST"));

    expect(response.status).toBe(403);
  });

  it("rejects a JWT and owner proof from a different loopback origin", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    const remotePort = 54321;
    const proof = createControlProof({
      method: "POST",
      pathname: "/api/cli-tools/antigravity-mitm",
      remotePort,
    });
    const baseHeaders = {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-owner-port": String(remotePort),
      "x-9r-owner-proof": proof,
    };

    for (const origin of ["http://localhost:9999", "http://127.0.0.1:20128"]) {
      const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
        ...baseHeaders,
        origin,
      }, "POST"));
      expect(response.status).toBe(403);
    }
  });

  it("rejects a forged or method-replayed owner proof", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    const remotePort = 54321;
    const proof = createControlProof({
      method: "PATCH",
      pathname: "/api/cli-tools/antigravity-mitm",
      remotePort,
    });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-owner-port": String(remotePort),
      "x-9r-owner-proof": proof,
    }, "DELETE"));

    expect(response.status).toBe(403);
  });

  it("requires an owner-bound proof for mutating MITM alias subroutes", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    const response = await proxy(request("/api/cli-tools/antigravity-mitm/alias", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
    }, "PUT"));
    expect(response.status).toBe(403);
  });

  it("rejects local-only route from tunnel host even when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(403);
  });

  it("allows local-only route with valid CLI token", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "router.example.com",
      "x-9r-cli-token": "cli-token",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects unauthenticated remote MCP plugin message POST", async () => {
    const response = await proxy(request("/api/mcp/browsermcp/message", {
      host: "router.example.com",
    }, "POST"));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("rejects unauthenticated remote MCP plugin SSE even when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/mcp/browsermcp/sse", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });
});

describe("dashboard guard MCP CIMD client-metadata", () => {
  beforeEach(() => {
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("allows client-metadata document publicly (AS fetches it server-side)", async () => {
    const response = await proxy(request("/api/mcp-gateway/oauth/abc-123/client-metadata", {
      host: "router.example.com",
    }));
    expect(response).toBe(mocks.nextResponse);
  });

  it("still protects sibling oauth actions (authorize) without auth", async () => {
    const response = await proxy(request("/api/mcp-gateway/oauth/abc-123/authorize", {
      host: "router.example.com",
    }));
    expect(response.status).toBe(401);
  });
});

describe("dashboard guard management API auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.hasTrustedPeerHeaders.mockReturnValue(true);
  });

  for (const [method, path] of [
    ["GET", "/api/providers"],
    ["PATCH", "/api/providers/conn-1"],
    ["GET", "/api/usage/stats"],
    ["PATCH", "/api/usage/reset"],
  ]) {
    it(`rejects remote unauthenticated ${method} ${path} when requireLogin=false`, async () => {
      const response = await proxy(request(path, { host: "router.example.com" }, method));
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Unauthorized");
    });
  }

  it("allows remote management API with a valid dashboard JWT", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    const req = request("/api/providers", { host: "router.example.com" });
    req.cookies.get = vi.fn((name) => (name === "auth_token" ? { value: "valid-jwt" } : undefined));
    const response = await proxy(req);
    expect(response).toBe(mocks.nextResponse);
    expect(mocks.verifyDashboardAuthToken).toHaveBeenCalledWith("valid-jwt");
  });

  it("allows remote management API with a machine-bound CLI token", async () => {
    const response = await proxy(request("/api/usage/stats", {
      host: "router.example.com",
      "x-9r-cli-token": "cli-token",
    }));
    expect(response).toBe(mocks.nextResponse);
  });

  it("preserves loopback open-dashboard access to providers when requireLogin=false", async () => {
    const response = await proxy(request("/api/providers", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
    }));
    expect(response).toBe(mocks.nextResponse);
  });

  it("preserves loopback open-dashboard access to usage when requireLogin=false", async () => {
    const response = await proxy(request("/api/usage/stats", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
    }));
    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects remote unauthenticated access to other management prefixes (keys, oauth)", async () => {
    for (const path of ["/api/keys", "/api/oauth/status", "/api/combos"]) {
      const response = await proxy(request(path, { host: "router.example.com" }));
      expect(response.status).toBe(401);
    }
  });
});

describe("dashboard guard helpers", () => {
  it("extracts bearer API keys before x-api-key", () => {
    const apiRequest = request("/v1/chat/completions", {
      authorization: "Bearer bearer-key",
      "x-api-key": "header-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("bearer-key");
  });

  it("extracts Google API keys after x-api-key", () => {
    const apiRequest = request("/v1beta/models?key=query-key", {
      "x-api-key": "header-key",
      "x-goog-api-key": "google-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("header-key");
  });

  it("collects every presented credential once in precedence order", () => {
    const apiRequest = request("/v1beta/models?key=query-key", {
      authorization: "Bearer bearer-key",
      "x-api-key": "header-key",
      "x-goog-api-key": "google-key",
    });

    expect(__test__.extractApiKeyCandidates(apiRequest)).toEqual([
      "bearer-key",
      "header-key",
      "google-key",
      "query-key",
    ]);
  });
});
