// Issue 2526: MCP gateway SSE base path, `?key=` auth and stream lifetime.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  active: new Set(),
  validateGatewayKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  validateGatewayKey: mocks.validateGatewayKey,
  getGrantsForKeyDetailed: vi.fn(async () => []),
  getEnabledInstancesByIds: vi.fn(async () => []),
  saveRequestUsage: vi.fn(async () => {}),
  getSettings: vi.fn(async () => ({ requireLogin: true })),
  validateApiKey: vi.fn(async () => false),
  getApiKeyByKey: vi.fn(async () => null),
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn(async () => "cli-token") }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: vi.fn(async () => false) }));
vi.mock("@/lib/db/repos/usageRepo.js", () => ({ getBillingEpoch: vi.fn(async () => 0) }));

const { GET } = await import("../../src/app/api/mcp-gateway/sse/route.js");
const { POST } = await import("../../src/app/api/mcp-gateway/message/route.js");
const sessions = await import("../../src/lib/mcp/gateway/sseSessions.js");
const { proxy } = await import("../../src/dashboardGuard.js");

const ORIGIN = "https://router.example";
const PAST_TTL_MS = sessions.__test__.SESSION_TTL_MS + 2 * sessions.__test__.SWEEP_INTERVAL_MS;
const decoder = new TextDecoder();
const readers = [];

function handshake({ query = "?key=key-a", headers = {}, basePath } = {}) {
  const request = new Request(`${ORIGIN}/api/mcp-gateway/sse${query}`, { headers });
  if (basePath !== undefined) Object.defineProperty(request, "nextUrl", { value: { basePath } });
  return GET(request);
}

async function open(options) {
  const response = await handshake(options);
  expect(response.status).toBe(200);
  const reader = response.body.getReader();
  readers.push(reader);
  const first = decoder.decode((await reader.read()).value);
  const endpoint = first.match(/data: ([^\n]+)/)[1];
  return { reader, endpoint, sid: new URL(endpoint, ORIGIN).searchParams.get("sessionId") };
}

/** Keep consuming a stream, as a live client does. */
function drain(reader) {
  const seen = { text: "", done: false };
  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      seen.text += decoder.decode(value);
    }
    seen.done = true;
  })();
  return seen;
}

function post(path, headers = {}) {
  return POST(new Request(new URL(path, ORIGIN), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }),
  }));
}

beforeEach(() => {
  mocks.active = new Set(["key-a", "key-b"]);
  mocks.validateGatewayKey.mockImplementation(async (raw) => (mocks.active.has(raw) ? { id: `id-${raw}` } : null));
});

afterEach(async () => {
  await Promise.all(readers.splice(0).map((reader) => reader.cancel().catch(() => {})));
  sessions.__test__.getStore().clear();
  sessions.__test__.stopSweeper();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("endpoint event", () => {
  it("prefixes the app base path", async () => {
    const { endpoint } = await open({ basePath: "/durin" });
    expect(endpoint).toMatch(/^\/durin\/api\/mcp-gateway\/message\?sessionId=[\w-]+$/);
  });

  it("is unprefixed without a base path and never carries the key", async () => {
    const { endpoint } = await open({ basePath: "" });
    expect(endpoint).toMatch(/^\/api\/mcp-gateway\/message\?sessionId=[\w-]+$/);
  });
});

describe("?key= sessions", () => {
  it("answers over the stream when the advertised URL is posted without a key", async () => {
    const { reader, endpoint } = await open();
    const response = await post(endpoint);
    expect(response.status).toBe(202);
    const frame = decoder.decode((await reader.read()).value);
    expect(frame).toBe(`event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{}}\n\n`);
  });

  it("still accepts header auth on the message URL", async () => {
    const { endpoint } = await open();
    expect((await post(endpoint, { Authorization: "Bearer key-a" })).status).toBe(202);
    expect((await post(endpoint, { "x-api-key": "key-a" })).status).toBe(202);
  });

  it("keeps the session bound to its key", async () => {
    const { endpoint } = await open();
    expect((await post(endpoint, { Authorization: "Bearer key-b" })).status).toBe(404);
    expect((await post(endpoint, { Authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("stops working once the key is revoked", async () => {
    const { endpoint } = await open();
    mocks.active.delete("key-a");
    expect((await post(endpoint)).status).toBe(401);
  });

  it("rejects a keyless post for a header-authenticated or unknown session", async () => {
    const { endpoint } = await open({ query: "", headers: { Authorization: "Bearer key-a" } });
    expect((await post(endpoint)).status).toBe(401);
    expect((await post("/api/mcp-gateway/message?sessionId=unknown")).status).toBe(401);
  });
});

describe("remote callers behind the dashboard guard", () => {
  // Without the wrapper's peer proof no request counts as loopback.
  beforeEach(() => vi.stubEnv("NINEROUTER_PEER_TOKEN", ""));

  const remote = (path, { method = "POST", headers = {} } = {}) => new NextRequest(new URL(path, ORIGIN), {
    method,
    headers: { host: "router.example", "Content-Type": "application/json", ...headers },
    ...(method === "POST" ? { body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }) } : null),
  });
  const passes = (response) => response.headers.get("x-middleware-next") === "1";

  /** What Next does: the guard first, then the route when the guard passes. */
  async function guardedPost(path, options) {
    const request = remote(path, options);
    const guard = await proxy(request);
    return passes(guard) ? POST(request) : guard;
  }

  it("completes the ?key= flow with no key on the message POST", async () => {
    expect(passes(await proxy(remote("/api/mcp-gateway/sse?key=key-a", { method: "GET" })))).toBe(true);
    const { reader, endpoint } = await open();
    expect((await guardedPost(endpoint)).status).toBe(202);
    expect(decoder.decode((await reader.read()).value)).toContain(`"id":7`);
  });

  it("leaves authentication of a keyless message to the route", async () => {
    const { endpoint } = await open({ query: "", headers: { Authorization: "Bearer key-a" } });
    for (const path of [endpoint, "/api/mcp-gateway/message?sessionId=unknown"]) {
      const response = await guardedPost(path);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
  });

  it.each([
    ["a message GET", "/api/mcp-gateway/message?sessionId=s", { method: "GET" }],
    ["a message POST without sessionId", "/api/mcp-gateway/message", {}],
    ["a message POST with an empty sessionId", "/api/mcp-gateway/message?sessionId=", {}],
    ["the SSE surface", "/api/mcp-gateway/sse?sessionId=s", {}],
    ["streamable HTTP", "/api/mcp-gateway?sessionId=s", {}],
    ["an invalid header key", "/api/mcp-gateway/message?sessionId=s", { headers: { Authorization: "Bearer wrong" } }],
    ["an invalid query key", "/api/mcp-gateway/message?sessionId=s&key=wrong", {}],
  ])("still requires a gateway key for %s", async (_label, path, options) => {
    const response = await proxy(remote(path, options));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "gateway key required" });
  });
});

describe("stream lifetime and caps", () => {
  beforeEach(() => vi.useFakeTimers());

  it("pings a live stream so it outlives the idle TTL and still takes messages", async () => {
    const { reader, endpoint } = await open();
    const seen = drain(reader);
    await vi.advanceTimersByTimeAsync(PAST_TTL_MS);
    expect(seen.text).toContain(": ping\n\n");
    expect(seen.done).toBe(false);
    expect((await post(endpoint)).status).toBe(202);
  });

  it("holds the per-key cap across sweeps while streams stay open", async () => {
    for (let i = 0; i < sessions.MAX_SESSIONS_PER_KEY; i++) drain((await open()).reader);
    await vi.advanceTimersByTimeAsync(PAST_TTL_MS);
    expect((await handshake()).status).toBe(429);
  });

  it("closes stalled streams on sweep and frees their cap slots", async () => {
    const stalled = [];
    for (let i = 0; i < sessions.MAX_SESSIONS_PER_KEY; i++) stalled.push((await open()).reader);
    // Leave one unread chunk queued on each stream: the client stopped reading.
    for (const entry of sessions.__test__.getStore().values()) entry.send("data: stuck\n\n");
    await vi.advanceTimersByTimeAsync(PAST_TTL_MS);
    expect(sessions.__test__.getStore().size).toBe(0);
    for (const reader of stalled) {
      expect(decoder.decode((await reader.read()).value)).toBe("data: stuck\n\n");
      expect((await reader.read()).done).toBe(true);
    }
    await open();
  });

  it("closes the stream when a session is unregistered", async () => {
    const { reader, sid } = await open();
    sessions.unregisterSession(sid);
    expect((await reader.read()).done).toBe(true);
  });
});
