// #2562: Codex image prefetch must be capped, sequential, abortable and proxy-routed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import {
  __clearProxyDispatchersForTesting,
  __setOriginalFetchForTesting,
  __setProxyDispatcherForTesting,
} from "../../open-sse/utils/proxyFetch.js";

const PNG = [0x89, 0x50, 0x4e, 0x47];
const MB = 1024 * 1024;
const PROXY_URL = "http://proxy.invalid:8080";
// The connection proxy shape chatCore hands to executors.
const PROXY_OPTIONS = {
  connectionProxyEnabled: true, connectionProxyUrl: PROXY_URL, strictProxy: true, disableEnvProxy: true,
};

const imageResponse = (size = PNG.length) => {
  const bytes = new Uint8Array(size);
  bytes.set(PNG);
  return new Response(bytes);
};
const makeBody = (count) => ({ input: [{ role: "user", content: Array.from({ length: count }, (_, i) => ({
  type: "input_image", image_url: `https://images.example/${i}`,
})) }] });
const urls = (body) => body.input.flatMap((item) => item.content.map((part) => part.image_url));
const inlined = (body) => urls(body).filter((url) => url.startsWith("data:"));

// `transport` is the network below proxyAwareFetch; `direct` is the global fetch.
let transport;
let direct;
let restoreOriginalFetch;
const previousFetch = globalThis.fetch;

beforeEach(() => {
  transport = vi.fn(async () => imageResponse());
  direct = vi.fn(async () => imageResponse());
  restoreOriginalFetch = __setOriginalFetchForTesting(transport);
  globalThis.fetch = direct;
});
afterEach(() => {
  globalThis.fetch = previousFetch;
  restoreOriginalFetch();
  __clearProxyDispatchersForTesting();
  vi.restoreAllMocks();
});

describe("Codex image prefetch limits", () => {
  it("fetches at most ten of 500 input_image parts, one at a time", async () => {
    let active = 0;
    let peak = 0;
    direct.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return imageResponse();
    });
    const body = makeBody(500);
    await new CodexExecutor().prefetchImages(body);
    expect(direct).toHaveBeenCalledTimes(10);
    expect(peak).toBe(1);
    expect(inlined(body)).toHaveLength(10);
    expect(urls(body).slice(10)).toEqual(urls(makeBody(500)).slice(10));
  });

  it("shares the image count across input items and ignores non-HTTP values", async () => {
    const body = { input: [
      { role: "user", content: [{ type: "image_url", image_url: { url: "ftp://images.example/a" } }] },
      ...Array.from({ length: 12 }, (_, i) => ({ role: "user", content: [
        { type: "image_url", image_url: { url: `https://images.example/${i}`, detail: "high" } },
      ] })),
    ] };
    await new CodexExecutor().prefetchImages(body);
    expect(direct).toHaveBeenCalledTimes(10);
    expect(inlined(body)).toHaveLength(10);
    expect(body.input[12].content[0]).toEqual({
      type: "input_image", image_url: "https://images.example/11", detail: "high",
    });
  });

  it("keeps the inlined images within 10 MB per request", async () => {
    direct.mockImplementation(async () => imageResponse(4 * MB));
    const body = makeBody(4);
    await new CodexExecutor().prefetchImages(body);
    expect(inlined(body)).toHaveLength(2);
    expect(urls(body).slice(2)).toEqual(urls(makeBody(4)).slice(2));
  });

  it("stops fetching once the request is aborted", async () => {
    const controller = new AbortController();
    let fetchSignal;
    direct.mockImplementation(async (_url, init) => {
      fetchSignal = init.signal;
      controller.abort();
      throw init.signal.reason;
    });
    const body = makeBody(20);
    await new CodexExecutor().prefetchImages(body, { signal: controller.signal });
    expect(direct).toHaveBeenCalledTimes(1);
    expect(fetchSignal.aborted).toBe(true);
    expect(urls(body)).toEqual(urls(makeBody(20)));
  });

  it("passes the execute signal to the prefetch and skips the upstream call", async () => {
    const upstream = vi.spyOn(BaseExecutor.prototype, "execute");
    const controller = new AbortController();
    direct.mockImplementation(async () => { controller.abort(); return imageResponse(); });
    await expect(new CodexExecutor().execute({
      model: "gpt-5.3-codex", body: makeBody(20), credentials: {}, signal: controller.signal,
    })).rejects.toThrow(/abort/i);
    expect(direct).toHaveBeenCalledTimes(1);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("Codex image prefetch egress", () => {
  it("sends execute() image fetches through the connection proxy dispatcher", async () => {
    const proxyDispatcher = {};
    __setProxyDispatcherForTesting(PROXY_URL, proxyDispatcher);
    const upstream = vi.spyOn(BaseExecutor.prototype, "execute")
      .mockResolvedValue({ response: { status: 200 }, transformedBody: {} });
    await new CodexExecutor().execute({
      model: "gpt-5.3-codex", body: makeBody(1), credentials: {}, proxyOptions: PROXY_OPTIONS,
    });
    expect(transport).toHaveBeenCalledExactlyOnceWith("https://images.example/0", expect.objectContaining({
      dispatcher: proxyDispatcher, redirect: "manual", method: "GET",
    }));
    expect(direct).not.toHaveBeenCalled();
    expect(inlined(upstream.mock.calls[0][0].body)).toHaveLength(1);
  });

  it("does not retry directly when a strict proxy fails", async () => {
    const proxyDispatcher = {};
    __setProxyDispatcherForTesting(PROXY_URL, proxyDispatcher);
    transport.mockRejectedValue(new Error("proxy down"));
    const body = makeBody(1);
    await new CodexExecutor().prefetchImages(body, { proxyOptions: PROXY_OPTIONS });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1].dispatcher).toBe(proxyDispatcher);
    expect(direct).not.toHaveBeenCalled();
    expect(urls(body)).toEqual(urls(makeBody(1)));
  });

  it("fetches nothing when strictProxy has no usable proxy", async () => {
    const body = makeBody(3);
    await new CodexExecutor().prefetchImages(body, { proxyOptions: { strictProxy: true, disableEnvProxy: true } });
    expect(transport).not.toHaveBeenCalled();
    expect(direct).not.toHaveBeenCalled();
    expect(urls(body)).toEqual(urls(makeBody(3)));
  });

  it("keeps the address-pinned dispatcher on a direct connection", async () => {
    await new CodexExecutor().prefetchImages(makeBody(1), { proxyOptions: { disableEnvProxy: true } });
    const calls = [...transport.mock.calls, ...direct.mock.calls];
    expect(calls).toHaveLength(1);
    expect(calls[0][1].dispatcher).toBeDefined();
  });

  it("does not apply the image-host dispatcher to a relay", async () => {
    const body = makeBody(1);
    await new CodexExecutor().prefetchImages(body, {
      proxyOptions: { vercelRelayUrl: "https://relay.invalid/api", strictProxy: true },
    });
    const [target, init] = transport.mock.calls[0];
    expect(target).toBe("https://relay.invalid/api");
    expect(init.dispatcher).toBeUndefined();
    expect(init.headers.get("x-relay-target")).toBe("https://images.example");
    expect(init.headers.get("x-relay-path")).toBe("/0");
    expect(inlined(body)).toHaveLength(1);
  });
});
