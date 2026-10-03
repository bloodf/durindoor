import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const { createNativeRealtimeRelay } = require("../../open-sse/handlers/nativeRealtimeRelay.js");

async function fixture(options = {}) {
  const upstream = new EventEmitter();
  Object.assign(upstream, { readyState: 1, OPEN: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() });
  const client = new EventEmitter();
  Object.assign(client, { readyState: 1, OPEN: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() });
  const relay = await createNativeRealtimeRelay({ client, wsUrl: "wss://api.openai.com/v1/realtime", authorization: ["Bearer", "vendor-fixture"].join(" "), webSocketFactory: () => upstream, ...options });
  upstream.emit("open");
  await relay.opened;
  return { relay, upstream, client };
}

describe("native realtime authorization", () => {
  it("denies an escaped JSON model key instead of bypassing model policy", async () => {
    const { relay, upstream, client } = await fixture({ authorizeModel: async (model) => { if (model === "forbidden-model") throw new Error("denied"); } });
    await relay.handleClientEvent(String.raw`{"type":"session.start","session":{"\u006dodel":"forbidden-model"}}`, false);
    expect(client.close).toHaveBeenCalledWith(4001, "native realtime model access denied");
    expect(upstream.send).not.toHaveBeenCalled();
    relay.dispose();
  });

  it("denies a forbidden delegated Live model before it reaches the provider", async () => {
    const { relay, upstream, client } = await fixture({ authorizeModel: async (model) => { if (model === "expensive-model") throw new Error("denied"); } });
    await relay.handleClientEvent(JSON.stringify({ type: "session.start", session: { model: "allowed-model", delegation: { type: "responses", responses: { model: "expensive-model" } } } }), false);
    expect(client.close).toHaveBeenCalledWith(4001, "native realtime model access denied");
    expect(upstream.send).not.toHaveBeenCalled();
    relay.dispose();
  });
  it("preserves exact JSON numbers while rewriting only authorized model slots", async () => {
    const { relay, upstream } = await fixture({ authorizeModel: async () => {} });
    const event = '{"type":"session.update","session":{"model":"openai/gpt-realtime"},"item_id":9007199254740993}';
    await relay.handleClientEvent(event, false);
    expect(upstream.send).toHaveBeenCalledWith(event.replace("openai/gpt-realtime", "gpt-realtime"), { binary: false });
    relay.dispose();
  });

  it("does not expose terminal provider output when strict accounting throws", async () => {
    const { relay, upstream, client } = await fixture({ onProviderEvent: async () => { throw new Error("disk unavailable"); } });
    upstream.emit("message", '{"type":"response.done","response":{"usage":{"total_tokens":3}}}', false);
    await vi.waitFor(() => expect(client.close).toHaveBeenCalledWith(1008, "Usage limit reached"));
    expect(client.send).not.toHaveBeenCalled();
    relay.dispose();
  });


  it("closes malformed model slot structures instead of forwarding", async () => {
    const { relay, upstream, client } = await fixture({ authorizeModel: async () => {} });
    await relay.handleClientEvent(JSON.stringify({ type: "session.update", session: { tools: {} } }), false);
    expect(client.close).toHaveBeenCalledWith(1007, "invalid native realtime event");
    expect(upstream.send).not.toHaveBeenCalled();
    relay.dispose();
  });
  it("does not forward after relay disposal during authorization", async () => {
    let releaseAuthorization;
    const authorization = new Promise((resolve) => { releaseAuthorization = resolve; });
    const { relay, upstream } = await fixture({ authorizeModel: vi.fn(() => authorization) });
    const handling = relay.handleClientEvent(JSON.stringify({ type: "session.update", session: { model: "allowed-model" } }), false);
    relay.dispose();
    releaseAuthorization();
    await handling;
    expect(upstream.send).not.toHaveBeenCalled();
  });


  it("bounds queued output for a stalled client", async () => {
    const { relay, upstream, client } = await fixture();
    client.bufferedAmount = 1024 * 1024 + 1;
    upstream.emit("message", "output", false);
    expect(client.close).toHaveBeenCalledWith(1013, "native realtime backpressure");
    expect(client.send).not.toHaveBeenCalled();
    relay.dispose();
  });

  it("serializes delayed provider accounting without reordering frames", async () => {
    let release;
    const first = new Promise((resolve) => { release = resolve; });
    const onProviderEvent = vi.fn(async (event) => { if (event.id === 1) await first; return true; });
    const { relay, upstream, client } = await fixture({ onProviderEvent });
    upstream.emit("message", '{"id":1}', false);
    upstream.emit("message", '{"id":2}', false);
    expect(client.send).not.toHaveBeenCalled();
    release();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(client.send.mock.calls.map(([data]) => data)).toEqual(['{"id":1}', '{"id":2}']);
    relay.dispose();
  });

  it("forwards terminal provider frame unchanged before closing exhausted key", async () => {
    const onProviderEvent = vi.fn(async (event) => event.type !== "response.done");
    const { relay, upstream, client } = await fixture({ onProviderEvent });
    const frame = '{"type":"response.done","response":{"usage":{"total_tokens":3}}}';
    upstream.emit("message", Buffer.from(frame), false);
    await new Promise((resolve) => setImmediate(resolve));
    expect(client.send).toHaveBeenCalledWith(Buffer.from(frame), { binary: false });
    expect(onProviderEvent).toHaveBeenCalledWith(JSON.parse(frame));
    expect(client.close).toHaveBeenCalledWith(1008, "Usage limit reached");
    expect(upstream.close).toHaveBeenCalled();
    relay.dispose();
  });

  it("forwards accounted terminal frame before upstream close", async () => {
    let release;
    const accounted = new Promise((resolve) => { release = resolve; });
    const { relay, upstream, client } = await fixture({ onProviderEvent: async () => accounted });
    const frame = '{"type":"response.done"}';
    upstream.emit("message", frame, false);
    upstream.emit("close", 1000);
    release(false);
    await new Promise((resolve) => setImmediate(resolve));
    expect(client.send).toHaveBeenCalledWith(frame, { binary: false });
    expect(client.close).toHaveBeenCalledWith(1008, "Usage limit reached");
    relay.dispose();
  });

  it("rejects configured proxy construction failure instead of connecting direct", async () => {
    const client = Object.assign(new EventEmitter(), { readyState: 1, OPEN: 1 });
    const webSocketFactory = vi.fn();
    await expect(createNativeRealtimeRelay({
      client, wsUrl: "wss://api.openai.com/v1/realtime", authorization: "Bearer vendor-fixture",
      proxy: { enabled: true, url: "http://proxy.invalid", strict: false },
      agentFactory: async () => { throw new Error("missing agent"); }, webSocketFactory
    })).rejects.toThrow("native realtime proxy unavailable");
    expect(webSocketFactory).not.toHaveBeenCalled();
  });

  it("rejects configured proxy without constructed agent instead of connecting direct", async () => {
    const client = Object.assign(new EventEmitter(), { readyState: 1, OPEN: 1 });
    const webSocketFactory = vi.fn();
    await expect(createNativeRealtimeRelay({
      client, wsUrl: "wss://api.openai.com/v1/realtime", authorization: "Bearer vendor-fixture",
      proxy: { enabled: true, url: "http://proxy.invalid" }, agentFactory: async () => null, webSocketFactory
    })).rejects.toThrow("native realtime proxy unavailable");
    expect(webSocketFactory).not.toHaveBeenCalled();
  });

  it("rejects enabled proxy missing its URL instead of connecting direct", async () => {
    const client = Object.assign(new EventEmitter(), { readyState: 1, OPEN: 1 });
    const webSocketFactory = vi.fn();
    await expect(createNativeRealtimeRelay({ client, wsUrl: "wss://api.openai.com/v1/realtime", authorization: "Bearer vendor-fixture", proxy: { enabled: true }, webSocketFactory })).rejects.toThrow("native realtime proxy unavailable");
    expect(webSocketFactory).not.toHaveBeenCalled();
  });

  it("does not construct upstream after client disconnects during proxy load", async () => {
    let releaseAgent;
    const loaded = new Promise((resolve) => { releaseAgent = resolve; });
    const controller = new AbortController();
    const client = Object.assign(new EventEmitter(), { readyState: 1, OPEN: 1, CLOSED: 3 });
    const webSocketFactory = vi.fn();
    const creating = createNativeRealtimeRelay({
      client, wsUrl: "wss://api.openai.com/v1/realtime", authorization: "Bearer vendor-fixture",
      proxy: { enabled: true, url: "http://proxy.invalid" }, signal: controller.signal,
      agentFactory: () => loaded, webSocketFactory
    });
    client.readyState = client.CLOSED;
    controller.abort();
    releaseAgent({});
    await expect(creating).rejects.toThrow("native realtime client disconnected");
    expect(webSocketFactory).not.toHaveBeenCalled();
  });
});
