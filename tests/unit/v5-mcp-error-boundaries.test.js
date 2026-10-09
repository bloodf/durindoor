import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Isolated security repro for G11/E03 (MCP)/S02/S05/M05/M08, not a green CI gate.
// Keep the security assertions plain even when current production leaks errors.
// Gateway handler, aggregator, grants, transport client, and retry stay real.
const db = vi.hoisted(() => ({
  validateGatewayKey: vi.fn(),
  getGrantsForKeyDetailed: vi.fn(),
  getEnabledInstancesByIds: vi.fn(),
  saveRequestUsage: vi.fn(),
  getInstanceById: vi.fn(),
  updateInstance: vi.fn(),
}));
const control = vi.hoisted(() => ({ callTool: vi.fn(), listTools: vi.fn() }));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnectionById: vi.fn(async () => null),
}));
// Only the separate control-route cases inject a synthetic tool implementation.
// POST and NextResponse remain real; no response is mocked or echoed.
vi.mock("@/lib/mcp/control/tools", () => control);

const { handleJsonRpc } = await import("../../src/lib/mcp/gateway/handler");
const { __test__: http } = await import("../../src/lib/mcp/gateway/httpClient");
const { POST } = await import("../../src/app/api/mcp/control/route");

const SECRET = "api_key=audit1150-secret";
const PRIVATE_PATH = "/srv/private/client.ts:44";
const SESSION_KEY = "__9routerGatewayHttpSessions";
const PROTOCOL = "2025-06-18";
const TOOL = { name: "echo", inputSchema: { type: "object", properties: {} } };
const SUCCESS = { content: [{ type: "text", text: "public result" }], isError: false };
let sequence = 0;
let instance;
let sessionId;
let trace;

beforeEach(() => {
  vi.resetAllMocks();
  sequence += 1;
  instance = {
    id: `audit1150-instance-${sequence}`,
    slug: `audit1150-${sequence}`,
    transport: "http",
    url: `https://audit1150.invalid/mcp/${sequence}`,
    oauth: false,
    headers: {},
  };
  sessionId = `audit1150-session-${sequence}`;
  trace = [];
  // Replace the map, not its contents: other suites' sessions retain identity/state.
  vi.stubGlobal(SESSION_KEY, new Map());
  db.validateGatewayKey.mockImplementation(async (key) =>
    key === "synthetic-gateway-key" ? { id: "audit1150-key" } : null
  );
  db.getGrantsForKeyDetailed.mockResolvedValue([
    { instanceId: instance.id, toolAllowlist: [TOOL.name] },
  ]);
  db.getEnabledInstancesByIds.mockResolvedValue([instance]);
  db.saveRequestUsage.mockResolvedValue(undefined);
  // Fail closed if any unexpected HTTP escapes the method-aware fixture.
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("Unexpected HTTP outside audit1150 fixture");
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  // No env or timer APIs are changed. Real bounded backoff runs unmodified.
});

function rpcRequest(body, path = "/api/mcp-gateway") {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      authorization: ["Bearer", "synthetic-gateway-key"].join(" "),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function gateway(body) {
  const request = rpcRequest(body);
  return handleJsonRpc(request, await request.json());
}

function installUpstream(target, failure = null) {
  globalThis.fetch.mockImplementation(async (url, options) => {
    const frame = JSON.parse(options.body);
    const headers = new Headers(options.headers);
    const row = {
      url: String(url),
      method: frame.method,
      id: frame.id,
      params: frame.params,
      session: headers.get("mcp-session-id"),
      protocol: headers.get("mcp-protocol-version"),
      httpMethod: options.method,
      status: null,
    };
    trace.push(row);
    let response;
    if (frame.method === "initialize") {
      response = Response.json({
        jsonrpc: "2.0",
        id: frame.id,
        result: {
          protocolVersion: PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: "audit1150-upstream", version: "1" },
        },
      }, { headers: { "mcp-session-id": sessionId } });
    } else if (frame.method === "notifications/initialized") {
      response = new Response(null, { status: 202 });
    } else if (frame.method === target) {
      response = failure === "http"
        ? new Response(`${target} failed: ${SECRET} at ${PRIVATE_PATH}`, {
          status: 500,
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
        : Response.json(failure === "rpc" ? {
          jsonrpc: "2.0",
          id: frame.id,
          error: { code: -32603, message: `${target}: ${SECRET} at ${PRIVATE_PATH}` },
        } : {
          jsonrpc: "2.0",
          id: frame.id,
          result: target === "tools/list" ? { tools: [TOOL] } : SUCCESS,
        });
    } else {
      throw new Error(`Unexpected fixture method: ${frame.method}`);
    }
    row.status = response.status;
    return response;
  });
}

async function initializeGateway() {
  const init = await gateway({ jsonrpc: "2.0", id: "client-init", method: "initialize" });
  expect(init).toMatchObject({
    kind: "response", status: 200,
    body: { jsonrpc: "2.0", id: "client-init", result: { protocolVersion: PROTOCOL } },
  });
  expect(await gateway({ jsonrpc: "2.0", method: "notifications/initialized" }))
    .toEqual({ kind: "notification" });
  expect(trace).toEqual([]);
}

function assertTrace(method, attempts, status) {
  expect(trace.map((row) => row.method)).toEqual([
    "initialize", "notifications/initialized", ...Array(attempts).fill(method),
  ]);
  expect(trace.map((row) => row.status)).toEqual([200, 202, ...Array(attempts).fill(status)]);
  expect(trace.map((row) => row.id)).toEqual([1, undefined, ...Array(attempts).fill(2)]);
  expect(trace.map((row) => row.session)).toEqual([
    null, sessionId, ...Array(attempts).fill(sessionId),
  ]);
  for (const row of trace) {
    expect(row.url).toBe(instance.url);
    expect(row.httpMethod).toBe("POST");
    expect(row.protocol).toBe(PROTOCOL);
  }
  for (const row of trace.slice(2)) {
    expect(row.params).toEqual(method === "tools/call"
      ? { name: TOOL.name, arguments: { input: "public" } } : {});
  }
  expect(http.getSessionStore().get(instance.id)).toMatchObject({
    sessionId, protocolVersion: PROTOCOL, serverInfo: { name: "audit1150-upstream" },
    initPromise: null,
  });
}

function assertSafe(value) {
  // Inspect every response field, including tools/list result._gateway.errors.
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(SECRET);
  expect(serialized).not.toContain("audit1150-secret");
  expect(serialized).not.toContain(PRIVATE_PATH);
  expect(serialized).not.toContain("/srv/private/");
}

function toolFrame(method) {
  return {
    jsonrpc: "2.0", id: `client-${sequence}`, method,
    params: method === "tools/call"
      ? { name: `${instance.slug}__${TOOL.name}`, arguments: { input: "public" } } : {},
  };
}

describe("MCP gateway error boundaries through real HTTP client and retry", () => {
  it.each(["tools/call", "tools/list"])("%s hides HTTP 500 details after all three attempts", async (method) => {
    installUpstream(method, "http");
    await initializeGateway();
    const frame = toolFrame(method);
    const response = await gateway(frame);
    // Establish the intended method failed, not initialize or its notification.
    assertTrace(method, 3, 500);
    expect(response).toMatchObject({
      kind: "response", status: 200, body: { jsonrpc: "2.0", id: frame.id },
    });
    expect(response.body).not.toHaveProperty("error");
    if (method === "tools/call") {
      expect(response.body.result).toMatchObject({
        isError: true, content: [{ type: "text", text: expect.any(String) }],
      });
    } else {
      expect(response.body.result.tools).toEqual([]);
      expect(response.body.result._gateway.errors).toEqual([
        { slug: instance.slug, message: expect.any(String) },
      ]);
    }
    assertSafe(response);
  }, 10_000);

  it("preserves JSON-RPC error code and client id without leaking upstream message", async () => {
    installUpstream("tools/call", "rpc");
    await initializeGateway();
    const frame = toolFrame("tools/call");
    const response = await gateway(frame);
    assertTrace("tools/call", 1, 200);
    expect(response).toMatchObject({
      kind: "response", status: 200,
      body: { jsonrpc: "2.0", id: frame.id, error: { code: -32603, message: expect.any(String) } },
    });
    expect(response.body).not.toHaveProperty("result");
    assertSafe(response);
  });

  it.each(["tools/call", "tools/list"])("%s success reaches the granted upstream", async (method) => {
    installUpstream(method);
    await initializeGateway();
    const frame = toolFrame(method);
    const response = await gateway(frame);
    assertTrace(method, 1, 200);
    expect(response).toEqual({
      kind: "response", status: 200,
      body: { jsonrpc: "2.0", id: frame.id, result: method === "tools/call" ? SUCCESS : {
        tools: [{ ...TOOL, name: `${instance.slug}__echo`, description: "", _instance: instance.slug }],
        nextCursor: null, _gateway: { errors: [] },
      } },
    });
    assertSafe(response);
  });
});

async function controlCall() {
  const body = {
    jsonrpc: "2.0", id: `control-${sequence}`, method: "tools/call",
    params: { name: "audit1150_control", arguments: { input: "public" } },
  };
  const response = await POST(rpcRequest(body, "/api/mcp/control"));
  expect(control.callTool).toHaveBeenCalledExactlyOnceWith(body.params.name, body.params.arguments);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(globalThis.fetch).not.toHaveBeenCalled();
  return { response, body: await response.json(), id: body.id };
}

describe("MCP control POST thrown-tool boundary", () => {
  it.each([undefined, 400])("hides synthetic thrown details with status %s", async (status) => {
    const error = new Error(`control failure: ${SECRET} at ${PRIVATE_PATH}`);
    if (status !== undefined) error.status = status;
    control.callTool.mockRejectedValueOnce(error);
    const { response, body, id } = await controlCall();
    expect(body).toEqual({
      jsonrpc: "2.0", id, error: { code: status ?? -32603, message: expect.any(String) },
    });
    assertSafe({ headers: [...response.headers], body });
  });

  it("serializes a successful tool result through the real POST route", async () => {
    control.callTool.mockResolvedValueOnce({ ok: true, value: "public result" });
    const { response, body, id } = await controlCall();
    expect(body).toEqual({
      jsonrpc: "2.0", id,
      result: { content: [{ type: "text", text: JSON.stringify({ ok: true, value: "public result" }, null, 2) }] },
    });
    assertSafe({ headers: [...response.headers], body });
  });
});
