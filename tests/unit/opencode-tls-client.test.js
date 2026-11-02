import { afterEach, describe, expect, it, vi } from "vitest";

// Upstream ce060c79: opencode.ai's free tier keys on the TLS ClientHello, so
// the no-proxy path goes through wreq-js with the accepted cipher list. wreq-js
// is optional: when it cannot load, requests stay on native fetch.

afterEach(() => {
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
    });
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe("data: ok\n\n");
  });
});

describe("proxyAwareFetch directFetch hook", () => {
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
