import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
import net from "node:net";

const require = createRequire(import.meta.url);
const { waitServerReady, pollHealthOnce } = require("../../cli/src/cli/waitServerReady.js");

// #2460 / #6800 (OmniRoute #6892): waitServerReady must NOT report ready from a
// raw TCP accept alone. It distinguishes four outcomes: "ready" (2xx health),
// "fast-reject" (HTTP alive, route not mounted — 3s grace), "hanging" (TCP
// accepted but never answers — NOT ready), "not-listening" (nothing bound).

// Track every server + accepted socket so teardown never hangs: server.close()
// waits for open connections, so hanging sockets must be destroyed first.
const cleanup = [];
afterEach(async () => {
  while (cleanup.length) {
    const { server, sockets } = cleanup.pop();
    for (const s of sockets) s.destroy();
    if (server.listening) await new Promise((r) => server.close(r));
  }
});

// Reserve an ephemeral port then release it, guaranteeing a port that is
// closed NOW (deterministic, unlike hardcoded port 1).
async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

function track(server) {
  const entry = { server, sockets: new Set() };
  server.on("connection", (s) => entry.sockets.add(s));
  server.on("connection", (s) => s.on("close", () => entry.sockets.delete(s)));
  cleanup.push(entry);
  return server;
}

function listen(onSocket) {
  return new Promise((resolve, reject) => {
    const server = track(net.createServer(onSocket));
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// Minimal HTTP responder: speaks enough HTTP for fetch() to classify.
function listenHttp(status, body = "ok") {
  return listen((socket) => {
    socket.on("data", () => {
      socket.end(`HTTP/1.1 ${status}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
    });
  });
}

describe("pollHealthOnce classifications", () => {
  it('returns "ready" on a 2xx health response', async () => {
    const server = await listenHttp("200 OK");
    try {
      await expect(pollHealthOnce(server.address().port)).resolves.toBe("ready");
    } finally {
      server.close();
    }
  });

  it('returns "fast-reject" on a non-2xx HTTP response (route not mounted)', async () => {
    const server = await listenHttp("404 Not Found", "nope");
    try {
      await expect(pollHealthOnce(server.address().port)).resolves.toBe("fast-reject");
    } finally {
      server.close();
    }
  });

  it('returns "fast-reject" when the connection is actively reset but the port listens', async () => {
    // Accept then destroy quickly: server alive, health route not mounted.
    const server = await listen((socket) => socket.destroy());
    try {
      await expect(pollHealthOnce(server.address().port)).resolves.toBe("fast-reject");
    } finally {
      server.close();
    }
  });

  it('returns "hanging" when TCP accepts but never answers a request (#6800)', async () => {
    const server = await listen((socket) => {
      socket.on("data", () => {}); // swallow, never respond, never close
    });
    try {
      await expect(pollHealthOnce(server.address().port, 300)).resolves.toBe("hanging");
    } finally {
      server.close();
    }
  });

  it('returns "not-listening" on a closed port', async () => {
    await expect(pollHealthOnce(await closedPort())).resolves.toBe("not-listening");
  });
});

describe("waitServerReady", () => {
  it("resolves true as soon as health returns 2xx", async () => {
    const server = await listenHttp("200 OK");
    try {
      const start = Date.now();
      await expect(waitServerReady(server.address().port, { timeoutMs: 2000, intervalMs: 25 })).resolves.toBe(true);
      expect(Date.now() - start).toBeLessThan(1000);
    } finally {
      server.close();
    }
  });

  it("resolves true via fast-reject grace when the health route is not mounted yet (#2460)", async () => {
    const server = await listen((socket) => socket.destroy());
    try {
      const start = Date.now();
      await expect(waitServerReady(server.address().port, { timeoutMs: 10000, intervalMs: 50 })).resolves.toBe(true);
      // Must take the >=3s grace, not fire instantly.
      expect(Date.now() - start).toBeGreaterThanOrEqual(2900);
    } finally {
      server.close();
    }
  }, 15000);

  it("resolves false when TCP accepts but HTTP never answers (#6800)", async () => {
    const server = await listen((socket) => {
      socket.on("data", () => {});
    });
    try {
      const result = await waitServerReady(server.address().port, { timeoutMs: 1200, intervalMs: 100 });
      expect(result).toBe(false);
    } finally {
      server.close();
    }
  });

  it("recovers once a briefly-resetting server starts answering (#2460 regression guard)", async () => {
    let attempts = 0;
    const server = await listen((socket) => {
      attempts += 1;
      if (attempts <= 3) return socket.destroy();
      socket.on("data", () => {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
      });
    });
    try {
      await expect(waitServerReady(server.address().port, { timeoutMs: 5000, intervalMs: 50 })).resolves.toBe(true);
    } finally {
      server.close();
    }
  });

  it("never overshoots the overall timeout on a hanging peer", async () => {
    const server = await listen((socket) => {
      socket.on("data", () => {});
    });
    try {
      const start = Date.now();
      await expect(waitServerReady(server.address().port, { timeoutMs: 500, intervalMs: 100 })).resolves.toBe(false);
      // A hardcoded 2s request timeout would blow past the 500ms budget.
      expect(Date.now() - start).toBeLessThan(1500);
    } finally {
      server.close();
    }
  });

  it("resolves false on timeout when nothing listens", async () => {
    const port = await closedPort();
    const start = Date.now();
    await expect(waitServerReady(port, { timeoutMs: 120, intervalMs: 30 })).resolves.toBe(false);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(1000); // must not hang past the deadline
  });

  it("resolves false (never throws, never hangs) for invalid port", async () => {
    await expect(waitServerReady(0)).resolves.toBe(false);
    await expect(waitServerReady(70000)).resolves.toBe(false);
    await expect(waitServerReady("nope")).resolves.toBe(false);
  });

  it("resolves false immediately for negative/non-finite timeout", async () => {
    await expect(waitServerReady(1, { timeoutMs: -1 })).resolves.toBe(false);
    await expect(waitServerReady(1, { timeoutMs: NaN })).resolves.toBe(false);
  });

  it("timeoutMs 0 means immediate timeout (not the default)", async () => {
    const start = Date.now();
    await expect(waitServerReady(1, { timeoutMs: 0, intervalMs: 10 })).resolves.toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("resolves exactly once (never twice) across timeout + error paths", async () => {
    let calls = 0;
    await waitServerReady(await closedPort(), { timeoutMs: 80, intervalMs: 40 }).then(() => {
      calls += 1;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toBe(1);
  });
});
