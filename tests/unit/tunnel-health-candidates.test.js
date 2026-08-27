import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveDns = vi.fn(async () => true);
vi.mock("@/lib/tunnel/shared/dnsResolver.js", () => ({ resolveDns }));

const { waitForHealth } = await import("@/lib/tunnel/cloudflare/healthCheck.js");
const { HEALTH_CHECK } = await import("@/lib/tunnel/cloudflare/config.js");

const RELAY = "https://rabc123.abc-tunnel.us";
const DIRECT = "https://example.trycloudflare.com";

function serveOnly(healthyUrl) {
  globalThis.fetch = vi.fn(async (url) => ({
    ok: String(url) === `${healthyUrl}/api/health`,
  }));
}

describe("tunnel health candidates", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => resolveDns.mockClear());
  beforeEach(() => resolveDns.mockResolvedValue(true));
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it("returns the first healthy URL in preference order", async () => {
    vi.useFakeTimers();
    serveOnly(DIRECT);

    const result = expect(waitForHealth([RELAY, DIRECT])).resolves.toBe(DIRECT);
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK.timeoutMs + HEALTH_CHECK.intervalMs);
    await result;
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      `${RELAY}/api/health`,
      expect.any(Object),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      `${DIRECT}/api/health`,
      expect.any(Object),
    );
  });

  it("prefers the relay when both URLs are healthy", async () => {
    serveOnly(RELAY);

    await expect(waitForHealth([RELAY, DIRECT])).resolves.toBe(RELAY);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("keeps single-URL compatibility and filters empty candidates", async () => {
    serveOnly(DIRECT);

    await expect(waitForHealth(DIRECT)).resolves.toBe(DIRECT);
    globalThis.fetch.mockClear();
    await expect(waitForHealth([null, DIRECT, undefined])).resolves.toBe(DIRECT);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("fails closed with no candidate and honours cancellation", async () => {
    await expect(waitForHealth([])).rejects.toThrow("at least one URL");
    await expect(waitForHealth([RELAY], { cancelled: true })).rejects.toThrow("cancelled");
  });

  it("never fetches a candidate whose DNS does not resolve", async () => {
    resolveDns.mockResolvedValueOnce(false);
    serveOnly(DIRECT);

    await expect(waitForHealth([RELAY, DIRECT])).resolves.toBe(DIRECT);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toHaveBeenCalledWith(`${DIRECT}/api/health`, expect.any(Object));
  });

  it("still times out when every candidate is down", async () => {
    vi.useFakeTimers();
    serveOnly("https://none.invalid");

    const result = expect(waitForHealth([RELAY, DIRECT])).rejects.toThrow(
      `Health check timeout after ${HEALTH_CHECK.timeoutMs}ms`,
    );
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK.timeoutMs + HEALTH_CHECK.intervalMs);
    await result;
  });
});
