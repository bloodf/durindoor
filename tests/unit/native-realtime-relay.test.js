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

  it("bounds queued output for a stalled client", async () => {
    const { relay, upstream, client } = await fixture();
    client.bufferedAmount = 1024 * 1024 + 1;
    upstream.emit("message", "output", false);
    expect(client.close).toHaveBeenCalledWith(1013, "native realtime backpressure");
    expect(client.send).not.toHaveBeenCalled();
    relay.dispose();
  });
});
