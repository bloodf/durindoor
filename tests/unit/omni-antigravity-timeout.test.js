import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { runWithTransientBackendRetry } from "../../open-sse/services/transientBackendRetry.js";

function executor(provider = "antigravity") {
  const instance = new AntigravityExecutor(provider);
  instance.getFallbackCount = () => 2;
  instance.buildUrl = () => "https://example.test/v1";
  instance.buildHeaders = () => ({});
  instance.transformRequest = () => ({});
  return instance;
}

describe("Antigravity pre-response timeout", () => {
  it("preserves its timer error and does not retry even with an explicit retry rule", async () => {
    let sends = 0;
    const directFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
      sends++;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const error = await executor().execute({ model: "test", body: { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] } }, credentials: {}, requestPolicy: { headerTimeoutMs: 5, maxTransportAttempts: 3, skipRules: [{ provider: "antigravity", match: { kind: "connect_timeout" }, action: "retry" }] }, directFetch }).catch(e => e);
    expect(error.name).toBe("TimeoutError");
    expect(error.errorKind).toBe("connect_timeout");
    expect(error.antigravityPreResponseTimeout).toBe(true);
    expect(sends).toBe(1);
  });
  it("does not mistake a caller abort for the header deadline", async () => {
    const controller = new AbortController();
    const reason = new DOMException("caller left", "AbortError");
    const directFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      controller.abort(reason);
    });
    const error = await executor().execute({ model: "test", body: { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] } }, credentials: {}, signal: controller.signal, directFetch }).catch(e => e);
    expect(error).toBe(reason);
    expect(error.antigravityPreResponseTimeout).toBeUndefined();
  });
  it("returns an upstream 504 without replaying or relabeling it as a local deadline", async () => {
    let sends = 0;
    const response = new Response("upstream timeout", { status: 504 });
    const result = await executor().execute({
      model: "test",
      body: { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] } },
      credentials: {},
      requestPolicy: { maxTransportAttempts: 3 },
      directFetch: async () => {
        sends++;
        return response;
      },
    });
    expect(result.response).toBe(response);
    expect(sends).toBe(1);
  });
  it("does not replay an exhausted account sweep but still retries ordinary 504s", async () => {
    let sends = 0;
    const timedOut = Object.assign(new Response("timeout", { status: 504 }), { skipAntigravityTimeoutReplay: true });
    expect(await runWithTransientBackendRetry(async () => { sends++; return timedOut; }, { sleep: async () => {} })).toBe(timedOut);
    expect(sends).toBe(1);
    sends = 0;
    await runWithTransientBackendRetry(async () => { sends++; return new Response("timeout", { status: 504 }); }, { sleep: async () => {} });
    expect(sends).toBe(3);
  });
});
