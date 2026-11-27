import { describe, expect, it, vi } from "vitest";
import { createEmptyRetryStream } from "../../open-sse/handlers/chatCore/emptyStreamGuard.js";
import { createSseFrameReader } from "../../open-sse/utils/sseFrames.js";
import { proxyAwareFetch, evictResponseDispatcher, __setOriginalFetchForTesting, __setProxyDispatcherForTesting, __clearProxyDispatchersForTesting } from "../../open-sse/utils/proxyFetch.js";

const prefix = 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}}\n\n';
// CPA 47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e,
// internal/runtime/executor/antigravity_executor_finish_reason_test.go,
// TestAntigravityStreamSurfacesTrailingBackendError (synthetic backend message).
const trailer = JSON.stringify({ error: { code: 503, message: "backend capacity exhausted — é", status: "UNAVAILABLE" } }, null, 2);
const bytes = new TextEncoder();

async function run(text, split) {
  const encoded = bytes.encode(text);
  const body = new ReadableStream({ start(c) {
    if (split) for (const byte of encoded) c.enqueue(new Uint8Array([byte]));
    else c.enqueue(encoded);
    c.close();
  } });
  const observed = vi.fn();
  const retry = vi.fn();
  const output = await new Response(createEmptyRetryStream({ body, reexecute: retry, onInBandError: observed })).text();
  expect(retry).not.toHaveBeenCalled();
  return { output, observed, body };
}

describe("bounded backend JSON trailers", () => {
  it.each([false, true])("preserves multiline errors and UTF-8, split bytes=%s", async (split) => {
    const { output, observed, body } = await run(prefix + trailer, split);
    expect(output).toContain(prefix);
    expect(output).toContain('"code":503');
    expect(output).toContain("backend capacity exhausted — é");
    expect(observed).toHaveBeenCalledExactlyOnceWith(JSON.parse(trailer).error, body);
    expect(output).not.toContain("STOP");
    expect(output).not.toContain("usageMetadata");
  });

  it.each(["\n\n", "\r\n\r\n"])("handles a terminated JSON trailer %j", async (ending) => {
    expect((await run(prefix + trailer + ending, true)).output).toContain('data: {"error":');
  });

  it.each(['{"error":', '{"text":"noise"}', '{"error":null}', '{"error":[]}'])("rejects non-error noise %s", async (noise) => {
    const { observed } = await run(prefix + noise, true);
    expect(observed).not.toHaveBeenCalled();
  });

  it("enforces the frame byte cap incrementally for bare JSON", () => {
    const reader = createSseFrameReader({ maxBytes: 64 });
    reader.push('{"error":{"message":"');
    expect(() => reader.push("x".repeat(64))).toThrow("SSE frame exceeds size limit");
  });

  it("forwards valid streams byte for byte", async () => {
    const text = prefix + 'data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n';
    expect((await run(text, true)).output).toBe(text);
  });

  it("cancels the original body once without replay after partial output", async () => {
    const cancel = vi.fn();
    const retry = vi.fn();
    const discarded = vi.fn();
    const body = new ReadableStream({ start(c) { c.enqueue(bytes.encode(prefix)); }, cancel });
    const reader = createEmptyRetryStream({ body, reexecute: retry, onAttemptDiscarded: discarded }).getReader();
    await reader.read();
    await reader.cancel("client left");
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(retry).not.toHaveBeenCalled();
  });

  it("retires the original serving dispatcher exactly once, isolating another account pool", async () => {
    const selected = { close: vi.fn() };
    const other = { close: vi.fn() };
    const proxy = "http://selected.example.test:8080";
    const restore = __setOriginalFetchForTesting(async () => new Response(prefix + JSON.stringify({ error: { code: 403, message: "denied" } })));
    try {
      __setProxyDispatcherForTesting(proxy, selected);
      __setProxyDispatcherForTesting("http://other.example.test:8080", other);
      const original = await proxyAwareFetch("https://backend.example.test", {}, { connectionProxyEnabled: true, connectionProxyUrl: proxy, disableEnvProxy: true });
      const body = original.body;
      const retry = vi.fn();
      const observed = vi.fn((_error, attemptBody) => {
        expect(attemptBody).toBe(body);
        expect(evictResponseDispatcher(attemptBody)).toBe(true);
      });
      await new Response(createEmptyRetryStream({ body, reexecute: retry, onInBandError: observed })).text();
      expect(original.body).toBe(body);
      expect(observed).toHaveBeenCalledOnce();
      expect(selected.close).toHaveBeenCalledOnce();
      expect(other.close).not.toHaveBeenCalled();
      expect(evictResponseDispatcher(original)).toBe(false);
      expect(retry).not.toHaveBeenCalled();
    } finally {
      restore();
      __clearProxyDispatchersForTesting();
    }
  });
});
