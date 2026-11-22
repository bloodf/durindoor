/**
 * Regression for #2202 (cowork-mcp-tools) and #2237 (MCP gateway HTTP/OAuth).
 *
 * Static assertPublicUrl / assertOutboundUrlAllowed alone let DNS names
 * (nip.io → 127.0.0.1, attacker A → 169.254.169.254) and redirect hops past
 * the guard. These cases must use the resolving, connection-pinned path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns", () => ({
  default: { promises: { lookup: lookupMock } },
  promises: { lookup: lookupMock },
  lookup: (hostname, options, callback) => {
    const opts = options || {};
    Promise.resolve()
      .then(() => lookupMock(hostname, { ...opts, all: true, verbatim: true }))
      .then(
        (records) => {
          if (opts.all) callback(null, records);
          else callback(null, records[0].address, records[0].family);
        },
        (err) => callback(err),
      );
  },
}));

vi.mock("node:dns/promises", () => ({
  lookup: (...args) => lookupMock(...args),
}));

const isLocalRequest = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/dashboardGuard", () => ({
  isLocalRequest,
}));

const localDbMock = vi.hoisted(() => ({
  getInstances: vi.fn().mockResolvedValue([]),
  createInstance: vi.fn(async (row) => ({ id: "inst-1", ...row })),
  getInstanceById: vi.fn(),
  updateInstance: vi.fn(async (id, row) => ({ id, ...row })),
  deleteInstance: vi.fn(),
}));
vi.mock("@/lib/localDb", () => localDbMock);

const PRIVATE_ENV = "OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS";
const LOCAL_ENV = "OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS";
const LEGACY_ENV = "OUTBOUND_SSRF_GUARD_ENABLED";

const originalFetch = global.fetch;
let savedEnv;

function setGuardEnv(mode) {
  delete process.env[PRIVATE_ENV];
  delete process.env[LOCAL_ENV];
  delete process.env[LEGACY_ENV];
  if (mode === "public-only") process.env[LOCAL_ENV] = "false";
  if (mode === "none") process.env[PRIVATE_ENV] = "true";
}

beforeEach(() => {
  savedEnv = {
    [PRIVATE_ENV]: process.env[PRIVATE_ENV],
    [LOCAL_ENV]: process.env[LOCAL_ENV],
    [LEGACY_ENV]: process.env[LEGACY_ENV],
  };
  vi.resetModules();
  vi.clearAllMocks();
  isLocalRequest.mockReturnValue(false);
  lookupMock.mockReset();
  localDbMock.createInstance.mockImplementation(async (row) => ({ id: "inst-1", ...row }));
  localDbMock.updateInstance.mockImplementation(async (id, row) => ({ id, ...row }));
  global.fetch = vi.fn();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  global.fetch = originalFetch;
});

describe("#2202 cowork-mcp-tools resolving SSRF guard", () => {
  function request(body) {
    return new Request("http://router.example.com/api/cli-tools/cowork-mcp-tools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects a DNS name that resolves to loopback before fetch (nip.io-style)", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const { POST } = await import("../../src/app/api/cli-tools/cowork-mcp-tools/route.js");
    const res = await POST(request({ url: "http://127.0.0.1.nip.io/mcp" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "URL not allowed" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not follow a redirect to a private host", async () => {
    lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
    global.fetch = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "http://169.254.169.254/latest/meta-data" },
    }));
    const { POST } = await import("../../src/app/api/cli-tools/cowork-mcp-tools/route.js");
    const res = await POST(request({ url: "https://public.example.test/mcp" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "URL not allowed" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("#2237 MCP gateway connection-pinned / resolving guard", () => {
  it("mcpRequest refuses a hostname whose DNS answer is cloud metadata", async () => {
    setGuardEnv("default");
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    // Real undici fetch — guardedProbeFetch's dispatcher must reject before connect.
    global.fetch = originalFetch;
    const { mcpRequest } = await import("../../src/lib/mcp/gateway/httpClient.js");
    await expect(
      mcpRequest(
        { id: "inst-1", slug: "t", kind: "http", transport: "http", url: "http://rebind.example.test/mcp" },
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { skipRetry: true },
      ),
    ).rejects.toThrow(/URL not allowed|Blocked cloud-metadata|OutboundUrlGuard/i);
  });

  it("doRefresh refuses a token endpoint hostname that resolves to metadata", async () => {
    setGuardEnv("default");
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    global.fetch = originalFetch;
    const { doRefresh } = await import("../../src/lib/mcp/gateway/oauthRefresh.js");
    await expect(
      doRefresh(
        {
          id: "inst-refresh",
          slug: "r",
          oauthTokens: { access_token: "old", refresh_token: "rt", expires_at: Date.now() - 1 },
        },
        {
          tokenEndpoint: "http://rebind-token.example.test/token",
          clientId: "client",
          clientSecret: "secret",
        },
      ),
    ).rejects.toThrow(/blocked|cloud-metadata|URL not allowed/i);
    expect(localDbMock.updateInstance).not.toHaveBeenCalled();
  });

  it("POST /instances rejects a hostname that resolves to metadata under block-metadata", async () => {
    setGuardEnv("default");
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const { POST } = await import("../../src/app/api/mcp-gateway/instances/route.js");
    const res = await POST(new Request("http://localhost/api/mcp-gateway/instances", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "evil",
        slug: "evil-meta",
        kind: "http",
        transport: "http",
        url: "http://rebind.attacker.example/mcp",
      }),
    }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ blocked: true });
    expect(localDbMock.createInstance).not.toHaveBeenCalled();
  });

  it("PUT /instances/[id] rejects a hostname that resolves to loopback under public-only", async () => {
    setGuardEnv("public-only");
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    localDbMock.getInstanceById.mockResolvedValue({
      id: "inst-1",
      slug: "ok",
      kind: "http",
      url: "https://mcp.example.com/rpc",
    });
    const { PUT } = await import("../../src/app/api/mcp-gateway/instances/[id]/route.js");
    const res = await PUT(
      new Request("http://localhost/api/mcp-gateway/instances/inst-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "http://127.0.0.1.nip.io/mcp" }),
      }),
      { params: Promise.resolve({ id: "inst-1" }) },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ blocked: true });
    expect(localDbMock.updateInstance).not.toHaveBeenCalled();
  });
});
