"use strict";

const { WebSocket } = require("ws");
const { collectNativeModelSlots } = require("./nativeModelSlots.cjs");
const MAX_BUFFERED_BYTES = 1024 * 1024;

function relayCloseCode(code) {
  return Number.isInteger(code) && code >= 1000 && code <= 4999 && code !== 1004 && code !== 1005 && code !== 1006 ? code : 1011;
}

async function createNativeRealtimeRelay({ client, wsUrl, authorization, proxy = null, connectTimeoutMs = 10_000, webSocketFactory = null, agentFactory = null, authorizeModel = null, binaryAudio = false }) {
  if (typeof wsUrl !== "string" || !wsUrl.startsWith("wss://")) throw new Error("invalid native realtime endpoint");
  if (typeof authorization !== "string" || !authorization) throw new Error("missing native realtime authorization");
  let agent;
  if (proxy?.enabled && proxy.url) {
    try {
      const scheme = new URL(proxy.url).protocol;
      if (scheme === "http:" || scheme === "https:") agent = agentFactory ? await agentFactory(proxy.url) : new (await import("https-proxy-agent")).HttpsProxyAgent(proxy.url);else
      if (scheme === "socks:" || scheme === "socks4:" || scheme === "socks5:") agent = agentFactory ? await agentFactory(proxy.url) : new (await import("socks-proxy-agent")).SocksProxyAgent(proxy.url);else
      throw new Error("unsupported native realtime proxy");
    } catch {
      if (proxy.strict) throw new Error("native realtime proxy unavailable");
    }
  }

  let disposed = false;
  let timeout;
  const options = { headers: { Authorization: authorization }, ...(agent ? { agent } : null) };
  const upstream = webSocketFactory ? webSocketFactory(wsUrl, options) : new WebSocket(wsUrl, options);
  const opened = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      try {upstream.close(1011, "native realtime connect timeout");} catch {/* already closed */}
      reject(new Error("native realtime connect timeout"));
    }, connectTimeoutMs);
    upstream.once("open", () => { clearTimeout(timeout); resolve(); });
    upstream.once("error", (error) => { clearTimeout(timeout); reject(error); });
  });
  upstream.on("message", (data, isBinary) => {
    if (!disposed && client.readyState === client.OPEN) {
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) { client.close(1013, "native realtime backpressure"); return; }
      client.send(data, { binary: isBinary });
    }
  });
  upstream.on("error", () => {
    if (!disposed && client.readyState === client.OPEN) client.close(1011, "native realtime upstream failed");
  });
  upstream.on("close", (code) => {
    clearTimeout(timeout);
    if (!disposed && client.readyState === client.OPEN) client.close(relayCloseCode(code));
  });

  return {
    opened,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeout);
      try {upstream.close();} catch {/* already closed */}
    },
    async handleClientEvent(data, isBinary) {
      if (disposed || upstream.readyState !== upstream.OPEN) return;
      if (upstream.bufferedAmount > MAX_BUFFERED_BYTES) { client.close(1013, "native realtime backpressure"); return; }
      if (authorizeModel && (!isBinary || !binaryAudio)) {
        let event;
        try { event = JSON.parse(data.toString()); } catch { client.close(1007, "invalid native realtime event"); return; }
        for (const slot of collectNativeModelSlots(event)) {
          const value = slot.holder[slot.key];
          try { await authorizeModel(value); } catch { client.close(4001, "native realtime model access denied"); return; }
          if (value.includes("/")) slot.holder[slot.key] = value.slice(value.indexOf("/") + 1);
        }
        data = JSON.stringify(event);
      }
      if (!disposed && upstream.readyState === upstream.OPEN) upstream.send(data, { binary: isBinary });
    }
  };
}

module.exports = { createNativeRealtimeRelay, relayCloseCode };
