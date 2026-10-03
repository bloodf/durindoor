"use strict";
const { randomBytes } = require("node:crypto");

// Next and the WebSocket owner share this process. Credentials never enter HTTP.
const slot = Symbol.for("durindoor.nativeRealtimeHandoffs");
const handoffs = globalThis[slot] || (globalThis[slot] = new Map());

function createNativeRealtimeHandoff(value) {
  if (handoffs.size >= 1024) throw new Error("Native realtime handshake capacity exhausted");
  const id = randomBytes(32).toString("hex");
  const timer = setTimeout(() => handoffs.delete(id), 10000);
  timer.unref();
  handoffs.set(id, { value, timer, expiresAt: Date.now() + 10000 });
  return id;
}

function consumeNativeRealtimeHandoff(id) {
  const entry = handoffs.get(id);
  if (!entry) return null;
  handoffs.delete(id);
  clearTimeout(entry.timer);
  return entry.expiresAt > Date.now() ? entry.value : null;
}

module.exports = { createNativeRealtimeHandoff, consumeNativeRealtimeHandoff };
