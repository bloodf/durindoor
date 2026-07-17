/**
 * SEC-A-03: SSRF hardening on /api/mcp-gateway/instances + httpClient.
 *
 * Three surfaces wired:
 *   1. POST /api/mcp-gateway/instances rejects metadata / private URLs
 *      via assertOutboundUrlAllowed BEFORE the row is persisted.
 *   2. mcpRequest() forces redirect:"manual" + re-validates each hop,
 *      stripping Authorization on cross-origin redirects.
 *   3. Caller-supplied instance.headers pass through a strict allowlist
 *      (X-Trace-Id, Accept, Accept-Language only); Authorization /
 *      Cookie / Proxy-Authorization / arbitrary X-* are dropped at the
 *      route boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PRIVATE_ENV = "OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS";
const LOCAL_ENV = "OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS";
const LEGACY_ENV = "OUTBOUND_SSRF_GUARD_ENABLED";

const METADATA_URL = "http://169.254.169.254/mcp";
const GCP_METADATA_URL = "http://metadata.google.internal/computeMetadata/v1/mcp";
const PUBLIC_URL = "https://mcp.example.com/rpc";
const LAN_URL = "http://192.168.1.10:8000/mcp";
const LOOPBACK_URL = "http://127.0.0.1:8000/mcp";

const originalFetch = global.fetch;
let savedEnv;

function setGuardEnv(mode) {
  delete process.env[PRIVATE_ENV];
  delete process.env[LOCAL_ENV];
  delete process.env[LEGACY_ENV];
  if (mode === "public-only") process.env[LOCAL_ENV] = "false";
  if (mode === "none") process.env[PRIVATE_ENV] = "true";
}

// Mock @/lib/localDb so the route's createInstance() does not try to
// touch the filesystem-backed SQLite.
const localDbMock = {
  getInstances: vi.fn().mockResolvedValue([]),
  createInstance: vi.fn(async (row) => ({ id: "inst-1", ...row })),
  getInstanceById: vi.fn(),
  updateInstance: vi.fn(async (id, row) => ({ id, ...row })),
  deleteInstance: vi.fn(),
};
vi.mock("@/lib/localDb", () => localDbMock);

function makeRequest(body) {
  return new Request("http://localhost/api/mcp-gateway/instances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validInstanceBody(overrides = {}) {
  return {
    name: "Test MCP",
    slug: `test-${Math.random().toString(36).slice(2, 8)}`,
    kind: "http",
    transport: "http",
    url: PUBLIC_URL,
    ...overrides,
  };
}

beforeEach(() => {
  savedEnv = {
    [PRIVATE_ENV]: process.env[PRIVATE_ENV],
    [LOCAL_ENV]: process.env[LOCAL_ENV],
    [LEGACY_ENV]: process.env[LEGACY_ENV],
  };
  vi.resetModules();
  vi.clearAllMocks();
  localDbMock.getInstances.mockResolvedValue([]);
  localDbMock.createInstance.mockImplementation(async (row) => ({ id: "inst-1", ...row }));
  global.fetch = vi.fn();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("POST /api/mcp-gateway/instances — SSRF guard on instance.url", () => {
  it("rejects IPv4 link-local (metadata) URL on create; row NOT persisted", async () => {
    setGuardEnv("default");
    const { POST } = await import("@/app/api/mcp-gateway/instances/route.js");
    const res = await POST(makeRequest(validInstanceBody({ url: METADATA_URL })));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toMatchObject({ blocked: true });
    expect(localDbMock.createInstance).not.toHaveBeenCalled();
  });

  it("rejects GCP metadata hostname on create", async () => {
    setGuardEnv("default");
    const { POST } = await import("@/app/api/mcp-gateway/instances/route.js");
    const res = await POST(makeRequest(validInstanceBody({ url: GCP_METADATA_URL })));
    expect(res.status).toBe(403);
    expect(localDbMock.createInstance).not.toHaveBeenCalled();
  });

  it("accepts public URL on create", async () => {
    setGuardEnv("default");
    const { POST } = await import("@/app/api/mcp-gateway/instances/route.js");
    const res = await POST(makeRequest(validInstanceBody()));
    expect(res.status).toBe(201);
    expect(localDbMock.createInstance).toHaveBeenCalledTimes(1);
  });

  it("accepts LAN / loopback URL in default block-metadata mode (local-first)", async () => {
    setGuardEnv("default");
    const { POST } = await import("@/app/api/mcp-gateway/instances/route.js");
    for (const url of [LAN_URL, LOOPBACK_URL]) {
      localDbMock.createInstance.mockClear();
      const res = await POST(makeRequest(validInstanceBody({ url })));
      expect(res.status, url).toBe(201);
      expect(localDbMock.createInstance, url).toHaveBeenCalledTimes(1);
    }
  });

  it("public-only mode additionally blocks LAN / loopback", async () => {
    setGuardEnv("public-only");
    const { POST } = await import("@/app/api/mcp-gateway/instances/route.js");
    for (const url of [LAN_URL, LOOPBACK_URL]) {
      const res = await POST(makeRequest(validInstanceBody({ url })));
      expect(res.status, url).toBe(403);
      expect(localDbMock.createInstance, url).not.toHaveBeenCalled();
    }
  });
});

describe("POST /api/mcp-gateway/instances — instance.headers allowlist", () => {
  it("drops Authorization, Cookie, Proxy-Authorization, and arbitrary X-*", async () => {
    setGuardEnv("default");
    const { POST } = await import("@/app/api/mcp-gateway/instances/route.js");
    const res = await POST(makeRequest(validInstanceBody({
      headers: {
        "Authorization": "Bearer evil",
        "Cookie": "session=abc",
        "Proxy-Authorization": "Basic evil",
        "X-Custom-Secret": "nope",
        "X-Trace-Id": "trace-123",
        "Accept": "application/json",
        "Accept-Language": "en-US",
      },
    })));
    expect(res.status).toBe(201);
    const passed = localDbMock.createInstance.mock.calls[0][0];
    expect(passed.headers).toEqual({
      "x-trace-id": "trace-123",
      accept: "application/json",
      "accept-language": "en-US",
    });
  });

  it("drops CR/LF injection attempts even on allowlisted names", async () => {
    setGuardEnv("default");
    const { POST } = await import("@/app/api/mcp-gateway/instances/route.js");
    const res = await POST(makeRequest(validInstanceBody({
      headers: { "X-Trace-Id": "ok\r\nX-Injected: yes" },
    })));
    expect(res.status).toBe(201);
    const passed = localDbMock.createInstance.mock.calls[0][0];
    expect(passed.headers).toEqual({});
  });
});

describe("mcpRequest — redirect handling", () => {
  it("forces redirect:'manual' on the initial fetch", async () => {
    setGuardEnv("default");
    const { mcpRequest } = await import("@/lib/mcp/gateway/httpClient.js");
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: (k) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
      json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
    });
    await mcpRequest({ id: "inst-1", slug: "t", kind: "http", transport: "http", url: PUBLIC_URL }, { jsonrpc: "2.0", id: 1, method: "ping" });
    const [, init] = global.fetch.mock.calls[0];
    expect(init.redirect).toBe("manual");
  });

  it("strips Authorization on cross-origin redirect", async () => {
    setGuardEnv("default");
    const { mcpRequest } = await import("@/lib/mcp/gateway/httpClient.js");
    const calls = [];
    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return {
          status: 302,
          ok: false,
          headers: { get: (k) => (k.toLowerCase() === "location" ? "https://other.example.com/rpc" : null) },
        };
      }
      return {
        status: 200,
        ok: true,
        headers: { get: (k) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
        json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
        text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
      };
    });
    await mcpRequest(
      { id: "inst-1", slug: "t", kind: "http", transport: "http", url: PUBLIC_URL, oauthTokens: { access_token: "tok-123", expires_at: Date.now() + 600_000 } },
      { jsonrpc: "2.0", id: 1, method: "ping" },
    );
    expect(calls.length).toBe(2);
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok-123");
    expect(calls[1].init.headers.Authorization).toBeUndefined();
    expect(calls[1].init.headers.authorization).toBeUndefined();
  });

  it("keeps Authorization on same-origin redirect", async () => {
    setGuardEnv("default");
    const { mcpRequest } = await import("@/lib/mcp/gateway/httpClient.js");
    const calls = [];
    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return {
          status: 308,
          ok: false,
          headers: { get: (k) => (k.toLowerCase() === "location" ? "https://mcp.example.com/v2/rpc" : null) },
        };
      }
      return {
        status: 200,
        ok: true,
        headers: { get: (k) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
        json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
        text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
      };
    });
    await mcpRequest(
      { id: "inst-1", slug: "t", kind: "http", transport: "http", url: PUBLIC_URL, oauthTokens: { access_token: "tok-123", expires_at: Date.now() + 600_000 } },
      { jsonrpc: "2.0", id: 1, method: "ping" },
    );
    expect(calls.length).toBe(2);
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok-123");
    expect(calls[1].init.headers.Authorization).toBe("Bearer tok-123");
  });

  it("rejects a redirect to a metadata target via SSRF guard", async () => {
    setGuardEnv("default");
    const { mcpRequest } = await import("@/lib/mcp/gateway/httpClient.js");
    global.fetch = vi.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: { get: (k) => (k.toLowerCase() === "location" ? METADATA_URL : null) },
    });
    await expect(
      mcpRequest({ id: "inst-1", slug: "t", kind: "http", transport: "http", url: PUBLIC_URL }, { jsonrpc: "2.0", id: 1, method: "ping" }),
    ).rejects.toThrow();
    // The redirected fetch must NOT have been opened.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
