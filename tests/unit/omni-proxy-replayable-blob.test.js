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

describe("proxy fallback for replayable Blob bodies", () => {
  let failure, fetchMock, direct, restore;
  beforeEach(() => {
    failure = new Error("mock proxy failure");
    fetchMock = vi.fn().mockRejectedValue(failure);
    direct = vi.fn(async (_url, options) => new Response(await options.body.text()));
    restore = __setOriginalFetchForTesting(fetchMock);
    __setProxyDispatcherForTesting(proxyUrl, { dispatch: vi.fn() });
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });
  afterEach(() => {
    restore();
    __clearProxyDispatchersForTesting();
    vi.restoreAllMocks();
  });

  it("keeps the direct fallback for a standard replayable Blob", async () => {
    const body = new Blob(["fixture"]);
    const response = await proxyAwareFetch(url, { method: "POST", body, directFetch: direct }, proxy);
    expect(await response.text()).toBe("fixture");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(direct).toHaveBeenCalledOnce();
    expect(direct.mock.calls[0][1].body).toBe(body);
  });

  it("keeps the direct fallback for a standard replayable File", async () => {
    const body = new File(["fixture"], "fixture.txt", { type: "text/plain" });
    const response = await proxyAwareFetch(url, { method: "POST", body, directFetch: direct }, proxy);
    expect(await response.text()).toBe("fixture");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(direct).toHaveBeenCalledOnce();
    expect(direct.mock.calls[0][1].body).toBe(body);
  });

  it("does not consume or clone the Blob while deciding to replay it", async () => {
    const body = new Blob(["fixture"]);
    const streamSpy = vi.spyOn(body, "stream");
    const arrayBufferSpy = vi.spyOn(body, "arrayBuffer");
    // The direct fallback mock reads the body itself, so `text` is expected
    // there; the replay decision must not have consumed it beforehand.
    const textSpy = vi.spyOn(body, "text");
    await proxyAwareFetch(url, { method: "POST", body, directFetch: direct }, proxy);
    expect(streamSpy).not.toHaveBeenCalled();
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(textSpy).toHaveBeenCalledTimes(1);
  });

  it("replays a Blob whose bytes were already read once", async () => {
    const body = new Blob(["fixture"]);
    expect(await body.text()).toBe("fixture");
    const response = await proxyAwareFetch(url, { method: "POST", body, directFetch: direct }, proxy);
    expect(await response.text()).toBe("fixture");
    expect(direct).toHaveBeenCalledOnce();
  });

  it("keeps the single dispatch and original failure for a one-shot ReadableStream", async () => {
    const body = new ReadableStream();
    await expect(proxyAwareFetch(url, { method: "POST", body, directFetch: direct }, proxy)).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(direct).not.toHaveBeenCalled();
  });

  it.each([false, true])("keeps the single dispatch and original failure for a Request with bodyUsed=%s", async (used) => {
    const request = new Request(url, { method: "POST", body: "body" });
    if (used) await request.text();
    await expect(proxyAwareFetch(request, { directFetch: direct }, proxy)).rejects.toBe(failure);
    expect(request.bodyUsed).toBe(used);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(direct).not.toHaveBeenCalled();
  });

  it("keeps strict proxy, abort and specialized transport behavior for a Blob body", async () => {
    const body = new Blob(["fixture"]);
    await expect(proxyAwareFetch(url, { body, directFetch: direct }, { ...proxy, strictProxy: true }))
      .rejects.toThrow("strictProxy=true");
    const abort = new DOMException("aborted", "AbortError");
    fetchMock.mockRejectedValueOnce(abort);
    await expect(proxyAwareFetch(url, { body, directFetch: direct }, proxy)).rejects.toBe(abort);
    expect(direct).not.toHaveBeenCalled();

    const withProxy = vi.fn().mockRejectedValue(new Error("proxied transport failed"));
    await expect(proxyAwareFetch(url, { body, directFetch: withProxy }, proxy)).rejects.toThrow("proxied transport failed");
    expect(withProxy).toHaveBeenCalledOnce();
  });
});
