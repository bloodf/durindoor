import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ───────────────────────────────────────────────────────────────────────────
// Test: mcp-handler-oauth
//
// Covers phase-3 PR mcp-2 items 4 + 5:
//   1. handler.js — both fire-and-forget saveRequestUsage promises attach a
//      `.catch()` handler, so a rejected save never surfaces as an
//      `unhandledRejection` (process survives).
//   2. oauth/[id]/[action]/route.js callback path — token exchange MUST use
//      `session.redirectUri` even when the callback arrives on a different
//      Host than the one used to build the authorize URL.
//   3. DCR → token exchange end-to-end on a fresh instance (no stored client).
//   4. Reuse-path with NULL `as.token_endpoint` triggers fresh discovery and
//      the completed AS block is persisted via `updateInstance`.
// ───────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  // @/lib/localDb exports used by BOTH modules under test
  validateGatewayKey: vi.fn(),
  getGrantsForKeyDetailed: vi.fn(),
  getEnabledInstancesByIds: vi.fn(),
  saveRequestUsage: vi.fn(),
  getInstanceById: vi.fn(),
  updateInstance: vi.fn(),
  // aggregator
  dispatchToolCall: vi.fn(),
  // oauth helpers
  generatePKCE: vi.fn(),
  registerMcpSession: vi.fn(),
  getMcpSessionStatus: vi.fn(),
  completeMcpSession: vi.fn(),
  clearMcpSession: vi.fn(),
  discoverAuth: vi.fn(),
  registerClient: vi.fn(),
  storeTokens: vi.fn(),
  cimdClientId: vi.fn(),
  buildClientMetadataDocument: vi.fn(),
  isPubliclyFetchableBase: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  validateGatewayKey: mocks.validateGatewayKey,
  getGrantsForKeyDetailed: mocks.getGrantsForKeyDetailed,
  getEnabledInstancesByIds: mocks.getEnabledInstancesByIds,
  saveRequestUsage: mocks.saveRequestUsage,
  getInstanceById: mocks.getInstanceById,
  updateInstance: mocks.updateInstance,
}));

vi.mock("../../src/lib/mcp/gateway/aggregator.js", () => ({
  dispatchToolCall: mocks.dispatchToolCall,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    }),
  },
}));

vi.mock("@/lib/oauth/utils/pkce", () => ({
  generatePKCE: mocks.generatePKCE,
}));

vi.mock("@/lib/oauth/utils/server", () => ({
  registerMcpSession: mocks.registerMcpSession,
  getMcpSessionStatus: mocks.getMcpSessionStatus,
  completeMcpSession: mocks.completeMcpSession,
  clearMcpSession: mocks.clearMcpSession,
}));

vi.mock("@/lib/mcp/gateway/oauthDiscovery", () => ({
  discoverAuth: mocks.discoverAuth,
}));

vi.mock("@/lib/mcp/gateway/oauthRegister", () => ({
  registerClient: mocks.registerClient,
}));

vi.mock("@/lib/mcp/gateway/oauthRefresh", () => ({
  storeTokens: mocks.storeTokens,
}));

vi.mock("@/lib/mcp/gateway/oauthCimd", () => ({
  cimdClientId: mocks.cimdClientId,
  buildClientMetadataDocument: mocks.buildClientMetadataDocument,
  isPubliclyFetchableBase: mocks.isPubliclyFetchableBase,
}));

// ── shared fixtures ────────────────────────────────────────────────────────

const INSTANCE_ID = "inst-abc-123";
const RAW_INSTANCE = {
  id: INSTANCE_ID,
  slug: "granola",
  url: "https://mcp.granola.ai",
  oauthTokens: {
    client: {
      clientId: "https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/client-metadata",
      redirect_uris: ["https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/callback"],
    },
    as: {
      authorization_endpoint: "https://auth.granola.ai/authorize",
      token_endpoint: "https://auth.granola.ai/token",
    },
  },
};

function fakeRequest(url = "http://localhost:20127/api/mcp-gateway") {
  return new Request(url, {
    headers: { Authorization: "Bearer sk-test-key" },
  });
}

// ── handler.js tests ───────────────────────────────────────────────────────

describe("handler.js — fire-and-forget usage save", () => {
  let unhandledRejection;
  let unhandledCount = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    unhandledCount = 0;
    unhandledRejection = () => {
      unhandledCount += 1;
    };
    process.on("unhandledRejection", unhandledRejection);

    mocks.validateGatewayKey.mockResolvedValue({ id: "key-1" });
    mocks.getGrantsForKeyDetailed.mockResolvedValue([
      { instanceId: INSTANCE_ID, toolAllowlist: null },
    ]);
    mocks.getEnabledInstancesByIds.mockResolvedValue([
      { id: INSTANCE_ID, slug: "granola" },
    ]);
  });

  afterEach(() => {
    process.off("unhandledRejection", unhandledRejection);
  });

  it("rejected save promise on ok path does not crash process", async () => {
    // Arrange: dispatchToolCall succeeds, saveRequestUsage rejects.
    mocks.dispatchToolCall.mockResolvedValue({
      instance: { id: INSTANCE_ID, slug: "granola" },
      result: { content: [{ type: "text", text: "ok" }] },
    });
    mocks.saveRequestUsage.mockRejectedValue(new Error("disk full"));

    const { handleJsonRpc } = await import(
      "../../src/lib/mcp/gateway/handler.js"
    );

    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "granola__list_tools", arguments: {} },
    };
    const res = await handleJsonRpc(fakeRequest(), body);

    // Assert: RPC succeeded; save rejection was swallowed by .catch().
    expect(res.kind).toBe("response");
    expect(res.body.result).toEqual({ content: [{ type: "text", text: "ok" }] });
    // Flush microtasks so a stray unhandledRejection would fire.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(unhandledCount).toBe(0);
  });

  it("rejected save promise on error path does not crash process", async () => {
    // Arrange: dispatchToolCall throws (upstream error), saveRequestUsage rejects.
    mocks.dispatchToolCall.mockRejectedValue(new Error("upstream timeout"));
    mocks.saveRequestUsage.mockRejectedValue(new Error("disk full"));

    const { handleJsonRpc } = await import(
      "../../src/lib/mcp/gateway/handler.js"
    );

    const body = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "granola__list_tools", arguments: {} },
    };
    const res = await handleJsonRpc(fakeRequest(), body);

    // Assert: upstream error returned as JSON-RPC error result (isError),
    // save rejection swallowed.
    expect(res.kind).toBe("response");
    expect(res.body.result.isError).toBe(true);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(unhandledCount).toBe(0);
  });
});

// ── oauth/[id]/[action]/route.js tests ────────────────────────────────────

describe("oauth/[id]/[action]/route.js — callback redirectUri regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("callback exchange uses session redirectUri even when callback Host differs", async () => {
    // Arrange: session was registered with a redirectUri built from the
    // authorize Host (router.example.com). Callback arrives on a different
    // Host (public.example.com) — session.redirectUri must win.
    const sessionRedirectUri =
      "https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/callback";
    const code = "auth-code-123";
    const state = "state-abc";

    mocks.getInstanceById.mockResolvedValue(RAW_INSTANCE);
    mocks.getMcpSessionStatus.mockReturnValue({
      codeVerifier: "verifier-abc",
      clientId: "https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/client-metadata",
      redirectUri: sessionRedirectUri,
      resource: "https://mcp.granola.ai",
      status: "pending",
    });
    mocks.storeTokens.mockResolvedValue(undefined);
    mocks.completeMcpSession.mockReturnValue(true);
    mocks.clearMcpSession.mockReturnValue(true);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "tok-abc" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { GET } = await import(
      "../../src/app/api/mcp-gateway/oauth/[id]/[action]/route.js"
    );

    // Act: callback arrives on a DIFFERENT Host than the one used to build
    // the authorize URL.
    const callbackUrl = `https://public.example.com/api/mcp-gateway/oauth/${INSTANCE_ID}/callback?code=${code}&state=${state}`;
    const request = new Request(callbackUrl);
    const res = await GET(request, {
      params: Promise.resolve({ id: INSTANCE_ID, action: "callback" }),
    });

    // Assert: exchange succeeded, body posted to token endpoint used
    // session.redirectUri, not appBase(request).
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [tokenUrl, tokenInit] = fetchSpy.mock.calls[0];
    expect(tokenUrl).toBe("https://auth.granola.ai/token");
    const params = new URLSearchParams(tokenInit.body);
    expect(params.get("redirect_uri")).toBe(sessionRedirectUri);
    expect(params.get("code")).toBe(code);
    expect(params.get("code_verifier")).toBe("verifier-abc");

    fetchSpy.mockRestore();
  });
});

describe("oauth/[id]/[action]/route.js — DCR → token exchange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("DCR on fresh instance then callback token exchange succeeds", async () => {
    // Arrange: instance has NO stored client; authorize triggers DCR.
    const freshInstance = {
      id: INSTANCE_ID,
      slug: "granola",
      url: "https://mcp.granola.ai",
      oauthTokens: undefined,
    };
    // Stateful store: ensureClient's persist + the AS gap-fill persist BOTH
    // flow through updateInstance (shallow top-level merge, oauthTokens
    // replaced wholesale). Reads after each write must reflect the write,
    // or the second persist erases the client the first one registered.
    let store = freshInstance;
    mocks.getInstanceById.mockImplementation(async () => store);
    mocks.updateInstance.mockImplementation(async (_id, data) => {
      store = { ...store, ...data };
    });
    mocks.discoverAuth.mockResolvedValue({
      authorization_endpoint: "https://auth.granola.ai/authorize",
      token_endpoint: "https://auth.granola.ai/token",
      registration_endpoint: "https://auth.granola.ai/register",
      resource: "https://mcp.granola.ai",
    });
    mocks.registerClient.mockResolvedValue({
      clientId: "dcr-client-123",
      clientSecret: undefined,
      meta: {
        authorization_endpoint: "https://auth.granola.ai/authorize",
        token_endpoint: "https://auth.granola.ai/token",
      },
    });
    mocks.cimdClientId.mockReturnValue(
      "https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/client-metadata"
    );
    mocks.buildClientMetadataDocument.mockReturnValue({
      client_id: "https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/client-metadata",
      redirect_uris: ["https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/callback"],
      client_name: "9router MCP Gateway (granola)",
      token_endpoint_auth_method: "none",
    });
    mocks.isPubliclyFetchableBase.mockReturnValue(true);
    mocks.generatePKCE.mockReturnValue({
      codeVerifier: "verifier-abc",
      codeChallenge: "challenge-abc",
      state: "state-abc",
    });
    mocks.registerMcpSession.mockReturnValue(true);

    const { GET } = await import(
      "../../src/app/api/mcp-gateway/oauth/[id]/[action]/route.js"
    );

    // Act: authorize on a fresh instance.
    const authorizeUrl = `https://router.example.com/api/mcp-gateway/oauth/${INSTANCE_ID}/authorize`;
    const request = new Request(authorizeUrl, {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "router.example.com" },
    });
    const res = await GET(request, {
      params: Promise.resolve({ id: INSTANCE_ID, action: "authorize" }),
    });

    // Assert: DCR was called, client persisted, authorize URL returned.
    expect(res.status).toBe(200);
    expect(mocks.discoverAuth).toHaveBeenCalled();
    expect(mocks.registerClient).toHaveBeenCalled();
    expect(mocks.updateInstance).toHaveBeenCalledWith(
      INSTANCE_ID,
      expect.objectContaining({
        oauthTokens: expect.objectContaining({
          client: expect.objectContaining({
            clientId: "dcr-client-123",
          }),
        }),
      })
    );
    expect(mocks.registerMcpSession).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: INSTANCE_ID,
        state: "state-abc",
        codeVerifier: "verifier-abc",
        redirectUri:
          "https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/callback",
        clientId: "dcr-client-123",
      })
    );
    expect(res.body.url).toContain("https://auth.granola.ai/authorize");
  });

  it("AS gap-fill after ensureClient does NOT clobber the client credentials ensureClient persisted", async () => {
    // Arrange: stored row has a partial `as` block (authorization_endpoint
    // only, no token_endpoint) and NO client — so ensureClient takes the DCR
    // path and persists {client, as}, yet `meta` is still derived from the
    // stale pre-ensureClient row, forcing the authorize action to re-run
    // discovery and persist the token_endpoint gap. Under the repo's shallow
    // top-level merge, updateInstance replaces `oauthTokens` wholesale, so
    // that second persist must rebuild from the row ensureClient wrote — not
    // the stale pre-ensureClient row — or the client is erased (B1).
    const preInstance = {
      id: INSTANCE_ID,
      slug: "granola",
      url: "https://mcp.granola.ai",
      oauthTokens: {
        as: {
          authorization_endpoint: "https://auth.granola.ai/authorize",
        },
      },
    };
    // Stateful store mirroring the repo's shallow top-level merge — under
    // it, `oauthTokens` is replaced wholesale on every updateInstance call.
    let store = preInstance;
    mocks.getInstanceById.mockImplementation(async () => store);
    mocks.updateInstance.mockImplementation(async (_id, data) => {
      store = { ...store, ...data };
    });
    mocks.discoverAuth.mockResolvedValue({
      authorization_endpoint: "https://auth.granola.ai/authorize",
      token_endpoint: "https://auth.granola.ai/token",
      registration_endpoint: "https://auth.granola.ai/register",
    });
    mocks.registerClient.mockResolvedValue({
      clientId: "dcr-client-456",
      clientSecret: "secret-456",
    });
    mocks.generatePKCE.mockReturnValue({
      codeVerifier: "verifier-abc",
      codeChallenge: "challenge-abc",
      state: "state-abc",
    });
    mocks.registerMcpSession.mockReturnValue(true);

    const { GET } = await import(
      "../../src/app/api/mcp-gateway/oauth/[id]/[action]/route.js"
    );

    // Act
    const request = new Request(
      `https://router.example.com/api/mcp-gateway/oauth/${INSTANCE_ID}/authorize`,
      { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "router.example.com" } },
    );
    const res = await GET(request, {
      params: Promise.resolve({ id: INSTANCE_ID, action: "authorize" }),
    });

    // Assert: flow still redirects to the authorize URL.
    expect(res.status).toBe(200);
    expect(res.body.url).toContain("https://auth.granola.ai/authorize");
    expect(res.body.url).toContain("client_id=dcr-client-456");

    // ensureClient's persist is the first updateInstance call. Under the
    // buggy code a SECOND call (the AS gap-fill) rebuilt `oauthTokens` from
    // the stale pre-ensureClient row and erased the client. Under the fix,
    // the re-read row is already complete, so the second persist is skipped
    // — either way, the LAST call payload and the final stored row must
    // retain the client credentials, or the token exchange loses them (B1).
    const calls = mocks.updateInstance.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const lastTokens = calls[calls.length - 1][1].oauthTokens;
    expect(lastTokens.client).toEqual({
      clientId: "dcr-client-456",
      clientSecret: "secret-456",
      clientIdIssuedAt: undefined,
      redirectUri: "https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/callback",
    });
    expect(lastTokens.as.token_endpoint).toBe("https://auth.granola.ai/token");
    expect(store.oauthTokens.client.clientId).toBe("dcr-client-456");
    expect(store.oauthTokens.as.token_endpoint).toBe("https://auth.granola.ai/token");
  });
});

describe("oauth/[id]/[action]/route.js — reuse-path NULL token_endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuse-path with NULL token_endpoint triggers fresh discovery and persists AS block", async () => {
    // Arrange: instance has a stored client (reuse path) but AS metadata is
    // missing token_endpoint — the gap phase-3 item 5 closes.
    const instanceWithNullTokenEndpoint = {
      id: INSTANCE_ID,
      slug: "granola",
      url: "https://mcp.granola.ai",
      oauthTokens: {
        client: {
          clientId: "https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/client-metadata",
          redirectUri: "https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/callback",
        },
        as: {
          authorization_endpoint: "https://auth.granola.ai/authorize",
          // token_endpoint is NULL — the gap the fix closes.
        },
      },
    };
    mocks.getInstanceById.mockResolvedValue(instanceWithNullTokenEndpoint);
    mocks.discoverAuth.mockResolvedValue({
      authorization_endpoint: "https://auth.granola.ai/authorize",
      token_endpoint: "https://auth.granola.ai/token",
      resource: "https://mcp.granola.ai",
    });
    mocks.updateInstance.mockResolvedValue(undefined);
    mocks.cimdClientId.mockReturnValue(
      "https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/client-metadata"
    );
    mocks.buildClientMetadataDocument.mockReturnValue({
      client_id: "https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/client-metadata",
      redirect_uris: ["https://router.example.com/api/mcp-gateway/oauth/inst-abc-123/callback"],
      client_name: "9router MCP Gateway (granola)",
      token_endpoint_auth_method: "none",
    });
    mocks.isPubliclyFetchableBase.mockReturnValue(true);
    mocks.generatePKCE.mockReturnValue({
      codeVerifier: "verifier-abc",
      codeChallenge: "challenge-abc",
      state: "state-abc",
    });
    mocks.registerMcpSession.mockReturnValue(true);

    const { GET } = await import(
      "../../src/app/api/mcp-gateway/oauth/[id]/[action]/route.js"
    );

    // Act: authorize with reuse-path client but NULL token_endpoint.
    const authorizeUrl = `https://router.example.com/api/mcp-gateway/oauth/${INSTANCE_ID}/authorize`;
    const request = new Request(authorizeUrl, {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "router.example.com" },
    });
    const res = await GET(request, {
      params: Promise.resolve({ id: INSTANCE_ID, action: "authorize" }),
    });

    // Assert: fresh discovery ran, completed AS block persisted.
    expect(res.status).toBe(200);
    expect(mocks.discoverAuth).toHaveBeenCalled();
    expect(mocks.updateInstance).toHaveBeenCalledWith(
      INSTANCE_ID,
      expect.objectContaining({
        oauthTokens: expect.objectContaining({
          as: expect.objectContaining({
            token_endpoint: "https://auth.granola.ai/token",
          }),
        }),
      })
    );
    expect(res.body.url).toContain("https://auth.granola.ai/authorize");
  });
});
