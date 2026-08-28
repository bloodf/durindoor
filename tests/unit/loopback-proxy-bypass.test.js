import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __clearProxyDispatchersForTesting,
  __setOriginalFetchForTesting,
  __setProxyDispatcherForTesting,
  isLoopbackTarget,
  proxyAwareFetch,
  shouldUseProxyAwareTransport,
} from "../../open-sse/utils/proxyFetch.js";
import { createGuardedProbeDispatcher, OutboundUrlGuardError } from "../../open-sse/utils/outboundUrlGuard.js";

const PROXY_ENV_KEYS = [
  "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy",
  "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy",
];
const PROXY_URL = "http://outbound-proxy.example.test:8080";
const LOOPBACK_URLS = [
  "http://localhost:11434/api/chat",
  "http://LOCALHOST./",
  "http://provider.localhost/",
  "http://provider.localhost./",
  "http://127.0.0.1/",
  "http://127.255.255.254/",
  "http://127.1/",
  "http://0x7f000001/",
  "http://[::1]/",
  "http://[0:0:0:0:0:0:0:1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[::ffff:7fff:ffff]/",
  "http://[::127.0.0.1]/",
  "http://[::7f00:1]/",
  "http://0.0.0.0/",
  "http://0/",
  "http://[::]/",
  "http://[::ffff:0.0.0.0]/",
];

let fetchMock;
let restoreFetch;
let savedProxyEnv;

beforeEach(() => {
  savedProxyEnv = Object.fromEntries(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of PROXY_ENV_KEYS) delete process.env[key];
  fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
  restoreFetch = __setOriginalFetchForTesting(fetchMock);
  __clearProxyDispatchersForTesting();
});

afterEach(() => {
  restoreFetch?.();
  __clearProxyDispatchersForTesting();
  vi.restoreAllMocks();
  for (const [key, value] of Object.entries(savedProxyEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("loopback target classification", () => {
  it.each(LOOPBACK_URLS)("recognizes %s", (url) => {
    expect(isLoopbackTarget(url)).toBe(true);
  });

  it.each([
    "https://api.openai.com/",
    "http://192.168.1.10/",
    "http://10.0.0.5/",
    "http://100.64.0.1/",
    "http://126.255.255.255/",
    "http://128.0.0.1/",
    "http://[::ffff:192.168.1.1]/",
    "http://notlocalhost.com/",
    "http://localhost.evil.com/",
    "http://127.0.0.1.evil.com/",
    "http://localhost@public.example.test/",
  ])("does not classify %s as loopback", (url) => {
    expect(isLoopbackTarget(url)).toBe(false);
  });

  it("treats malformed input as non-loopback", () => {
    expect(isLoopbackTarget("not a url")).toBe(false);
    expect(isLoopbackTarget("")).toBe(false);
  });
});

describe("loopback proxy trust boundaries", () => {
  it.each(LOOPBACK_URLS)("bypasses ambient proxy routing for %s", async (targetUrl) => {
    process.env.HTTP_PROXY = PROXY_URL;
    const outboundProxyDispatcher = { dispatch: vi.fn() };
    __setProxyDispatcherForTesting(PROXY_URL, outboundProxyDispatcher);

    await proxyAwareFetch(targetUrl);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].dispatcher).not.toBe(outboundProxyDispatcher);
  });

  it("bypasses a connection proxy but keeps LAN targets proxyable", async () => {
    const outboundProxyDispatcher = { dispatch: vi.fn() };
    __setProxyDispatcherForTesting(PROXY_URL, outboundProxyDispatcher);
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: PROXY_URL,
      disableEnvProxy: true,
    };

    await proxyAwareFetch("http://127.0.0.1:11434/", {}, proxyOptions);
    await proxyAwareFetch("http://192.168.1.10:11434/", {}, proxyOptions);

    expect(fetchMock.mock.calls[0][1].dispatcher).not.toBe(outboundProxyDispatcher);
    expect(fetchMock.mock.calls[1][1].dispatcher).toBe(outboundProxyDispatcher);
  });

  it("does not select proxy-aware custom transport solely for loopback ambient proxying", () => {
    process.env.HTTP_PROXY = PROXY_URL;

    expect(shouldUseProxyAwareTransport("http://localhost:11434/")).toBe(false);
    expect(shouldUseProxyAwareTransport("http://192.168.1.10:11434/")).toBe(true);
  });

  it("bypasses a connection proxy for loopback Request input", async () => {
    const outboundProxyDispatcher = { dispatch: vi.fn() };
    __setProxyDispatcherForTesting(PROXY_URL, outboundProxyDispatcher);

    await proxyAwareFetch(new Request("http://localhost:11434/"), {}, {
      connectionProxyEnabled: true,
      connectionProxyUrl: PROXY_URL,
      disableEnvProxy: true,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].dispatcher).not.toBe(outboundProxyDispatcher);
  });

  it.each([
    { connectionProxyEnabled: true, connectionProxyUrl: PROXY_URL, disableEnvProxy: true },
    { vercelRelayUrl: "https://relay.example.test/api/relay" },
  ])("preserves manual redirects but disables automatic redirects across an outbound route", async (proxyOptions) => {
    await proxyAwareFetch("https://provider.example.test/start", { redirect: "manual" }, proxyOptions);
    await proxyAwareFetch("https://provider.example.test/start", { redirect: "follow" }, proxyOptions);
    await proxyAwareFetch("https://provider.example.test/start", {}, proxyOptions);

    expect(fetchMock.mock.calls.map(([, options]) => options.redirect)).toEqual([
      "manual",
      "error",
      "error",
    ]);
  });

  it("fails closed when strict proxy routing targets loopback", async () => {
    await expect(proxyAwareFetch(
      "http://127.0.0.1:11434/",
      { headers: { Authorization: "Bearer provider-secret" } },
      {
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://alice:proxy-secret@outbound-proxy.example.test:8080",
        disableEnvProxy: true,
        strictProxy: true,
      },
    )).rejects.toThrow("[ProxyFetch] Proxy required but unavailable (strictProxy=true)");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects loopback relay targets before disclosing target or auth headers", async () => {
    let failure;
    try {
      await proxyAwareFetch(
        "http://localhost:11434/private?token=target-secret",
        { headers: { Authorization: "Bearer provider-secret" } },
        { vercelRelayUrl: "https://relay.example.test/api/relay" },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(OutboundUrlGuardError);
    expect(failure).toMatchObject({
      code: "OUTBOUND_URL_GUARD_BLOCKED",
      hostname: "localhost",
    });
    expect(failure.message).not.toContain("target-secret");
    expect(failure.message).not.toContain("provider-secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves a guarded probe dispatcher on the direct loopback path", async () => {
    process.env.HTTP_PROXY = PROXY_URL;
    const guardedDispatcher = createGuardedProbeDispatcher("public-only");
    try {
      await proxyAwareFetch("http://127.0.0.1:11434/", { dispatcher: guardedDispatcher });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:11434/",
        expect.objectContaining({ dispatcher: guardedDispatcher }),
      );
    } finally {
      await guardedDispatcher.close();
    }
  });
});
