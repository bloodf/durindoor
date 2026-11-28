// Qoder queue-status polling while a model is queued (#2034).
// Unverified: payload shapes come from upstream text; no live Qoder capture.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetchMock(...args) }));
vi.mock("../../open-sse/services/catalogs/qoderModels.js", () => ({
  getQoderModelConfig: vi.fn().mockResolvedValue({ key: "auto", max_output_tokens: 1024, is_reasoning: false }),
  resolveQoderModels: vi.fn(),
}));

const { QoderExecutor } = await import("../../open-sse/executors/qoder.js");
const frame = (status, body) => `data: ${JSON.stringify({ statusCodeValue: status, body })}\n\n`;
const queued = (retryAfterSeconds = 15) => new Response(frame(403, JSON.stringify({
  code: "10605", subCode: "RESOURCE_LIMIT",
  message: JSON.stringify({ isQueued: true, modelKey: "auto", queueType: "p3", retryAfterSeconds }),
})));
const ready = () => new Response(JSON.stringify({ isQueued: false, retryAfterSeconds: 1 }));
const stillQueued = () => new Response(JSON.stringify({ isQueued: true, retryAfterSeconds: 1 }));
const ok = () => new Response(frame(200, JSON.stringify({ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] })) + frame(200, "[DONE]"));
const request = (extra = {}) => ({
  model: "qoder/auto", body: { messages: [{ role: "user", content: "hello" }] }, stream: true,
  credentials: { accessToken: "synthetic-token", providerSpecificData: { userId: "synthetic-user" } }, ...extra,
});
const isStatusUrl = (url) => String(url).includes("/algo/api/v2/service/ask/queue/status?");

describe("Qoder queue status polling", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.useFakeTimers();
    delete process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS;
  });
  afterEach(() => { vi.useRealTimers(); delete process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS; });

  it("replays immediately when status reports the queue cleared", async () => {
    fetchMock.mockResolvedValueOnce(queued()).mockResolvedValueOnce(ready()).mockResolvedValueOnce(ok());
    const resultPromise = new QoderExecutor().execute(request());
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(isStatusUrl(fetchMock.mock.calls[1][0])).toBe(true);
    expect(String(fetchMock.mock.calls[1][0])).toContain("requestSetId=");
  });

  it("falls back to the existing delay when the status endpoint errors", async () => {
    let postCount = 0;
    fetchMock.mockImplementation(async (url) => {
      if (isStatusUrl(url)) throw new Error("status unavailable");
      postCount += 1;
      return postCount === 1 ? queued(15) : ok();
    });
    const promise = new QoderExecutor().execute(request());
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.runAllTimersAsync();
    expect((await promise).response.status).toBe(200);
  });

  it("respects attempt and max-wait limits while polling", async () => {
    process.env.QODER_MODEL_QUEUE_MAX_WAIT_MS = "45000";
    fetchMock.mockImplementation(async (url) => (isStatusUrl(url) ? stillQueued() : queued()));
    const promise = new QoderExecutor().execute(request());
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.response.status).toBe(503);
    expect(fetchMock.mock.calls.filter(([url]) => isStatusUrl(url)).length).toBeLessThanOrEqual(2);
    expect(fetchMock.mock.calls.filter(([url]) => !isStatusUrl(url)).length).toBeLessThanOrEqual(2);
  });

  it("stops polling when the caller aborts", async () => {
    fetchMock.mockResolvedValueOnce(queued()).mockResolvedValueOnce(stillQueued());
    const controller = new AbortController();
    const promise = new QoderExecutor().execute(request({ signal: controller.signal }));
    const settled = promise.then(() => null, (error) => error);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort(new Error("client disconnected"));
    await vi.runAllTimersAsync();
    expect(String(await settled)).toContain("client disconnected");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
