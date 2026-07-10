"use strict";

const net = require("net");

/**
 * Poll until a TCP server accepts connections on `port`, or `timeoutMs` elapses.
 *
 * Replaces blind fixed `setTimeout(..., N)` waits for "is the server up yet?"
 * so the CLI surfaces the dashboard/menu as soon as the socket is open instead
 * of always waiting the full 2-3s. Resolves `false` (never rejects) on timeout
 * so callers keep their existing fallback path.
 *
 * @param {number} port TCP port on 127.0.0.1 to probe.
 * @param {{timeoutMs?: number, intervalMs?: number}} [opts]
 * @returns {Promise<boolean>} true if a connection succeeded within the deadline.
 */
function waitServerReady(port, { timeoutMs = 15000, intervalMs = 150 } = {}) {
  // Defensive: callers probe an externally-sourced port; never hang or throw.
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve(false);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return Promise.resolve(false);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) intervalMs = 150;
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const tryConnect = () => {
      if (Date.now() >= deadline) return finish(false);
      const remaining = deadline - Date.now();
      let attemptDone = false;
      const retryOrFinish = () => {
        if (attemptDone) return;
        attemptDone = true;
        if (Date.now() >= deadline) finish(false);
        else setTimeout(tryConnect, intervalMs);
      };
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        attemptDone = true;
        socket.destroy();
        finish(true);
      });
      // Cap this attempt at the remaining deadline so a hung connect can't
      // overshoot the overall timeout; resolves false exactly once via finish().
      socket.setTimeout(Math.min(remaining, intervalMs), () => {
        socket.removeAllListeners("error");
        socket.destroy();
        retryOrFinish();
      });
      socket.on("error", () => {
        socket.destroy();
        retryOrFinish();
      });
    };
    tryConnect();
  });
}

module.exports = { waitServerReady };
