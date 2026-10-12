import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only persistence and HTTP are fixtures. Registered routes, dispatch, sessions,
// grants, transport, retry, and response serialization remain real.
const db = vi.hoisted(() => ({
  validateGatewayKey: vi.fn(),
  getGrantsForKeyDetailed: vi.fn(),
  getEnabledInstancesByIds: vi.fn(),
  saveRequestUsage: vi.fn(),
  getInstanceById: vi.fn(),
  updateInstance: vi.fn(),
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnectionById: vi.fn(async () => null),
}));

const { POST: gatewayPost } = await import("../../src/app/api/mcp-gateway/route.js");
const { POST: probePost } = await import("../../src/app/api/mcp-gateway/instances/[id]/test/route.js");
const PROTOCOL = "2025-06-18";
const SECRET = "fleet1270-synthetic-private-value";
const PRIVATE_PATH = "/srv/private/fleet1270.ts:44";
const INSTANCES = ["alpha", "beta"].map((slug) => ({
  id: `fleet1270-${slug}`, slug, transport: "http", oauth: false,
  url: `https://fleet1270.invalid/${slug}`, headers: {},
}));
const TOOL = { name: "echo", description: "Public echo", inputSchema: { type: "object" } };
let trace;

beforeEach(() => {
  vi.resetAllMocks();
  trace = [];
  vi.stubGlobal("__9routerGatewayHttpSessions", new Map());
  db.getInstanceById.mockImplementation(async (id) => INSTANCES.find((i) => i.id === id));
  db.saveRequestUsage.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("Unexpected HTTP outside fleet1270 fixture");
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function request(body, key = "fleet1270-alpha-key", path = "/api/mcp-gateway") {
  return new Request(`http://localhost:20127${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
}

function upstream({ listError, callResult } = {}) {
  globalThis.fetch.mockImplementation(async (url, options) => {
    const instance = INSTANCES.find((i) => i.url === String(url));
    if (!instance) throw new Error("Unexpected fixture URL");
    const frame = JSON.parse(options.body);
    const headers = new Headers(options.headers);
    trace.push({ slug: instance.slug, frame, session: headers.get("mcp-session-id"), protocol: headers.get("mcp-protocol-version") });
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("manual");
    if (frame.method === "initialize") {
      return Response.json({ jsonrpc: "2.0", id: frame.id, result: {
        protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "fleet1270-fixture", version: "1" },
      } }, { headers: { "mcp-session-id": `session-${instance.slug}` } });
    }
    if (frame.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (frame.method === "tools/list") {
      return Response.json({ jsonrpc: "2.0", id: frame.id, ...(listError
        ? { error: { code: -32603, message: listError } }
        : { result: { tools: [TOOL, { ...TOOL, name: "admin" }] } }) });
    }
    if (frame.method === "tools/call") {
      return Response.json({ jsonrpc: "2.0", id: frame.id, result: callResult ?? {
        content: [{ type: "text", text: "Public echo result" }], isError: false,
      } });
    }
    throw new Error(`Unexpected fixture method: ${frame.method}`);
  });
}

function assertPrivate(value) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(SECRET);
  expect(serialized).not.toContain(PRIVATE_PATH);
}

describe("fleet PR1270 registered MCP entry points", () => {
  it.each(["alpha", "beta"])("%s lists and calls only its granted instance/tool", async (slug) => {
    upstream();
    vi.stubEnv("OMNIROUTE_API_KEY", "fleet1270-unrelated-env-key");
    db.validateGatewayKey.mockImplementation(async (key) =>
      key === `fleet1270-${slug}-key` ? { id: `principal-${slug}` } : null);
    const instance = INSTANCES.find((i) => i.slug === slug);
    const other = INSTANCES.find((i) => i.slug !== slug);
    db.getGrantsForKeyDetailed.mockResolvedValue([{ instanceId: instance.id, toolAllowlist: ["echo"] }]);
    db.getEnabledInstancesByIds.mockImplementation(async (ids) => INSTANCES.filter((i) => ids.includes(i.id)));
    const key = `fleet1270-${slug}-key`;
    const listResponse = await gatewayPost(request({ jsonrpc: "2.0", id: "list", method: "tools/list" }, key));
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({ jsonrpc: "2.0", id: "list", result: {
      tools: [{ ...TOOL, name: `${slug}__echo`, _instance: slug }], nextCursor: null, _gateway: { errors: [] },
    } });
    const callResponse = await gatewayPost(request({ jsonrpc: "2.0", id: "allowed", method: "tools/call",
      params: { name: `${slug}__echo`, arguments: { input: "public" } },
    }, key));
    expect(callResponse.status).toBe(200);
    expect(await callResponse.json()).toEqual({ jsonrpc: "2.0", id: "allowed", result: {
      content: [{ type: "text", text: "Public echo result" }], isError: false,
    } });
    expect(trace.map((row) => row.frame.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    expect(trace.map((row) => row.frame.id)).toEqual([1, undefined, 2, 3]);
    expect(trace.map((row) => row.session)).toEqual([null, `session-${slug}`, `session-${slug}`, `session-${slug}`]);
    expect(trace.every((row) => row.slug === slug && row.protocol === PROTOCOL)).toBe(true);
    expect(trace[3].frame.params).toEqual({ name: "echo", arguments: { input: "public" } });
    expect(db.getGrantsForKeyDetailed).toHaveBeenCalledWith(`principal-${slug}`);
    expect(db.getEnabledInstancesByIds).toHaveBeenCalledWith([instance.id]);
    expect(db.saveRequestUsage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      apiKey: key, connectionId: instance.id, model: `${slug}__echo`, status: "ok",
    }));
    const upstreamCalls = globalThis.fetch.mock.calls.length;
    for (const name of [`${slug}__admin`, `${other.slug}__echo`]) {
      const denied = await gatewayPost(request({ jsonrpc: "2.0", id: "denied", method: "tools/call", params: { name } }, key));
      expect(denied.status).toBe(200);
      const body = await denied.json();
      expect(body).toMatchObject({ jsonrpc: "2.0", id: "denied", error: { code: -32602 } });
      expect(body).not.toHaveProperty("result");
      expect(JSON.stringify(body)).not.toContain(`principal-${slug}`);
      expect(JSON.stringify(body)).not.toContain(key);
      expect(JSON.stringify(body)).not.toContain("fleet1270-unrelated-env-key");
      expect(globalThis.fetch).toHaveBeenCalledTimes(upstreamCalls);
    }
  });

  it.each([null, "fleet1270-invalid-key"])("rejects HTTP identity %s before grants or upstream despite env key", async (key) => {
    vi.stubEnv("OMNIROUTE_API_KEY", "fleet1270-unrelated-env-key");
    db.validateGatewayKey.mockResolvedValue(null);
    const response = await gatewayPost(request({ jsonrpc: "2.0", id: "unauthorized", method: "tools/list" }, key));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: null, error: {
      code: -32000, message: `gateway key ${key ? "invalid" : "missing"}`,
    } });
    expect(db.validateGatewayKey.mock.calls).toEqual(key ? [[key]] : []);
    expect(db.getGrantsForKeyDetailed).not.toHaveBeenCalled();
    expect(db.getEnabledInstancesByIds).not.toHaveBeenCalled();
    expect(db.saveRequestUsage).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([true, false])("preserves tool result and sanitizes error text only when isError=%s", async (isError) => {
    const text = `Tool temporarily unavailable: api_key=${SECRET} at ${PRIVATE_PATH}`;
    const result = { isError, content: [
      { type: "text", text, annotations: { audience: ["user"] } },
      { type: "text", text: "Tool temporarily unavailable" },
      { type: "image", data: "AA==", mimeType: "image/png" },
    ] };
    upstream({ callResult: result });
    db.validateGatewayKey.mockResolvedValue({ id: "principal-alpha" });
    db.getGrantsForKeyDetailed.mockResolvedValue([{ instanceId: INSTANCES[0].id, toolAllowlist: ["echo"] }]);
    db.getEnabledInstancesByIds.mockResolvedValue([INSTANCES[0]]);
    const response = await gatewayPost(request({ jsonrpc: "2.0", id: "tool-result", method: "tools/call",
      params: { name: "alpha__echo", arguments: { input: "public" } },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", id: "tool-result", result: { isError } });
    expect(body).not.toHaveProperty("error");
    expect(trace.map((row) => row.frame.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(trace[2]).toMatchObject({ session: "session-alpha", protocol: PROTOCOL,
      frame: { id: 2, params: { name: "echo", arguments: { input: "public" } } },
    });
    expect(body.result.content).toHaveLength(3);
    expect(body.result.content.slice(1)).toEqual(result.content.slice(1));
    expect(body.result.content[0].annotations).toEqual(result.content[0].annotations);
    if (isError) {
      assertPrivate(body);
      expect(body.result.content[0].text).toContain("api_key=[redacted]");
      expect(body.result.content[0].text).toContain("<path>");
    } else {
      // Successful tool output is user data, not an error diagnostic.
      expect(body.result).toEqual(result);
    }
  });

  it("instance probe preserves successful tool count and sample", async () => {
    upstream();
    const response = await probePost(request({}, null), { params: Promise.resolve({ id: INSTANCES[0].id }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, toolCount: 2, sample: [
      { name: "echo", description: "Public echo" }, { name: "admin", description: "Public echo" },
    ] });
    expect(trace.map((row) => row.frame.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
  });

  it("instance probe hides upstream JSON-RPC list-error credentials and paths", async () => {
    upstream({ listError: `List unavailable: api_key=${SECRET} at ${PRIVATE_PATH}` });
    const response = await probePost(request({}, null, `/api/mcp-gateway/instances/${INSTANCES[0].id}/test`), {
      params: Promise.resolve({ id: INSTANCES[0].id }),
    });
    expect(db.getInstanceById).toHaveBeenCalledExactlyOnceWith(INSTANCES[0].id);
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body).toEqual({ ok: false, error: expect.stringContaining("tools/list failed for alpha") });
    expect(trace.map((row) => row.frame.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(trace.map((row) => row.frame.id)).toEqual([1, undefined, 2]);
    expect(trace.map((row) => row.session)).toEqual([null, "session-alpha", "session-alpha"]);
    expect(trace.every((row) => row.protocol === PROTOCOL)).toBe(true);
    // Assert secrecy only after proving the intended downstream failure path.
    assertPrivate({ headers: [...response.headers], body });
  });
});
