/**
 * SEC-A-02: SSRF hardening on /api/settings/proxy-test.
 *
 * The route previously read `body.testUrl` and passed it straight to
 * `undiciFetch` with the caller's `proxyUrl` as dispatcher. A caller
 * could supply a metadata / link-local testUrl and probe it through
 * the configured proxy — the dispatcher was a red herring.
 *
 * Fix:
 *   - caller `testUrl` ignored; fixed `DEFAULT_TEST_URL` always fetched
 *   - URL re-validated via `assertPublicUrl` on EVERY 3xx hop
 *   - scheme pinned to https:
 *   - redirect:"manual" set so a hostile proxy cannot bounce the probe
 *
 * These tests mock `undici.fetch` and the `ProxyAgent` constructor so
 * they never touch the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const undiciFetchMock = vi.fn();
const proxyAgentCloseMock = vi.fn();

vi.mock("undici", () => ({
  // `ProxyAgent` is constructed via `new` in the module under test, so
  // the implementation must be a constructible function (not an arrow).
  ProxyAgent: vi.fn().mockImplementation(function ProxyAgentMock() {
    return { close: proxyAgentCloseMock };
  }),
  fetch: (...args) => undiciFetchMock(...args),
}));

// Import after the mock is registered.
const { testProxyUrl, DEFAULT_TEST_URL } = await import("@/lib/network/proxyTest.js");

beforeEach(() => {
  undiciFetchMock.mockReset();
  proxyAgentCloseMock.mockReset();
  proxyAgentCloseMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function okResponse() {
  return { ok: true, status: 200, statusText: "OK", headers: { get: () => null } };
}

describe("proxyTest — caller testUrl is ignored; fixed DEFAULT_TEST_URL used", () => {
  it("ignores caller testUrl; fetches ONLY DEFAULT_TEST_URL", async () => {
    undiciFetchMock.mockResolvedValueOnce(okResponse());

    const result = await testProxyUrl({
      proxyUrl: "http://proxy:8080",
      testUrl: "http://169.254.169.254/latest/meta-data",
    });

    expect(result.ok).toBe(true);
    expect(result.url).toBe(DEFAULT_TEST_URL);
    expect(undiciFetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = undiciFetchMock.mock.calls[0];
    expect(calledUrl).toBe(DEFAULT_TEST_URL);
  });

  it("ignores caller testUrl even when it is a public https URL (still fixed target)", async () => {
    undiciFetchMock.mockResolvedValueOnce(okResponse());

    await testProxyUrl({
      proxyUrl: "http://proxy:8080",
      testUrl: "https://attacker-controlled.example.com/secret",
    });

    expect(undiciFetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = undiciFetchMock.mock.calls[0];
    expect(calledUrl).toBe(DEFAULT_TEST_URL);
  });
});

describe("proxyTest — SSRF guard wired into every fetch", () => {
  it("forces redirect:manual on every undici fetch", async () => {
    undiciFetchMock.mockResolvedValueOnce(okResponse());

    await testProxyUrl({ proxyUrl: "http://proxy:8080" });

    const [, init] = undiciFetchMock.mock.calls[0];
    expect(init.redirect).toBe("manual");
  });

  it("rejects a 3xx redirect to a private / link-local target (re-validates Location)", async () => {
    // Proxy 302s the probe to a metadata IP. Even though the initial URL
    // is the safe fixed DEFAULT_TEST_URL, the redirect hop must be
    // re-validated through assertPublicUrl and rejected.
    undiciFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      statusText: "Found",
      headers: { get: (k) => (k.toLowerCase() === "location" ? "http://169.254.169.254/latest/meta-data" : null) },
    });

    const result = await testProxyUrl({ proxyUrl: "http://proxy:8080" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/URL not allowed|private|metadata|blocked/i);
    // Initial fetch happened; the redirected fetch must NOT have been opened.
    expect(undiciFetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a 3xx redirect to a non-https target (scheme pinned)", async () => {
    undiciFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      statusText: "Found",
      headers: { get: (k) => (k.toLowerCase() === "location" ? "http://example.com/insecure" : null) },
    });

    const result = await testProxyUrl({ proxyUrl: "http://proxy:8080" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/https/i);
    expect(undiciFetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a 3xx redirect to localhost / RFC1918", async () => {
    for (const location of [
      "https://localhost/admin",
      "https://127.0.0.1/admin",
      "https://10.0.0.1/admin",
      "https://192.168.1.1/admin",
      "https://172.16.0.1/admin",
      "https://[::1]/admin",
      "https://internal-host.internal/admin",
    ]) {
      undiciFetchMock.mockReset();
      undiciFetchMock.mockResolvedValueOnce({
        ok: false,
        status: 302,
        statusText: "Found",
        headers: { get: (k) => (k.toLowerCase() === "location" ? location : null) },
      });
      const result = await testProxyUrl({ proxyUrl: "http://proxy:8080" });
      expect(result.ok, location).toBe(false);
      expect(result.status, location).toBe(400);
      expect(undiciFetchMock, location).toHaveBeenCalledTimes(1);
    }
  });

  it("follows a same-origin https redirect (re-fetch happens after re-validation)", async () => {
    undiciFetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 301,
        statusText: "Moved Permanently",
        headers: { get: (k) => (k.toLowerCase() === "location" ? "https://www.google.com/" : null) },
      })
      .mockResolvedValueOnce(okResponse());

    const result = await testProxyUrl({ proxyUrl: "http://proxy:8080" });
    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://www.google.com/");
    expect(undiciFetchMock).toHaveBeenCalledTimes(2);
  });

  it("caps redirect chains at MAX_REDIRECT_HOPS (loop protection)", async () => {
    // 3xx that bounces between two URLs forever. Must not loop forever.
    undiciFetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 302,
        statusText: "Found",
        headers: {
          get: (k) => {
            const url = undiciFetchMock.mock.calls.length % 2 === 0
              ? "https://a.example.com/x"
              : "https://b.example.com/x";
            return k.toLowerCase() === "location" ? url : null;
          },
        },
      }),
    );
    const result = await testProxyUrl({ proxyUrl: "http://proxy:8080" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(508);
    expect(undiciFetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(undiciFetchMock.mock.calls.length).toBeLessThan(20);
  });
});

describe("proxyTest — proxy URL still validated", () => {
  it("rejects an empty proxyUrl before any fetch", async () => {
    const result = await testProxyUrl({ proxyUrl: "" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("requires proxyUrl", async () => {
    const result = await testProxyUrl({});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });
});
