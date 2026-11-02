import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Upstream ce060c79: opencode.ai's free tier keys on the TLS ClientHello, so
// the no-proxy path goes through wreq-js with the accepted cipher list. wreq-js
// is optional: when it cannot load, requests stay on native fetch.

// The TLS client steps aside when proxy env vars are set; start each test clean.
beforeEach(() => {
  for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]) vi.stubEnv(name, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("wreq-js");
  vi.restoreAllMocks();
  vi.resetModules();
});

function mockWreq() {
  const transport = { close: vi.fn(async () => {}) };
  const createTransport = vi.fn(async () => transport);
  const fetch = vi.fn(async () => new Response("data: ok\n\n", {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  }));
  vi.doMock("wreq-js", () => ({ createTransport, fetch }));
  return { transport, createTransport, fetch };
}

describe("opencodeTlsClient lazy loader", () => {
  it("resolves to null and warns once when wreq-js cannot load", async () => {
    vi.resetModules();
    vi.doMock("wreq-js", () => {
      throw new Error("Cannot find module 'wreq-js'");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getOpencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");

    expect(await getOpencodeTlsFetch()).toBeNull();
    expect(await getOpencodeTlsFetch()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/wreq-js unavailable.*native fetch/);
  });

  it("builds one cookie-less transport with the accepted cipher list and streams the response", async () => {
    vi.resetModules();
    const { transport, createTransport, fetch } = mockWreq();
    const { getOpencodeTlsFetch, __test__ } = await import("../../open-sse/services/opencodeTlsClient.js");

    const send = await getOpencodeTlsFetch();
    const signal = new AbortController().signal;
    const res = await send("https://opencode.ai/inference/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal,
      redirect: "error",
    });
    await (await getOpencodeTlsFetch())("https://opencode.ai/b", {});

    expect(createTransport).toHaveBeenCalledOnce();
    expect(createTransport.mock.calls[0][0].emulation.tlsOptions.cipherList).toBe(__test__.OPENCODE_CIPHER_LIST);
    expect(__test__.OPENCODE_CIPHER_LIST.split(":")).toHaveLength(17);
    expect(__test__.OPENCODE_CIPHER_LIST.startsWith("TLS_AES_128_GCM_SHA256:")).toBe(true);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: "{}",
      signal,
      redirect: "error",
      transport,
      cookieMode: "ephemeral",
      // wreq's timeout covers the whole body; any value would cut long SSE.
      timeout: 0,
    });
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe("data: ok\n\n");
  });
});

describe("opencodeTlsClient proxy environment", () => {
  it("keeps native fetch while proxy env vars are set, since wreq would apply them itself", async () => {
    vi.resetModules();
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:9");
    const { createTransport } = mockWreq();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getOpencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    expect(await getOpencodeTlsFetch()).toBeNull();
    expect(await getOpencodeTlsFetch()).toBeNull();
    expect(createTransport).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/proxy environment variables/);
  });
});

describe("opencodeTlsClient response handling", () => {
  it("cancels the upstream body when the caller aborts mid-stream", async () => {
    vi.resetModules();
    const { fetch } = mockWreq();
    let cancelled = null;
    fetch.mockImplementation(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("data: 1\n\n")); },
      cancel(reason) { cancelled = reason ?? true; },
    }), { status: 200, headers: { "content-type": "text/event-stream" } }));
    const { getOpencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    const controller = new AbortController();
    const res = await (await getOpencodeTlsFetch())("https://opencode.ai/a", { signal: controller.signal });
    const reader = res.body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: 1\n\n");

    controller.abort();
    await expect(reader.read()).rejects.toThrow();
    await vi.waitFor(() => expect(cancelled).not.toBeNull());
  });

  it.each([204, 205, 304])("returns a null body for status %i", async (status) => {
    vi.resetModules();
    const { fetch } = mockWreq();
    fetch.mockImplementation(async () => ({
      status,
      statusText: "",
      headers: new Headers({ etag: "x" }),
      body: new ReadableStream(),
    }));
    const { getOpencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    const res = await (await getOpencodeTlsFetch())("https://opencode.ai/a", {});
    expect(res.status).toBe(status);
    expect(res.body).toBeNull();
    expect(res.headers.get("etag")).toBe("x");
  });

  it("retries createTransport after a setup failure instead of caching null", async () => {
    vi.resetModules();
    const { createTransport } = mockWreq();
    const transport = await createTransport();
    createTransport.mockReset();
    createTransport.mockRejectedValueOnce(new Error("native init failed")).mockResolvedValue(transport);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getOpencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");

    expect(await getOpencodeTlsFetch()).toBeNull();
    expect(warn.mock.calls[0][0]).toMatch(/transport setup failed.*native fetch/);
    expect(await getOpencodeTlsFetch()).toBeTypeOf("function");
    expect(createTransport).toHaveBeenCalledTimes(2);
  });
});

describe("proxyAwareFetch directFetch hook", () => {
  async function withNativeFetch(nativeFetch, run) {
    vi.resetModules();
    const savedFetch = globalThis.fetch;
    globalThis.fetch = nativeFetch;
    try {
      const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
      return await run(proxyAwareFetch);
    } finally {
      globalThis.fetch = savedFetch;
    }
  }

  it("leaves a configured relay in charge and never calls directFetch", async () => {
    const nativeFetch = vi.fn(async () => new Response("relay"));
    const directFetch = vi.fn(async () => new Response("tls"));
    await withNativeFetch(nativeFetch, async (proxyAwareFetch) => {
      const res = await proxyAwareFetch("https://opencode.ai/inference/v1/chat/completions", {
        method: "POST",
        body: "{}",
        directFetch,
      }, { vercelRelayUrl: "https://relay.example.com/" });
      expect(await res.text()).toBe("relay");
    });
    expect(directFetch).not.toHaveBeenCalled();
    expect(nativeFetch.mock.calls[0][0]).toBe("https://relay.example.com/");
  });

  it("uses the proxy when it works and directFetch only after a non-strict proxy fails", async () => {
    const proxyOptions = { enabled: true, url: "http://127.0.0.1:9" };
    const working = vi.fn(async () => new Response("proxied"));
    const directFetch = vi.fn(async () => new Response("tls"));
    await withNativeFetch(working, async (proxyAwareFetch) => {
      const res = await proxyAwareFetch("https://opencode.ai/a", { method: "POST", body: "{}", directFetch }, proxyOptions);
      expect(await res.text()).toBe("proxied");
    });
    expect(directFetch).not.toHaveBeenCalled();
    expect(working.mock.calls[0][1].dispatcher).toBeDefined();

    const failing = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await withNativeFetch(failing, async (proxyAwareFetch) => {
      const res = await proxyAwareFetch("https://opencode.ai/a", { method: "POST", body: "{}", directFetch }, proxyOptions);
      expect(await res.text()).toBe("tls");
    });
    expect(failing).toHaveBeenCalledOnce();
    expect(directFetch).toHaveBeenCalledOnce();
  });

  it("does not fall back to directFetch when the failing proxy is strict", async () => {
    const failing = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const directFetch = vi.fn(async () => new Response("tls"));
    await withNativeFetch(failing, async (proxyAwareFetch) => {
      await expect(proxyAwareFetch("https://opencode.ai/a", { method: "POST", body: "{}", directFetch },
        { enabled: true, url: "http://127.0.0.1:9", strictProxy: true })).rejects.toThrow(/strictProxy/);
    });
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("sends the no-proxy path through directFetch and strips the hook from the options", async () => {
    vi.resetModules();
    const nativeFetch = vi.fn(async () => new Response("native"));
    const savedFetch = globalThis.fetch;
    globalThis.fetch = nativeFetch;
    try {
      const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
      const directFetch = vi.fn(async () => new Response("tls"));
      const res = await proxyAwareFetch("https://opencode.ai/inference/v1/chat/completions", {
        method: "POST",
        body: "{}",
        directFetch,
      }, { disableEnvProxy: true });

      expect(await res.text()).toBe("tls");
      expect(nativeFetch).not.toHaveBeenCalled();
      expect(directFetch.mock.calls[0][1]).toMatchObject({ method: "POST", body: "{}" });
      expect(directFetch.mock.calls[0][1]).not.toHaveProperty("directFetch");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});
