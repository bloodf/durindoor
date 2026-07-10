import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import net from "node:net";

const require = createRequire(import.meta.url);
const { waitServerReady } = require("../../cli/src/cli/waitServerReady.js");

function listen() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

describe("waitServerReady", () => {
  it("resolves true as soon as the port accepts connections", async () => {
    const server = await listen();
    const { port } = server.address();
    try {
      const start = Date.now();
      await expect(waitServerReady(port, { timeoutMs: 2000, intervalMs: 25 })).resolves.toBe(true);
      // Should return well before the timeout (no blind fixed wait).
      expect(Date.now() - start).toBeLessThan(1000);
    } finally {
      server.close();
    }
  });

  it("resolves false on timeout when nothing listens", async () => {
    // Port 1 on loopback is refused on Linux CI; small timeout keeps the test fast.
    const start = Date.now();
    await expect(waitServerReady(1, { timeoutMs: 120, intervalMs: 30 })).resolves.toBe(false);
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
    await waitServerReady(1, { timeoutMs: 80, intervalMs: 40 }).then(() => {
      calls += 1;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toBe(1);
  });
});
