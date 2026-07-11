import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import {
  runWithProviderAttemptContext,
} from "../../open-sse/services/providerAttemptContext.js";
import {
  __clearProxyDispatchersForTesting,
  __setBypassTransportForTesting,
  __setOriginalFetchForTesting,
  __setProxyDispatcherForTesting,
  createBypassRequest,
  proxyAwareFetch,
} from "../../open-sse/utils/proxyFetch.js";

let restoreFetch = null;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  __clearProxyDispatchersForTesting();
  vi.restoreAllMocks();
});

function fakeBypassTransport({ closeResponse = true } = {}) {
  const socket = { destroy: vi.fn() };
  const request = new EventEmitter();
  const response = new PassThrough();
  response.statusCode = 200;
  response.statusMessage = "OK";
  response.headers = { "content-type": "application/octet-stream" };
  response.on("error", () => {});
  vi.spyOn(response, "destroy");
  request.write = vi.fn();
  request.destroy = vi.fn();
  let respond;
  request.end = vi.fn(() => {
    queueMicrotask(() => {
      request.emit("socket", socket);
      respond(response);
      if (closeResponse) response.end("ok");
    });
  });
  const https = {
    request: vi.fn((options, callback) => {
      respond = callback;
      https.lastOptions = options;
      return request;
    }),
  };
  const tls = { checkServerIdentity: vi.fn(() => undefined) };
  return { https, tls, request, response, socket };
}

describe("provider physical-dispatch attempt context", () => {
  it("allocates one fresh clock for each proxy-aware physical dispatch", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("ok"));
    restoreFetch = __setOriginalFetchForTesting(fetch);
    const onProviderAttempt = vi.fn()
      .mockReturnValueOnce(1001)
      .mockReturnValueOnce(1002);

    await runWithProviderAttemptContext(onProviderAttempt, async () => {
      await proxyAwareFetch("https://provider.test/one", {}, { vercelRelayUrl: "https://relay.test" });
      await proxyAwareFetch("https://provider.test/two", {}, { vercelRelayUrl: "https://relay.test" });
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onProviderAttempt).toHaveBeenCalledTimes(2);
  });

  it("does not double-stamp BaseExecutor reservations and refreshes retries", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("retry", { status: 502 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    restoreFetch = __setOriginalFetchForTesting(fetch);
    const onProviderAttempt = vi.fn()
      .mockReturnValueOnce(2001)
      .mockReturnValueOnce(2002);
    const executor = new BaseExecutor("test", {
      baseUrl: "https://provider.test/chat",
      retry: { 502: { attempts: 1, delayMs: 0 } },
    });

    const result = await runWithProviderAttemptContext(onProviderAttempt, () => executor.execute({
      model: "model",
      body: {},
      stream: false,
      credentials: {},
      onProviderAttempt,
      proxyOptions: { vercelRelayUrl: "https://relay.test" },
    }));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onProviderAttempt).toHaveBeenCalledTimes(2);
    expect(result.attemptStartedAt).toBe(2002);
  });

  it("routes DNS bypass to the resolved IP while preserving Cursor protobuf bytes", async () => {
    const transport = fakeBypassTransport();
    const restoreTransport = __setBypassTransportForTesting(transport);
    const body = new Uint8Array([0, 255, 17, 42]);
    try {
      const response = await createBypassRequest(
        new URL("https://api2.cursor.sh/aiserver.v1.ChatService/Stream?x=1"),
        "203.0.113.7",
        { method: "POST", headers: { "content-type": "application/connect+proto" }, body },
      );

      expect(await response.text()).toBe("ok");
      expect(transport.https.lastOptions).toMatchObject({
        hostname: "203.0.113.7",
        port: 443,
        servername: "api2.cursor.sh",
        agent: false,
        rejectUnauthorized: true,
        path: "/aiserver.v1.ChatService/Stream?x=1",
        headers: expect.objectContaining({ Host: "api2.cursor.sh" }),
      });
      transport.https.lastOptions.checkServerIdentity("203.0.113.7", { subject: {} });
      expect(transport.tls.checkServerIdentity).toHaveBeenCalledWith(
        "api2.cursor.sh",
        { subject: {} },
      );
      expect(transport.request.write).toHaveBeenCalledOnce();
      expect(Buffer.from(transport.request.write.mock.calls[0][0])).toEqual(Buffer.from(body));
    } finally {
      restoreTransport();
    }
  });

  it("does not open a DNS-bypass transport for a pre-aborted request", async () => {
    const transport = fakeBypassTransport();
    const restoreTransport = __setBypassTransportForTesting(transport);
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(createBypassRequest(
        new URL("https://api2.cursor.sh/path"),
        "203.0.113.7",
        { signal: controller.signal },
      )).rejects.toMatchObject({ name: "AbortError" });
      expect(transport.https.request).not.toHaveBeenCalled();
    } finally {
      restoreTransport();
    }
  });

  it("destroys an active DNS-bypass response, request, and socket on abort", async () => {
    const transport = fakeBypassTransport({ closeResponse: false });
    const restoreTransport = __setBypassTransportForTesting(transport);
    const controller = new AbortController();
    try {
      await createBypassRequest(
        new URL("https://api2.cursor.sh/path"),
        "203.0.113.7",
        { signal: controller.signal },
      );
      controller.abort();
      expect(transport.response.destroy).toHaveBeenCalledOnce();
      expect(transport.request.destroy).toHaveBeenCalledOnce();
      expect(transport.socket.destroy).toHaveBeenCalledOnce();
    } finally {
      restoreTransport();
    }
  });

  it("does not fall through to a second dispatch after a proxy request aborts", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockImplementation(async () => {
      controller.abort();
      throw controller.signal.reason;
    });
    restoreFetch = __setOriginalFetchForTesting(fetch);
    __setProxyDispatcherForTesting("http://proxy.example.test:8080", {});
    const onProviderAttempt = vi.fn().mockReturnValue(3001);

    await expect(runWithProviderAttemptContext(onProviderAttempt, () => proxyAwareFetch(
      "https://api2.cursor.sh/path",
      { signal: controller.signal },
      {
        enabled: true,
        connectionProxyUrl: "http://proxy.example.test:8080",
        disableEnvProxy: true,
      },
    ))).rejects.toMatchObject({ name: "AbortError" });

    expect(fetch).toHaveBeenCalledOnce();
    expect(onProviderAttempt).toHaveBeenCalledOnce();
  });
});
