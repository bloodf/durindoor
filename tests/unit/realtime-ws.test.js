import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "module";
import http from "http";
import { EventEmitter } from "events";
import { once } from "events";
import { WebSocket } from "ws";

const require = createRequire(import.meta.url);

// Vitest runs from the `tests/` cwd (per its config) but the repo modules under
// test live one level up. `require` resolves relative to THIS file via
// createRequire, so `../../custom-server.js` etc. reach the worktree root.
const cs = require("../../custom-server.js");
const realtimeCore = require("../../open-sse/handlers/realtimeCore.js");
const wsHandshake = require("../../src/shared/utils/wsHandshake.js");

const tick = () => new Promise((r) => queueMicrotask(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** EventEmitter-shaped fake that records listener counts like a real Server. */
function fakeServer() {
  const s = new EventEmitter();
  // EventEmitter already has on/listeners/removeAllListeners — duck-type passes.
  return s;
}

describe("custom-server CJS exports (loaded by bare Node)", () => {
  it("exposes the realtime dispatcher + helpers as plain functions", () => {
    expect(typeof cs.installRequestWrapper).toBe("function");
    expect(typeof cs.installRealtimeUpgradeDispatcher).toBe("function");
    expect(typeof cs.handleRealtimeUpgrade).toBe("function");
    expect(typeof cs.isHttpServer).toBe("function");
    expect(typeof cs.createOwnerAwareHandler).toBe("function");
    expect(typeof cs.REALTIME_DISPATCHER).toBe("symbol");
  });

  it("realtimeCore + wsHandshake are CommonJS with documented surfaces", () => {
    expect(typeof realtimeCore.createRealtimeSession).toBe("function");
    expect(typeof realtimeCore.buildChatBody).toBe("function");
    expect(typeof wsHandshake.extractRealtimeKey).toBe("function");
    expect(typeof wsHandshake.isRealtimePath).toBe("function");
    expect(typeof wsHandshake.probeApiKey).toBe("function");
    expect(typeof wsHandshake.selectProtocol).toBe("function");
  });
});

describe("isHttpServer duck-typing (shim-vs-Server guard)", () => {
  it("accepts a real http.Server", () => {
    const s = http.createServer(() => {});
    try { expect(cs.isHttpServer(s)).toBe(true); } finally { s.close(); }
  });

  it("rejects the createOwnerAwareHandler shim result (handler object, not a Server)", () => {
    expect(cs.isHttpServer({ handler: () => {} })).toBe(false);
    expect(cs.isHttpServer(null)).toBe(false);
    expect(cs.isHttpServer(() => {})).toBe(false);
  });
});

describe("installRealtimeUpgradeDispatcher — exactly one listener, correct routing", () => {
  it("on a bare Server: installs exactly one upgrade listener, replays Next listener once for non-realtime", async () => {
    const server = fakeServer();
    const nextListener = vi.fn();
    server.on("upgrade", nextListener); // mimic Next's registered listener

    cs.installRealtimeUpgradeDispatcher(server, { dashboardPort: 20128 });
    await tick(); // dispatcher rewires on a microtask

    const upgradeListeners = server.listeners("upgrade");
    expect(upgradeListeners).toHaveLength(1);
    expect(upgradeListeners[0]).not.toBe(nextListener); // replaced, not augmented

    // Non-realtime path → forwarded to captured Next listener exactly once.
    const req = { url: "/_next/webpack-hmr", headers: {} };
    const socket = { destroy: vi.fn() };
    server.emit("upgrade", req, socket, Buffer.from(""));
    expect(nextListener).toHaveBeenCalledTimes(1);
    expect(nextListener).toHaveBeenCalledWith(req, socket, Buffer.from(""));
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it("realtime path does NOT invoke the captured Next listener", async () => {
    // Real http.Server + real WebSocket: proves the dispatcher routes the
    // realtime upgrade to our WSS and NEVER fans it out to the captured Next
    // listener. The eager-frame integration test below additionally proves the
    // same on a fully-wired server; this isolates the routing decision.
    const nextListener = vi.fn();
    const server = http.createServer((req, res) => {
      if (req.url === "/api/v1/realtime/auth") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); return; }
      res.writeHead(404); res.end();
    });
    server.on("upgrade", nextListener);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    cs.installRealtimeUpgradeDispatcher(server, { dashboardPort: port });
    await tick();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/realtime?model=openai/gpt-4o-mini`);
      await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
      ws.close();
      await new Promise((r) => ws.once("close", r));
      expect(nextListener).not.toHaveBeenCalled();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("is idempotent — second install does not add a second dispatcher", async () => {
    const server = fakeServer();
    const nextListener = vi.fn();
    server.on("upgrade", nextListener);
    cs.installRealtimeUpgradeDispatcher(server, { dashboardPort: 20128 });
    cs.installRealtimeUpgradeDispatcher(server, { dashboardPort: 20128 });
    await tick();
    expect(server.listeners("upgrade")).toHaveLength(1);
  });

  it("skips non-Server targets (createOwnerAwareHandler shim regression)", () => {
    // The owner-handler path returns a bare handler function/object; installing
    // the dispatcher on it must be a no-op rather than crashing on .listeners().
    expect(() => cs.installRealtimeUpgradeDispatcher({ handler: () => {} }, { dashboardPort: 1 })).not.toThrow();
  });
});

describe("createOwnerAwareHandler regression", () => {
  it("still returns a usable handler function through installRequestWrapper", async () => {
    const handler = vi.fn();
    const wrapped = cs.createOwnerAwareHandler(handler);
    expect(typeof wrapped).toBe("function");
    const req = {
      method: "GET",
      url: "/health",
      headers: {},
      socket: { localAddress: "127.0.0.1", remoteAddress: "127.0.0.1", remotePort: 1234 },
    };
    const res = { writeHead: vi.fn(), end: vi.fn(), headersSent: false, writableEnded: false };
    wrapped(req, res);
    await tick(); // dispatch runs through the wrapper's Promise chain, even for GET
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("wsHandshake primitives", () => {
  it("isRealtimePath matches only /v1/realtime", () => {
    expect(wsHandshake.isRealtimePath("/v1/realtime")).toBe(true);
    expect(wsHandshake.isRealtimePath("/v1/realtime/")).toBe(true);
    expect(wsHandshake.isRealtimePath("/v1/realtime?model=x/y")).toBe(true);
    expect(wsHandshake.isRealtimePath("/v1/chat/completions")).toBe(false);
    expect(wsHandshake.isRealtimePath("/_next/webpack-hmr")).toBe(false);
  });

  it("extractRealtimeKey honors Bearer, subprotocol token, and ?key= — and never echoes the key protocol", () => {
    expect(wsHandshake.extractRealtimeKey({ url: "/v1/realtime", headers: { authorization: "Bearer abc" } }).key).toBe("abc");
    const sp = wsHandshake.extractRealtimeKey({
      url: "/v1/realtime",
      headers: { "sec-websocket-protocol": "realtime, openai-insecure-api-key.sk.123.with.dots" },
    });
    expect(sp.key).toBe("sk.123.with.dots");
    expect(sp.protocols).toEqual(["realtime"]); // key token excluded from echo list
    expect(wsHandshake.extractRealtimeKey({ url: "/v1/realtime?key=qk", headers: {} }).key).toBe("qk");
    expect(wsHandshake.extractRealtimeKey({ url: "/v1/realtime", headers: {} }).key).toBe(null);
  });

  it("selectProtocol only ever selects a safe allowlist protocol", () => {
    expect(wsHandshake.selectProtocol(new Set(["openai-insecure-api-key.leak", "realtime"]))).toBe("realtime");
    expect(wsHandshake.selectProtocol(new Set(["openai-insecure-api-key.leak"]))).toBe(false);
  });

  it("probeApiKey: 200 → ok, 401 → rejected-with-reason, throw → 503", async () => {
    const ok = await wsHandshake.probeApiKey({ key: "k", authUrl: "http://x", fetchFn: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }) });
    expect(ok.ok).toBe(true);
    const bad = await wsHandshake.probeApiKey({ key: "k", authUrl: "http://x", fetchFn: async () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 401 }) });
    expect(bad).toMatchObject({ ok: false, status: 401, reason: "nope" });
    const down = await wsHandshake.probeApiKey({ key: "k", authUrl: "http://x", fetchFn: async () => { throw new Error("ECONNREFUSED"); } });
    expect(down).toMatchObject({ ok: false, status: 503 });
  });
});

describe("realtimeCore — text modality bridge", () => {
  it("emits ordered delta + done sequence from an SSE chat response", async () => {
    const events = [];
    const ws = fakeWs((e) => events.push(e));
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const chat = async () => new Response(sseStream(sseBody), { status: 200, headers: { "content-type": "text/event-stream" } });
    const session = { id: "s", model: "openai/gpt-4o-mini", instructions: "", modalities: ["text"], items: [{ type: "message", role: "user", content: "hi" }] };
    const rt = realtimeCore.createRealtimeSession({ ws, session, chat, headers: {} });
    await rt.handleClientEvent(JSON.stringify({ type: "response.create" }));
    const types = events.map((e) => e.type);
    expect(types).toEqual(["response.created", "response.output_text.delta", "response.output_text.delta", "response.output_text.done", "response.done"]);
    expect(events.at(-1).response.status).toBe("completed");
    expect(events.filter((e) => e.type === "response.output_text.delta").map((e) => e.delta).join("")).toBe("hi!");
  });

  it("audio modality → error event, no upstream call", async () => {
    const events = [];
    const ws = fakeWs((e) => events.push(e));
    const chat = vi.fn();
    const session = { id: "s", model: "m", instructions: "", modalities: ["text", "audio"], items: [{ type: "message", role: "user", content: "x" }] };
    const rt = realtimeCore.createRealtimeSession({ ws, session, chat, headers: {} });
    await rt.handleClientEvent(JSON.stringify({ type: "response.create" }));
    expect(chat).not.toHaveBeenCalled();
    expect(events.at(-1).type).toBe("error");
    expect(events.at(-1).error.code).toBe("modality_not_supported");
  });

  it("two response.create in a row: second is rejected while first in flight", async () => {
    const events = [];
    const ws = fakeWs((e) => events.push(e));
    let resolveFirst;
    const chat = vi.fn(() => new Promise((r) => { resolveFirst = r; }));
    const session = { id: "s", model: "m", instructions: "", modalities: ["text"], items: [{ type: "message", role: "user", content: "x" }] };
    const rt = realtimeCore.createRealtimeSession({ ws, session, chat, headers: {} });
    const p1 = rt.handleClientEvent(JSON.stringify({ type: "response.create" }));
    const p2 = rt.handleClientEvent(JSON.stringify({ type: "response.create" }));
    resolveFirst(new Response(sseStream('data: {"choices":[{"delta":{"content":"a"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'), { status: 200, headers: { "content-type": "text/event-stream" } }));
    await Promise.all([p1, p2]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === "error" && e.error.code === "response_in_progress")).toBe(true);
  });
});

describe("integration: eager client frames survive the auth window, in order", () => {
  /** Boots a real http server + WSS against a stub auth/chat, closes after. */
  let server;
  afterEach(() => { if (server) { try { server.close(); } catch {} server = null; } });

  it("session.update sent immediately on open is applied before response.create runs", async () => {
    const seen = [];
    // Stub the loopback auth + chat by overriding fetch for the probe and
    // standing up a tiny chat handler on the same server. Simplest: point the
    // dispatcher at OUR port and serve both /api/v1/realtime/auth (200) and
    // /api/v1/chat/completions (SSE) from the request listener.
    server = http.createServer((req, res) => {
      if (req.url === "/api/v1/realtime/auth") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === "/api/v1/chat/completions") {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          seen.push(parsed);
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n');
          res.write("data: [DONE]\n\n");
          res.end();
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    cs.installRealtimeUpgradeDispatcher(server, { dashboardPort: port });
    await tick();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/realtime?model=openai/gpt-4o-mini`);
    const events = [];
    ws.on("message", (data) => events.push(JSON.parse(data.toString())));
    await once(ws, "open");

    // Fire session.update + item.create + response.create IMMEDIATELY — before
    // the server has finished its auth probe. All three must be queued and then
    // drained in order after session.created.
    ws.send(JSON.stringify({ type: "session.update", session: { instructions: "be terse" } }));
    ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: "say ok" } }));
    ws.send(JSON.stringify({ type: "response.create" }));

    await waitFor(() => events.some((e) => e.type === "response.done"), 3000);
    ws.close();

    // The chat body must reflect the session.update'd instructions AND the
    // queued user item — proving the eager frames survived and were applied in
    // order before response.create ran.
    expect(seen).toHaveLength(1);
    expect(seen[0].messages[0]).toEqual({ role: "system", content: "be terse" });
    expect(seen[0].messages.some((m) => m.role === "user" && m.content === "say ok")).toBe(true);
    expect(events.find((e) => e.type === "session.created")).toBeTruthy();
  });

  it("bad key → close 4001 with invalid_api_key (not server_error)", async () => {
    server = http.createServer((req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: { message: "Invalid API key" } }));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    cs.installRealtimeUpgradeDispatcher(server, { dashboardPort: port });
    await tick();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/realtime`, { headers: { Authorization: "Bearer bad" } });
    const closeInfo = await new Promise((resolve) => {
      ws.on("message", (data) => {
        const e = JSON.parse(data.toString());
        if (e.type === "error") ws.__lastError = e.error;
      });
      ws.on("close", (code) => resolve({ code, error: ws.__lastError }));
    });
    expect(closeInfo.code).toBe(4001);
    expect(closeInfo.error.code).toBe("invalid_api_key");
    expect(closeInfo.error.type).toBe("invalid_request_error");
  });

  it("auth probe outage → close 1011 with server_error/auth_probe_failed", async () => {
    // No request listener that handles /api/v1/realtime/auth → 404 from the
    // stub server; simulate outage by returning 503 directly.
    server = http.createServer((req, res) => {
      res.writeHead(503); res.end("down");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    cs.installRealtimeUpgradeDispatcher(server, { dashboardPort: port });
    await tick();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/realtime`);
    const closeInfo = await new Promise((resolve) => {
      ws.on("message", (data) => { const e = JSON.parse(data.toString()); if (e.type === "error") ws.__lastError = e.error; });
      ws.on("close", (code) => resolve({ code, error: ws.__lastError }));
    });
    expect(closeInfo.code).toBe(1011);
    expect(closeInfo.error.type).toBe("server_error");
    expect(closeInfo.error.code).toBe("auth_probe_failed");
  });
});

// --- tiny test helpers ---

function fakeWs(onEvent) {
  return {
    readyState: 1, // OPEN
    OPEN: 1,
    send: (raw) => onEvent(JSON.parse(raw)),
    on: () => {},
    close: () => {},
  };
}

function sseStream(text) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) { controller.enqueue(enc.encode(text)); controller.close(); },
  });
}

/**
 * Minimal socket good enough for ws `handleUpgrade` to either complete or
 * destroy without throwing synchronously; we only assert routing here.
 */
function makeHandshakeSocket() {
  const key = "dGhlIHNhbXBsZSBub25jZQ==";
  const socket = new EventEmitter();
  socket.headers = {
    "upgrade": "websocket",
    "connection": "Upgrade",
    "sec-websocket-key": key,
    "sec-websocket-version": "13",
  };
  socket.writable = true;
  socket.destroyed = false;
  socket.destroy = vi.fn(() => { socket.destroyed = true; });
  socket.write = vi.fn();
  socket.end = vi.fn();
  socket.setHeader = vi.fn();
  socket.pause = vi.fn();
  socket.resume = vi.fn();
  socket.setTimeout = vi.fn();
  socket.setNoDelay = vi.fn();
  socket.setKeepAlive = vi.fn();
  return socket;
}

async function waitFor(predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error("waitFor timed out");
}
