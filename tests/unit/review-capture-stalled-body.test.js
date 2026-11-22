import { describe, expect, it, vi } from "vitest";
import { MESSAGES, parsePairing, preflightPermissions, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { PAIRING_HEADER } from "../../extensions/provider-cookie-capture/providers.js";

const token = `ddpair_${"A".repeat(43)}`;
const now = Date.UTC(2026, 10, 20, 12, 0, 0);
const pairing = {
  token, expiresAt: new Date(now + 120_000).toISOString(), ttlSeconds: 120,
  header: PAIRING_HEADER, provider: "grok-web", action: "create", name: "Synthetic",
  importUrl: "https://dashboard.example/api/providers/cookie-import",
  contract: { origin: "https://grok.com", cookieNames: ["sso"], cookiePrefixes: [] },
};

function harness() {
  const chrome = {
    tabs: {
      query: async () => [{ id: 1, url: "https://grok.com/" }],
      get: async (id) => ({ id, url: "https://grok.com/" }),
    },
    permissions: { contains: async () => true, request: async () => true, remove: async () => true },
    cookies: {
      getAllCookieStores: async () => [{ id: "store", tabIds: [1] }],
      get: async () => ({ name: "sso", value: "synthetic-cookie", domain: "grok.com", secure: true }),
    },
  };
  const parsed = parsePairing(JSON.stringify({ pairing }), now);
  expect(parsed.ok).toBe(true);
  parsed.plan.tabId = 1;
  return { chrome, plan: parsed.plan };
}

async function start(fetchImpl, signal) {
  const { chrome, plan } = harness();
  await preflightPermissions(chrome, plan);
  return runCapture({ chrome, fetch: fetchImpl, plan, confirmed: confirmationFor(plan), signal, now: () => now });
}

describe("capture response body cancellation", () => {
  it("times out when headers arrive but the body stalls", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => ({ status: 201, json: () => new Promise(() => {}) }));
      const run = start(fetchImpl);
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await run).toEqual({ ok: false, code: "network_error", message: MESSAGES.network_error });
    } finally { vi.useRealTimers(); }
  });

  it("settles as cancelled when the caller aborts while the body stalls", async () => {
    const ctl = new AbortController();
    const fetchImpl = vi.fn(async () => ({ status: 201, json: () => new Promise(() => {}) }));
    const run = start(fetchImpl, ctl.signal);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    ctl.abort();
    expect(await run).toEqual({ ok: false, code: "cancelled", message: MESSAGES.cancelled });
  });
});
