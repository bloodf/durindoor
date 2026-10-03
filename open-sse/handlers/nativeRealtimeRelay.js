"use strict";

const { WebSocket } = require("ws");
const { collectNativeModelSlots } = require("./nativeModelSlots.cjs");
const { isObject, isString } = require("../../src/shared/utils/typeChecks.cjs");
const { applyEdits, findNodeAtLocation, parseTree } = require("jsonc-parser");
const MAX_BUFFERED_BYTES = 1024 * 1024;

function relayCloseCode(code) {
  return Number.isInteger(code) && code >= 1000 && code <= 4999 && code !== 1004 && code !== 1005 && code !== 1006 ? code : 1011;
}

async function createNativeRealtimeRelay({ client, wsUrl, authorization = null, queryAuthParameter = null, proxy = null, connectTimeoutMs = 10_000, webSocketFactory = null, agentFactory = null, authorizeModel = null, binaryAudio = false, geminiLive = false, pinnedModel = null, onProviderEvent = null, onProviderClose = null, signal = null }) {
  if (!isString(wsUrl) || !wsUrl.startsWith("wss://")) throw new Error("invalid native realtime endpoint");
  const queryAuthorization = queryAuthParameter && new URL(wsUrl).searchParams.getAll(queryAuthParameter);
  if (queryAuthorization && (queryAuthorization.length !== 1 || !queryAuthorization[0])) throw new Error("missing native realtime authorization");
  if ((!queryAuthorization && (!isString(authorization) || !authorization)) || (queryAuthorization && authorization)) throw new Error("missing native realtime authorization");
  if (signal?.aborted || client.readyState !== client.OPEN) throw new Error("native realtime client disconnected");
  let agent;
  if (proxy?.enabled && (!isString(proxy.url) || !proxy.url)) throw new Error("native realtime proxy unavailable");
  if (proxy?.enabled && proxy.url) {
    try {
      const scheme = new URL(proxy.url).protocol;
      if (scheme === "http:" || scheme === "https:") agent = agentFactory ? await agentFactory(proxy.url) : new (await import("https-proxy-agent")).HttpsProxyAgent(proxy.url);else
      if (scheme === "socks:" || scheme === "socks4:" || scheme === "socks5:") agent = agentFactory ? await agentFactory(proxy.url) : new (await import("socks-proxy-agent")).SocksProxyAgent(proxy.url);else
      throw new Error("unsupported native realtime proxy");
    } catch (error) {
      throw new Error("native realtime proxy unavailable", { cause: error });
    }
    if (!agent) throw new Error("native realtime proxy unavailable");
    if (signal?.aborted || client.readyState !== client.OPEN) throw new Error("native realtime client disconnected");
  }

  let openedSettled = false;
  let rejectOpened;
  let disposed = false;
  let timeout;
  let providerFrames = null;
  let providerFrameBytes = 0;
  const options = { ...(authorization ? { headers: { Authorization: authorization } } : null), ...(agent ? { agent } : null) };
  const upstream = webSocketFactory ? webSocketFactory(wsUrl, options) : new WebSocket(wsUrl, options);
  const failClient = (code, reason) => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timeout);
    if (!openedSettled) {
      openedSettled = true;
      rejectOpened?.(new Error("native realtime relay disposed"));
    }
    if (providerFrames) providerFrames.length = 0;
    providerFrameBytes = 0;
    try {upstream.close();} catch {/* already closed */}
    if (client.readyState === client.OPEN) client.close(code, reason);
  };
  let upstreamOpened = false;
  let upstreamClosing = false;
  const opened = new Promise((resolve, reject) => {
    rejectOpened = reject;
    timeout = setTimeout(() => {
      try {upstream.close(1011, "native realtime connect timeout");} catch {/* already closed */}
      openedSettled = true;
      reject(new Error("native realtime connect timeout"));
    }, connectTimeoutMs);
    upstream.once("open", () => { clearTimeout(timeout); openedSettled = true; upstreamOpened = true; resolve(); });
    upstream.once("error", (error) => { clearTimeout(timeout); openedSettled = true; reject(error); });
  });
  let geminiSetupSeen = false;
  providerFrames = [];
  let drainingProviderFrames = false;
  let disposing = false;
  let drainPromise = null;
  let pendingUpstreamClose = null;
  let usageSettlement = null;
  const settleUsage = () => usageSettlement || (usageSettlement = Promise.resolve().then(() => onProviderClose ? onProviderClose() : true));
  const closeUpstream = (code) => {
    clearTimeout(timeout);
    if (!upstreamOpened || upstreamClosing || disposed || client.readyState !== client.OPEN) return;
    if (drainingProviderFrames || providerFrames.length) { pendingUpstreamClose = code; return; }
    upstreamClosing = true;
    void settleUsage().then((allowed) => failClient(allowed === false ? 1008 : relayCloseCode(code), allowed === false ? "Usage limit reached" : undefined)).catch(() => failClient(1008, "Usage limit reached"));
  };
  const drainProviderFrames = async () => {
    drainingProviderFrames = true;
    upstream._socket?.pause();
    while (!disposed && providerFrames.length) {
      const frame = providerFrames.shift();
      providerFrameBytes -= frame.bytes;
      let event = null;
      if (!frame.isBinary) {
        try { event = JSON.parse(frame.data.toString()); } catch {/* transparent non-JSON provider frame */}
      }
      let keep = true;
      if (event) {
        try { keep = await onProviderEvent(event); } catch { failClient(1008, "Usage limit reached"); break; }
      }
      if (disposed || (!disposing && client.readyState !== client.OPEN)) break;
      if (disposing) continue;
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) { failClient(1013, "native realtime backpressure"); break; }
      client.send(frame.data, { binary: frame.isBinary });
      if (keep === false) { failClient(1008, "Usage limit reached"); break; }
    }
    drainingProviderFrames = false;
    if (!disposed) upstream._socket?.resume();
    if (!disposed && pendingUpstreamClose !== null) closeUpstream(pendingUpstreamClose);
  };
  upstream.on("message", (data, isBinary) => {
    if (disposed || disposing || client.readyState !== client.OPEN) return;
    if (!onProviderEvent) {
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) { failClient(1013, "native realtime backpressure"); return; }
      client.send(data, { binary: isBinary });
      return;
    }
    const bytes = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
    if (providerFrames.length >= 32 || providerFrameBytes + bytes > MAX_BUFFERED_BYTES) { failClient(1013, "native realtime provider buffer exceeded"); return; }
    providerFrameBytes += bytes;
    providerFrames.push({ data, isBinary, bytes });
    if (!drainingProviderFrames) drainPromise = drainProviderFrames().finally(() => { drainPromise = null; });
  });
  upstream.on("error", () => closeUpstream(1011));
  upstream.on("close", closeUpstream);

  return {
    opened,
    settleUsage,
    async dispose() {
      if (disposed || disposing) return;
      disposing = true;
      clearTimeout(timeout);
      if (!openedSettled) {
        openedSettled = true;
        rejectOpened?.(new Error("native realtime relay disposed"));
      }
      try {
        await drainPromise;
        if (await settleUsage() === false && client.readyState === client.OPEN) client.close(1008, "Usage limit reached");
      } catch {
        if (client.readyState === client.OPEN) client.close(1008, "Usage limit reached");
      }
      disposed = true;
      providerFrames.length = 0;
      providerFrameBytes = 0;
      try {upstream.close();} catch {/* already closed */}
    },
    async handleClientEvent(data, isBinary) {
      if (disposed || disposing || upstream.readyState !== upstream.OPEN) return;
      if (upstream.bufferedAmount > MAX_BUFFERED_BYTES) { failClient(1013, "native realtime backpressure"); return; }
      if (authorizeModel && (!isBinary || !binaryAudio)) {
        let event;
        const text = data.toString();
        try { event = JSON.parse(text); } catch { failClient(1007, "invalid native realtime event"); return; }
        if (geminiLive) {
          const keys = Object.keys(event);
          const setup = event.setup;
          if (!geminiSetupSeen) {
            if (keys.length !== 1 || keys[0] !== "setup" || !setup || !isObject(setup) || Array.isArray(setup) || !isString(setup.model) || !setup.model.startsWith("models/")) {
              failClient(1007, "invalid Gemini Live setup"); return;
            }
            const tree = parseTree(text);
            const setupFields = tree?.children?.filter((property) => property.children?.[0]?.value === "setup") || [];
            const fields = setupFields.length === 1 ? findNodeAtLocation(tree, ["setup"])?.children?.filter((property) => property.children?.[0]?.value === "model") || [] : [];
            if (setupFields.length !== 1 || fields.length !== 1 || setup.model.slice(7) !== pinnedModel) { failClient(4001, "native realtime model access denied"); return; }
            try { await authorizeModel(`gemini/${pinnedModel}`); } catch { failClient(4001, "native realtime model access denied"); return; }
            geminiSetupSeen = true;
          } else if (keys.length !== 1 || !["clientContent", "realtimeInput", "toolResponse"].includes(keys[0])) {
            failClient(4001, "native realtime model access denied"); return;
          }
        } else {
          let slots;
          try { slots = collectNativeModelSlots(event); } catch { failClient(1007, "invalid native realtime event"); return; }
          const tree = slots.length ? parseTree(text) : null;
          const edits = [];
          for (const slot of slots) {
            const value = slot.holder[slot.key];
            try { await authorizeModel(value); } catch { failClient(4001, "native realtime model access denied"); return; }
            if (value.includes("/")) {
              const node = findNodeAtLocation(tree, slot.path);
              edits.push({ offset: node.offset, length: node.length, content: JSON.stringify(value.slice(value.indexOf("/") + 1)) });
            }
          }
          if (edits.length) data = applyEdits(text, edits);
        }
      }
      if (!disposed && !disposing && client.readyState === client.OPEN && upstream.readyState === upstream.OPEN) upstream.send(data, { binary: isBinary });
    }
  };
}

module.exports = { createNativeRealtimeRelay, relayCloseCode };
