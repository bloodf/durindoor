// Qoder 10605 model-queue replay (#1558, upstream 9router 2720cd2a).
// Unverified: payload shapes come from upstream text; no live Qoder capture.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...a) => fetchMock(...a) }));
vi.mock("../../open-sse/services/qoderModels.js", () => ({
  getQoderModelConfig: vi.fn().mockResolvedValue({ key: "auto", max_output_tokens: 1024, is_reasoning: false }),
  resolveQoderModels: vi.fn(),
}));

const { runWithProviderAttemptContext, runProviderAttemptDispatch } = await import("../../open-sse/services/providerAttemptContext.js");
const { QoderExecutor } = await import("../../open-sse/executors/qoder.js");
const { parseQoderQueueInfo, computeQoderQueueDelayMs, qoderQueueMaxWaitMs, QODER_QUEUE_MAX_ATTEMPTS } = await import("../../open-sse/shared/qoder/queue.js");
const { deriveMachineId } = await import("../../open-sse/shared/qoder/cosy.js");

const frame = (status, body) => `data: ${JSON.stringify({ statusCodeValue: status, body })}\n\n`;
const queued = (retryAfterSeconds = 30) => new Response(frame(403, JSON.stringify({
  code: "10605", subCode: "RESOURCE_LIMIT",
  message: JSON.stringify({ isQueued: true, queueType: "p3", retryAfterSeconds }),
})));
const ok = () => new Response(frame(200, JSON.stringify({ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] })) + frame(200, "[DONE]"));
const billing = () => new Response(frame(403, JSON.stringify({ code: "112", message: "quota exhausted" })));

const request = (extra = {}) => ({
  model: "qoder/auto",
  body: { messages: [{ role: "user", content: "hello" }] },
  stream: true,
  credentials: { accessToken: "dt-token", providerSpecificData: { userId: "user-1" } },
  ...extra,
});

describe("qoder queue helpers", () => {
  it("parses a double-encoded queue payload and clamps the delay", () => {
    const info = parseQoderQueueInfo(JSON.stringify({ code: "10605", message: JSON.stringify({ isQueued: true, retryAfterSeconds: 2 }) }));
    expect(info.isQueued).toBe(true);
    expect(computeQoderQueueDelayMs(info)).toBe(15_000);
    expect(computeQoderQueueDelayMs({ retryAfterSeconds: 600 })).toBe(60_000);
    expect(parseQoderQueueInfo(JSON.stringify({ code: "112" }))).toBeNull();
  });

  it("bounds the wait and derives a stable machine id", () => {
    expect(qoderQueueMaxWaitMs()).toBe(180_000);
    expect(QODER_QUEUE_MAX_ATTEMPTS).toBe(6);
    expect(deriveMachineId("user-1")).toBe(deriveMachineId("user-1"));
    expect(deriveMachineId("user-1")).not.toBe(deriveMachineId("user-2"));
  });
});

describe("QoderExecutor queue replay", () => {
  beforeEach(() => { fetchMock.mockReset(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  const run = async (extra) => {
    const promise = new QoderExecutor().execute(request(extra));
    await vi.runAllTimersAsync();
    return promise;
  };

  it("replays a queued request with a fresh signature and a stable machine id, then streams", async () => {
    fetchMock.mockResolvedValueOnce(queued(2)).mockResolvedValueOnce(ok());
    const result = await run();
    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toContain("hi");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [a, b] = fetchMock.mock.calls.map((c) => c[1]);
    expect(a.headers["Cosy-Machineid"]).toBe(deriveMachineId("user-1"));
    expect(b.headers["Cosy-Machineid"]).toBe(a.headers["Cosy-Machineid"]);
    expect(b.headers).not.toEqual(a.headers); // re-signed
  });

  it("stops after the attempt cap with a retryable 503 and no raw upstream text", async () => {
    fetchMock.mockImplementation(async () => queued(15));
    const result = await run();
    expect(result.response.status).toBe(503);
    expect(result.response.headers.get("x-qoder-queue-delay-ms")).toBeNull();
    expect((await result.response.json()).error.code).toBe("qoder_model_queued");
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(QODER_QUEUE_MAX_ATTEMPTS);
  });

  it("settles each queued send's quota ticket as fallback so only the final send stays held", async () => {
    const tickets = [];
    const beginQuotaDispatch = async () => {
      const ticket = { tracked: true, settled: null, settle: vi.fn(async (outcome) => { ticket.settled = outcome; }), release: vi.fn() };
      tickets.push(ticket);
      return ticket;
    };
    const responses = [queued(2), queued(2), ok()];
    fetchMock.mockImplementation(() => runProviderAttemptDispatch(async () => responses.shift()));
    const promise = runWithProviderAttemptContext(() => {}, () => new QoderExecutor().execute(request()), { beginQuotaDispatch });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.response.status).toBe(200);
    expect(tickets).toHaveLength(3);
    expect(tickets.slice(0, 2).map((t) => t.settled)).toEqual([{ success: false, reason: "fallback" }, { success: false, reason: "fallback" }]);
    expect(tickets[2].settle).not.toHaveBeenCalled(); // left for the caller to commit once the stream ends
  });

  it("does not replay a real billing block", async () => {
    fetchMock.mockResolvedValueOnce(billing());
    const result = await run();
    expect(result.response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("releases the wait when the caller aborts", async () => {
    fetchMock.mockImplementation(async () => queued(60));
    const ctrl = new AbortController();
    const promise = new QoderExecutor().execute(request({ signal: ctrl.signal }));
    const settled = promise.then(() => "done", (e) => e);
    await vi.advanceTimersByTimeAsync(100);
    ctrl.abort(new Error("client gone"));
    await vi.advanceTimersByTimeAsync(100);
    expect(String(await settled)).toContain("client gone");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
