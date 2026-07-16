// Integration test for the OmniRoute#7093 port: BaseExecutor keeps the relay
// fetch timeout/abort signal live until a vercel-relay SSE body finalizes
// (EOF, cancel, or abort) instead of clearing it when headers arrive.
import { describe, it, expect, vi, afterEach } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import {
  proxyAwareFetch,
  __setOriginalFetchForTesting,
} from "../../open-sse/utils/proxyFetch.js";
import {
  runWithProviderAttemptContext,
  settleProviderAttemptDispatch,
} from "../../open-sse/services/providerAttemptContext.js";

const encoder = new TextEncoder();
const RELAY = { vercelRelayUrl: "https://relay.example.com/api/relay" };

let restoreFetch = null;
let capturedInit = null;

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  capturedInit = null;
});

function hookFetch(implementation) {
  restoreFetch = __setOriginalFetchForTesting((url, init) => {
    capturedInit = { url, init };
    return implementation(url, init);
  });
}

function sseResponse() {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("data: one\n\n"));
      controller.enqueue(encoder.encode("data: two\n\n"));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function makeExecutor() {
  return new BaseExecutor("test", {
    baseUrl: "https://upstream.example.com/v1/chat/completions",
    timeoutMs: 100,
  });
}

function executeRelay(ex, overrides = {}) {
  return ex.execute({
    model: "m",
    body: { stream: true },
    stream: true,
    credentials: {},
    proxyOptions: RELAY,
    ...overrides,
  });
}

describe("BaseExecutor relay SSE lifecycle (OmniRoute#7093 port)", () => {
  it("keeps the timeout live past headers and clears it on SSE EOF", async () => {
    vi.useFakeTimers();
    try {
      hookFetch(() => Promise.resolve(sseResponse()));
      const ex = makeExecutor();
      const { response } = await executeRelay(ex);
      const signal = capturedInit.init.signal;
      expect(signal.aborted).toBe(false);
      await response.text();
      // The wrapped stream finalized at EOF and cleared the connect timer:
      // advancing well past timeoutMs must NOT abort the captured signal.
      await vi.advanceTimersByTimeAsync(1000);
      expect(signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the timeout armed while the SSE body is stalled (fires timeout)", async () => {
    vi.useFakeTimers();
    try {
      const hangingBody = new ReadableStream({ pull: () => new Promise(() => {}) });
      hookFetch(() =>
        Promise.resolve(
          new Response(hangingBody, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      );
      const ex = makeExecutor();
      const { response } = await executeRelay(ex);
      const signal = capturedInit.init.signal;
      // Attach handlers before advancing the clock so the rejection cannot
      // trip Vitest's unhandled-rejection detection.
      const readOutcome = response.body.getReader().read().then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await vi.advanceTimersByTimeAsync(100); // timeoutMs
      expect(signal.aborted).toBe(true);
      // Signal-driven termination surfaces as AbortError, never clean EOF.
      const { error } = await readOutcome;
      expect(error).toMatchObject({ name: "AbortError" });
      // The timeout identity survives in the cause so the chatCore classifier
      // picks reason "timeout", not "abort".
      expect(String(error?.cause?.message || error?.message)).toContain("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timeout at headers for non-SSE relay responses", async () => {
    vi.useFakeTimers();
    try {
      hookFetch(() =>
        Promise.resolve(
          new Response("{\"ok\":true}", {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
      );
      const ex = makeExecutor();
      const { response } = await executeRelay(ex, { body: {}, stream: false });
      const signal = capturedInit.init.signal;
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(await response.text()).toBe("{\"ok\":true}");
      await vi.advanceTimersByTimeAsync(1000);
      expect(signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards the client's x-request-id into the relayed headers", async () => {
    hookFetch(() => Promise.resolve(sseResponse()));
    const ex = makeExecutor();
    const { response } = await executeRelay(ex, {
      requestContext: { clientHeaders: { "X-Request-ID": "bifrost-sse-lifecycle-test" } },
    });
    expect(new Headers(capturedInit.init.headers).get("x-request-id")).toBe("bifrost-sse-lifecycle-test");
    await response.body.cancel();
  });

  it("does not forward x-request-id on direct (non-relay) requests", async () => {
    hookFetch(() => Promise.resolve(sseResponse()));
    const ex = makeExecutor();
    const { response } = await ex.execute({
      model: "m",
      body: { stream: true },
      stream: true,
      credentials: {},
      requestContext: { clientHeaders: { "x-request-id": "client-id" } },
    });
    expect(new Headers(capturedInit.init.headers).get("x-request-id")).toBeNull();
    await response.body.cancel();
  });

  it("does not override an executor-set x-request-id on relay", async () => {
    hookFetch(() => Promise.resolve(sseResponse()));
    const ex = makeExecutor();
    ex.buildHeaders = () => ({ "x-request-id": "executor-id" });
    const { response } = await executeRelay(ex, {
      requestContext: { clientHeaders: { "x-request-id": "client-id" } },
    });
    expect(new Headers(capturedInit.init.headers).get("x-request-id")).toBe("executor-id");
    await response.body.cancel();
  });

  it("moves the quota dispatch ticket to the rebuilt relay response", async () => {
    hookFetch(() => Promise.resolve(sseResponse()));
    const ex = makeExecutor();
    const settle = vi.fn().mockResolvedValue({ changed: true });
    const ticket = { tracked: true, settle, release: vi.fn() };
    const beginQuotaDispatch = vi.fn().mockResolvedValue(ticket);
    const onProviderAttempt = vi.fn(() => 1);

    const out = await runWithProviderAttemptContext(
      onProviderAttempt,
      () => executeRelay(ex),
      { beginQuotaDispatch }
    );
    expect(beginQuotaDispatch).toHaveBeenCalledTimes(1);
    // Settling through the WRAPPED response must reach the original ticket once.
    const result = await settleProviderAttemptDispatch(out.response, { success: true });
    expect(result).toEqual({ changed: true });
    expect(settle).toHaveBeenCalledTimes(1);
    // A second settle is a no-op (mapping removed).
    const again = await settleProviderAttemptDispatch(out.response, { success: true });
    expect(again).toEqual({ changed: false });
    await out.response.body.cancel();
  });
});
