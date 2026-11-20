import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearProxyDispatchersForTesting,
  __setOriginalFetchForTesting,
  __setProxyDispatcherForTesting,
  proxyAwareFetch,
} from "../../open-sse/utils/proxyFetch.js";

const url = "https://provider.example.test/";
const proxyUrl = "http://proxy.example.test:8080";
const proxy = { connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, disableEnvProxy: true };

describe("ordinary proxy fallback and request bodies", () => {
  let failure, fetchMock, direct, restore;
  beforeEach(() => {
    failure = new Error("proxy failed");
    fetchMock = vi.fn().mockRejectedValue(failure);
    direct = vi.fn().mockResolvedValue(new Response("direct"));
    restore = __setOriginalFetchForTesting(fetchMock);
    __setProxyDispatcherForTesting(proxyUrl, { dispatch: vi.fn() });
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });
  afterEach(() => {
    restore();
    __clearProxyDispatchersForTesting();
    vi.restoreAllMocks();
  });

  it.each([
    ["web stream", () => new ReadableStream()],
    ["node stream", () => Readable.from(["body"])],
    ["async iterable", () => ({ async *[Symbol.asyncIterator]() { yield "body"; } })],
    ["stream method", () => ({ stream: vi.fn() })],
  ])("preserves the proxy error for a %s without consuming it", async (_label, makeBody) => {
    const body = makeBody();
    await expect(proxyAwareFetch(url, { method: "POST", body, directFetch: direct }, proxy)).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].body).toBe(body);
    expect(direct).not.toHaveBeenCalled();
    if (body.stream) expect(body.stream).not.toHaveBeenCalled();
  });

  it.each([false, true])("preserves the proxy error for a Request with bodyUsed=%s", async (used) => {
    const request = new Request(url, { method: "POST", body: "body" });
    if (used) await request.text();
    await expect(proxyAwareFetch(request, { directFetch: direct }, proxy)).rejects.toBe(failure);
    expect(request.bodyUsed).toBe(used);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(direct).not.toHaveBeenCalled();
  });

  it.each(["body", Buffer.from("body"), new URLSearchParams({ a: "b" }), null])(
    "retains direct fallback for replayable body %s", async (body) => {
      const response = await proxyAwareFetch(url, { method: "POST", body, directFetch: direct }, proxy);
      expect(await response.text()).toBe("direct");
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(direct).toHaveBeenCalledOnce();
      expect(direct.mock.calls[0][1].body).toBe(body);
    }
  );

  it("keeps strict proxy and abort handling ahead of the body guard", async () => {
    const body = new ReadableStream();
    await expect(proxyAwareFetch(url, { body, directFetch: direct }, { ...proxy, strictProxy: true })).rejects.toThrow("strictProxy=true");
    const abort = new DOMException("aborted", "AbortError");
    fetchMock.mockRejectedValueOnce(abort);
    await expect(proxyAwareFetch(url, { body, directFetch: direct }, proxy)).rejects.toBe(abort);
    expect(direct).not.toHaveBeenCalled();
  });
});
