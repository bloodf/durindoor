import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import { fetch as undiciFetch } from "undici";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { CODEX_SSE_PEEK_TIMEOUT_MS } from "../../open-sse/config/runtimeConfig.js";
import {
  runQuotaBearingProviderRequest,
  runWithProviderAttemptContext,
  settleProviderAttemptDispatch,
} from "../../open-sse/services/providerAttemptContext.js";
import { QuotaDispatchUnavailableError } from "../../open-sse/services/quota/dispatch.js";
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
  vi.useRealTimers();
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

function quotaTicket(id) {
  return {
    tracked: true,
    reservationId: id,
    heartbeat: vi.fn(),
    settle: vi.fn(async () => ({ changed: true })),
    release: vi.fn(async (reason) => ({ changed: true, reason })),
  };
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

  it("releases a Base retry ticket before acquiring the next physical dispatch", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("retry", { status: 502 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    restoreFetch = __setOriginalFetchForTesting(fetch);
    const first = quotaTicket("reservation-1");
    const second = quotaTicket("reservation-2");
    const beginQuotaDispatch = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const executor = new BaseExecutor("test", {
      baseUrl: "https://provider.test/chat",
      retry: { 502: { attempts: 1, delayMs: 0 } },
    });

    await runWithProviderAttemptContext(() => Date.now(), () => executor.execute({
      model: "model",
      body: {},
      stream: false,
      credentials: {},
      proxyOptions: { vercelRelayUrl: "https://relay.test" },
    }), { beginQuotaDispatch });

    expect(beginQuotaDispatch).toHaveBeenCalledTimes(2);
    expect(first.settle).toHaveBeenCalledWith({ success: false, reason: "fallback" });
    expect(second.settle).not.toHaveBeenCalled();
  });

  it("releases a Base connect-timeout ticket before retry or fallback", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    restoreFetch = __setOriginalFetchForTesting(fetch);
    const ticket = quotaTicket("reservation-timeout");
    const beginQuotaDispatch = vi.fn().mockResolvedValue(ticket);
    const executor = new BaseExecutor("test", {
      baseUrl: "https://provider.test/chat",
      timeoutMs: 10,
      retry: { 502: { attempts: 0, delayMs: 0 } },
    });

    const execution = runWithProviderAttemptContext(() => Date.now(), () => executor.execute({
      model: "model",
      body: {},
      stream: false,
      credentials: {},
      proxyOptions: { vercelRelayUrl: "https://relay.test" },
    }), { beginQuotaDispatch });
    const outcome = execution.then(
      () => null,
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(10);

    await expect(outcome).resolves.toMatchObject({ message: "fetch connect timeout" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(beginQuotaDispatch).toHaveBeenCalledOnce();
    expect(ticket.release).toHaveBeenCalledOnce();
    expect(ticket.release).toHaveBeenCalledWith("timeout");
    expect(ticket.settle).not.toHaveBeenCalled();
  });

  it("rejects a method-preserving redirect before native fetch can hide a second POST", async () => {
    const paths = [];
    const server = createServer((request, response) => {
      paths.push(`${request.method} ${request.url}`);
      request.resume();
      if (request.url === "/start") {
        response.writeHead(307, { Location: "/final" });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    restoreFetch = __setOriginalFetchForTesting(undiciFetch);
    const ticket = quotaTicket("reservation-redirect");
    const beginQuotaDispatch = vi.fn().mockResolvedValue(ticket);
    const executor = new BaseExecutor("test", {
      baseUrl: `http://127.0.0.1:${address.port}/start`,
      timeoutMs: 1_000,
      retry: { 502: { attempts: 0, delayMs: 0 } },
    });

    try {
      await expect(runWithProviderAttemptContext(() => Date.now(), () => executor.execute({
        model: "model",
        body: {},
        stream: false,
        credentials: {},
        proxyOptions: { disableEnvProxy: true },
      }), { beginQuotaDispatch })).rejects.toThrow();
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }

    expect(paths).toEqual(["POST /start"]);
    expect(beginQuotaDispatch).toHaveBeenCalledOnce();
    expect(ticket.release).toHaveBeenCalledOnce();
    expect(ticket.release).toHaveBeenCalledWith("transport_error");
    expect(ticket.settle).not.toHaveBeenCalled();
  });

  it("times out a silent Codex SSE peek and settles before cancellation can hang", async () => {
    vi.useFakeTimers();
    const cancellation = vi.fn(() => new Promise(() => {}));
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start() {},
      cancel: cancellation,
    }), { status: 200, headers: { "content-type": "text/event-stream" } }));
    restoreFetch = __setOriginalFetchForTesting(fetch);
    const ticket = quotaTicket("reservation-codex-silent");
    const beginQuotaDispatch = vi.fn().mockResolvedValue(ticket);
    const executor = new CodexExecutor();
    const execution = runWithProviderAttemptContext(() => Date.now(), () => executor.execute({
      model: "gpt-test",
      body: { model: "gpt-test", input: [{ role: "user", content: "hello" }], stream: true },
      stream: true,
      credentials: { accessToken: "token", providerSpecificData: {} },
      log: { debug: vi.fn(), warn: vi.fn() },
      proxyOptions: { vercelRelayUrl: "https://relay.test" },
    }), { beginQuotaDispatch });
    const outcome = execution.then(() => null, (error) => error);
    await vi.waitFor(() => expect(beginQuotaDispatch).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(CODEX_SSE_PEEK_TIMEOUT_MS + 251);
    const error = await outcome;

    expect(error).toMatchObject({ name: "TimeoutError", message: "Codex SSE prefix timeout" });
    expect(cancellation).toHaveBeenCalledOnce();
    expect(ticket.settle).toHaveBeenCalledOnce();
    expect(ticket.settle).toHaveBeenCalledWith({ success: false, reason: "timeout" });
  });

  it("bounds the whole Codex SSE peek despite an endless preamble", async () => {
    vi.useFakeTimers();
    let timer = null;
    const cancellation = vi.fn(() => {
      if (timer) clearInterval(timer);
    });
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        timer = setInterval(() => controller.enqueue(new TextEncoder().encode(": keepalive\n")), 1_000);
      },
      cancel: cancellation,
    }), { status: 200, headers: { "content-type": "text/event-stream" } }));
    restoreFetch = __setOriginalFetchForTesting(fetch);
    const ticket = quotaTicket("reservation-codex-preamble");
    const beginQuotaDispatch = vi.fn().mockResolvedValue(ticket);
    const executor = new CodexExecutor();
    const execution = runWithProviderAttemptContext(() => Date.now(), () => executor.execute({
      model: "gpt-test",
      body: { model: "gpt-test", input: [{ role: "user", content: "hello" }], stream: true },
      stream: true,
      credentials: { accessToken: "token", providerSpecificData: {} },
      log: { debug: vi.fn(), warn: vi.fn() },
      proxyOptions: { vercelRelayUrl: "https://relay.test" },
    }), { beginQuotaDispatch });
    const outcome = execution.then(() => null, (error) => error);
    await vi.waitFor(() => expect(beginQuotaDispatch).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(CODEX_SSE_PEEK_TIMEOUT_MS + 1);
    const error = await outcome;

    expect(error).toMatchObject({ name: "TimeoutError" });
    expect(cancellation).toHaveBeenCalledOnce();
    expect(ticket.settle).toHaveBeenCalledWith({ success: false, reason: "timeout" });
  });

  it("does not leak lexical quota arming into an unarmed sibling dispatch", async () => {
    let releaseRuntime;
    const runtimeResponse = new Promise((resolve) => { releaseRuntime = () => resolve(new Response("runtime")); });
    const fetch = vi.fn((url) => (
      String(url).includes("runtime") ? runtimeResponse : Promise.resolve(new Response("auxiliary"))
    ));
    restoreFetch = __setOriginalFetchForTesting(fetch);
    const beginQuotaDispatch = vi.fn().mockResolvedValue(quotaTicket("reservation-1"));

    await runWithProviderAttemptContext(() => Date.now(), async () => {
      const runtime = runQuotaBearingProviderRequest(() => proxyAwareFetch(
        "https://provider.test/runtime",
        {},
        { vercelRelayUrl: "https://relay.test/runtime" },
      ));
      await vi.waitFor(() => expect(beginQuotaDispatch).toHaveBeenCalledOnce());
      const auxiliary = await proxyAwareFetch(
        "https://provider.test/auxiliary",
        {},
        { vercelRelayUrl: "https://relay.test/auxiliary" },
      );
      expect(await auxiliary.text()).toBe("auxiliary");
      expect(beginQuotaDispatch).toHaveBeenCalledOnce();
      releaseRuntime();
      await runtime;
    }, { beginQuotaDispatch });
  });

  it("stops before transport when physical capacity acquisition is denied", async () => {
    const fetch = vi.fn();
    restoreFetch = __setOriginalFetchForTesting(fetch);
    const executor = new BaseExecutor("test", {
      baseUrl: "https://provider.test/chat",
      retry: { 502: { attempts: 2, delayMs: 0 } },
    });

    await expect(runWithProviderAttemptContext(() => Date.now(), () => executor.execute({
      model: "model",
      body: {},
      stream: false,
      credentials: {},
      proxyOptions: { vercelRelayUrl: "https://relay.test" },
    }), {
      beginQuotaDispatch: async () => { throw new QuotaDispatchUnavailableError("capacity_exhausted"); },
    })).rejects.toMatchObject({ code: "QUOTA_DISPATCH_UNAVAILABLE", reason: "capacity_exhausted" });

    expect(fetch).not.toHaveBeenCalled();
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

  it("releases a failed proxy ticket before acquiring a direct-fallback ticket", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("proxy transport failed"))
      .mockResolvedValueOnce(new Response("direct", { status: 200 }));
    restoreFetch = __setOriginalFetchForTesting(fetch);
    __setProxyDispatcherForTesting("http://proxy.example.test:8080", {});
    const proxyTicket = quotaTicket("reservation-proxy");
    const directTicket = quotaTicket("reservation-direct");
    const beginQuotaDispatch = vi.fn()
      .mockResolvedValueOnce(proxyTicket)
      .mockResolvedValueOnce(directTicket);

    const response = await runWithProviderAttemptContext(() => Date.now(), () => (
      runQuotaBearingProviderRequest(() => proxyAwareFetch(
        "https://provider.example.test/chat",
        { method: "POST", body: "{}" },
        {
          enabled: true,
          connectionProxyUrl: "http://proxy.example.test:8080",
          disableEnvProxy: true,
        },
      ))
    ), { beginQuotaDispatch });

    expect(await response.text()).toBe("direct");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(beginQuotaDispatch).toHaveBeenCalledTimes(2);
    expect(proxyTicket.release).toHaveBeenCalledOnce();
    expect(proxyTicket.release).toHaveBeenCalledWith("transport_error");
    expect(proxyTicket.settle).not.toHaveBeenCalled();
    expect(directTicket.release).not.toHaveBeenCalled();
    expect(directTicket.settle).not.toHaveBeenCalled();

    await settleProviderAttemptDispatch(response, { success: true, reason: "success" });
    expect(directTicket.settle).toHaveBeenCalledOnce();
    expect(directTicket.settle).toHaveBeenCalledWith({ success: true, reason: "success" });
  });
});
