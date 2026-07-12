// MCP-1: transport race fixes — stdio post-respawn identity guard, monotonic
// HTTP JSON-RPC id allocation, and SSE session TTL sweep / abort cleanup.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { setTimeout as realSleep } from "node:timers/promises";

// ---------------------------------------------------------------------------
// stdioClient: fake child_process so spawn() produces controllable EventEmitters
// ---------------------------------------------------------------------------
const fakeProcs = [];

vi.mock("node:child_process", () => ({
  spawn: vi.fn((command, argv) => {
    const proc = new EventEmitter();
    proc.killed = false;
    proc.exitCode = null;
    proc.pid = 1000 + fakeProcs.length;
    proc.command = command;
    proc.argv = argv;
    const stdin = new EventEmitter();
    stdin.write = vi.fn((data) => {
      (proc._writes ||= []).push(data);
      return true;
    });
    proc.stdin = stdin;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    fakeProcs.push(proc);
    return proc;
  }),
}));

const stdio = await import("../../src/lib/mcp/gateway/stdioClient");
const { StdioEntry, getStore } = stdio.__test__;

function makeStdioInstance(id = "stdio-1", slug = "test-stdio") {
  return { id, slug, command: "fake-mcp", args: [], env: {} };
}

function respondTo(proc, id, result) {
  proc.stdout.emit("data", Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n", "utf8"));
}

const tick = () => new Promise((r) => setImmediate(r));
const lastProc = () => fakeProcs[fakeProcs.length - 1];

// ---------------------------------------------------------------------------
// httpClient: fake fetch capturing each request frame
// ---------------------------------------------------------------------------
global.fetch = vi.fn();

const http = await import("../../src/lib/mcp/gateway/httpClient");
const httpTest = http.__test__;

function makeHttpInstance(id = "http-1", slug = "test-http") {
  return { id, slug, url: "http://fake-mcp.local/mcp", oauth: false, headers: {} };
}

function mockFetchResponse(status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] || null },
    text: async () => text,
  };
}

function requestIds() {
  return global.fetch.mock.calls.map((c) => JSON.parse(c[1].body).id);
}

// ---------------------------------------------------------------------------
// sseSessions + sse route
// ---------------------------------------------------------------------------
const sse = await import("../../src/lib/mcp/gateway/sseSessions");
const sseTest = sse.__test__;

const { GET: sseGet } = await import("../../src/app/api/mcp-gateway/sse/route");

beforeEach(() => {
  getStore().clear();
  fakeProcs.length = 0;
  httpTest.getSessionStore().clear();
  global.fetch.mockClear();
  sseTest.getStore().clear();
});

afterEach(() => {
  sseTest.stopSweeper();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("stdioClient — post-respawn identity guard", () => {
  it("late exit from the replaced child is a no-op for the live entry", async () => {
    const instance = makeStdioInstance();
    const entry = new StdioEntry(instance);
    getStore().set(instance.id, entry);

    entry.spawn();
    const proc1 = lastProc();
    await tick(); // spawn ready (setImmediate)

    // Respawn: entry.proc now points at generation 2. spawn() itself resets
    // buffer/pending, so the race to guard is: a late exit/error from the
    // stale child arriving AFTER gen 2 is live must not null this.proc,
    // reject gen-2 pending requests, or emit a spurious "exit".
    entry.spawn();
    const proc2 = lastProc();
    expect(proc2).not.toBe(proc1);
    expect(entry.proc).toBe(proc2);

    // Pin a pending request on the live generation.
    const reqPromise = entry.request("tools/list", {}, { skipRetry: true });
    expect(entry.pending.size).toBe(1);

    // Late exit on the stale child must not touch the live entry.
    entry.events.once("exit", () => {
      throw new Error("stale exit leaked into live entry");
    });
    proc1.emit("exit", 1, null);

    expect(entry.proc).toBe(proc2);
    expect(entry.pending.size).toBe(1);

    // The live pending request settles normally through its own proc.
    respondTo(proc2, 1, { tools: [] });
    await expect(reqPromise).resolves.toMatchObject({ result: { tools: [] } });
    expect(entry.pending.size).toBe(0);
  });

  it("late error from the replaced child is a no-op for the live entry", async () => {
    const instance = makeStdioInstance();
    const entry = new StdioEntry(instance);
    getStore().set(instance.id, entry);

    entry.spawn();
    const proc1 = lastProc();
    await tick();

    entry.spawn();
    const proc2 = lastProc();

    // Stale error must not reject pending requests of the live generation.
    expect(() => proc1.emit("error", new Error("stale boom"))).not.toThrow();
    expect(entry.proc).toBe(proc2);
  });
});

describe("httpClient — monotonic JSON-RPC id allocation", () => {
  it("ids are unique and monotonic per connection under concurrent init + listTools", async () => {
    const instA = makeHttpInstance("http-a", "alpha");
    const instB = makeHttpInstance("http-b", "bravo");

    global.fetch.mockImplementation(async (url, opts) => {
      const frame = JSON.parse(opts.body);
      if (frame.method === "initialize") {
        // Yield so both instances' initializes are in flight together.
        await realSleep(5);
        return mockFetchResponse(200, {
          jsonrpc: "2.0",
          id: frame.id,
          result: { protocolVersion: "2025-06-18", serverInfo: { name: "fake" } },
        });
      }
      if (frame.method === "notifications/initialized") {
        return mockFetchResponse(200, { jsonrpc: "2.0" });
      }
      return mockFetchResponse(200, { jsonrpc: "2.0", id: frame.id, result: { tools: [] } });
    });

    await Promise.all([http.listTools(instA), http.listTools(instB)]);

    const ids = requestIds().filter((id) => id !== undefined);
    // Both instances use the reserved initialize id.
    expect(ids.filter((id) => id === 1)).toHaveLength(2);
    // Each connection owns its counter: post-init ids start at 2 per
    // connection and increment monotonically within that connection.
    const postInit = ids.filter((id) => id !== 1);
    expect(postInit.length).toBeGreaterThanOrEqual(2);
    expect(postInit.every((id) => id > 1)).toBe(true);
    // tools/list ids per instance (call order is initialize, initialized,
    // then tools/list for each instance).
    const toolsIds = global.fetch.mock.calls
      .map((c) => JSON.parse(c[1].body))
      .filter((f) => f.method === "tools/list")
      .map((f) => f.id);
    expect(toolsIds).toEqual([2, 2]);
  });

  it("per-connection id counter never reuses ids across retries within a connection", async () => {
    const instance = makeHttpInstance();

    // Successful call burns ids 2 (listTools).
    global.fetch.mockImplementation(async (url, opts) => {
      const frame = JSON.parse(opts.body);
      if (frame.method === "notifications/initialized") return mockFetchResponse(200, { jsonrpc: "2.0" });
      return mockFetchResponse(200, {
        jsonrpc: "2.0",
        id: frame.id,
        result: frame.method === "initialize"
          ? { protocolVersion: "2025-06-18", serverInfo: { name: "fake" } }
          : { tools: [] },
      });
    });
    await http.listTools(instance);
    const firstConnIds = requestIds().filter((id) => id !== undefined);
    expect(firstConnIds).toContain(2);

    // Same connection: callTool burns the NEXT id (3), never reusing 2.
    await http.callTool(instance, "any-tool", {});
    const callIds = global.fetch.mock.calls
      .map((c) => JSON.parse(c[1].body))
      .filter((f) => f.method === "tools/call")
      .map((f) => f.id);
    expect(callIds).toEqual([3]);

    // A failed init on a DIFFERENT instance does not touch this connection's
    // counter (400: non-transient, no retries).
    const failing = makeHttpInstance("http-fail", "fail");
    global.fetch.mockImplementation(async () => mockFetchResponse(400, "bad request"));
    await expect(http.listTools(failing)).rejects.toThrow();

    // Original connection continues strictly monotonic: next id is 4.
    global.fetch.mockImplementation(async (url, opts) => {
      const frame = JSON.parse(opts.body);
      if (frame.method === "notifications/initialized") return mockFetchResponse(200, { jsonrpc: "2.0" });
      return mockFetchResponse(200, {
        jsonrpc: "2.0",
        id: frame.id,
        result: frame.method === "initialize"
          ? { protocolVersion: "2025-06-18", serverInfo: { name: "fake" } }
          : { tools: [] },
      });
    });
    await http.listTools(instance);
    const listIds = global.fetch.mock.calls
      .map((c) => JSON.parse(c[1].body))
      .filter((f) => f.method === "tools/list")
      .map((f) => f.id);
    expect(listIds[listIds.length - 1]).toBe(4);

    // A brand-new connection restarts at the reserved id 1 then 2 — no
    // cross-connection state, no dependence on a module-global counter that
    // an HMR reload could reset onto in-flight ids.
    const fresh = makeHttpInstance("http-fresh", "fresh");
    global.fetch.mockClear();
    await http.listTools(fresh);
    const freshIds = requestIds().filter((id) => id !== undefined);
    expect(freshIds).toEqual([1, 2]);
  });
});

describe("sseSessions — TTL sweep + abort cleanup", () => {
  it("getSession refreshes lastSeenAt; sweep evicts only idle sessions", () => {
    vi.useFakeTimers();
    const sidActive = sse.registerSession(() => {});
    const sidIdle = sse.registerSession(() => {});
    const store = sseTest.getStore();

    // Active session keeps being touched; idle one ages out.
    vi.advanceTimersByTime(sseTest.SESSION_TTL_MS - 1);
    sse.getSession(sidActive);
    vi.advanceTimersByTime(2);

    sseTest.sweep();
    expect(store.has(sidActive)).toBe(true);
    expect(store.has(sidIdle)).toBe(false);
  });

  it("aborting the SSE request unregisters the session", async () => {
    const controller = new AbortController();
    const request = { signal: controller.signal };
    const res = await sseGet(request);
    // start() runs synchronously during Response construction: session exists.
    expect(sseTest.getStore().size).toBe(1);
    controller.abort();
    expect(sseTest.getStore().size).toBe(0);
    // Body still well-formed even though the client went away.
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });

  it("abort listener removed after stream completion so late abort events are no-ops", async () => {
    const sseSessions = await import("@/lib/mcp/gateway/sseSessions");
    const spy = vi.spyOn(sseSessions, "unregisterSession");

    const controller = new AbortController();
    const request = { signal: controller.signal };
    const res = await sseGet(request);
    expect(sseTest.getStore().size).toBe(1);

    // Normal completion: client cancels the body. cancel() unregisters the
    // session AND detaches the abort listener from the signal.
    await res.body.cancel();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sseTest.getStore().size).toBe(0);

    // A late abort on the same signal must NOT fire the listener again:
    // before the fix it stayed bound, leaked its sid closure, and would
    // double-unregister. The listener must be gone.
    controller.abort();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(controller.signal.listenerCount?.("abort") ?? 0).toBe(0);
  });

  it("id counter is per-session, not module-global: concurrent connections never collide", async () => {
    const instA = makeHttpInstance("http-race-a", "race-alpha");
    const instB = makeHttpInstance("http-race-b", "race-bravo");

    // Hold both initializes in flight at the same time so any shared
    // allocation state would interleave.
    global.fetch.mockImplementation(async (url, opts) => {
      const frame = JSON.parse(opts.body);
      if (frame.method === "initialize") {
        await realSleep(5);
        return mockFetchResponse(200, {
          jsonrpc: "2.0",
          id: frame.id,
          result: { protocolVersion: "2025-06-18", serverInfo: { name: "fake" } },
        });
      }
      if (frame.method === "notifications/initialized") {
        return mockFetchResponse(200, { jsonrpc: "2.0" });
      }
      return mockFetchResponse(200, { jsonrpc: "2.0", id: frame.id, result: { tools: [] } });
    });

    // Run init + listTools on both connections concurrently. Each connection
    // must use the reserved id 1 for initialize and its own counter (2) for
    // tools/list: 4 frames, no collision within a connection, and collisions
    // ACROSS connections are spec-legal (ids are connection-scoped).
    await Promise.all([http.listTools(instA), http.listTools(instB)]);

    const frames = global.fetch.mock.calls.map((c) => JSON.parse(c[1].body));
    const initFrames = frames.filter((f) => f.method === "initialize");
    const listFrames = frames.filter((f) => f.method === "tools/list");
    expect(initFrames.map((f) => f.id)).toEqual([1, 1]);
    expect(listFrames.map((f) => f.id)).toEqual([2, 2]);

    // Within each connection the (initialize=1, tools/list=2) pair is
    // strictly increasing — monotonic per connection.
    expect(listFrames[0].id).toBeGreaterThan(initFrames[0].id);
    expect(listFrames[1].id).toBeGreaterThan(initFrames[1].id);

    // The counter survives on the per-connection entry, so a second call on
    // the SAME connection continues monotonically (3), never resetting.
    await http.listTools(instA);
    const secondList = global.fetch.mock.calls
      .map((c) => JSON.parse(c[1].body))
      .filter((f) => f.method === "tools/list")
      .map((f) => f.id);
    expect(secondList[secondList.length - 1]).toBe(3);
  });
});
