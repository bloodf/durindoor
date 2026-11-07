// #1500: the client abort signal must reach async image adapters so polling stops on disconnect.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  execute: vi.fn(),
  fetchImage: vi.fn()
}));
vi.mock("../../open-sse/services/tokenRefresh.js", async (orig) => ({ ...(await orig()), refreshWithRetry: mocks.refresh }));
vi.mock("../../open-sse/executors/index.js", async (orig) => {
  const actual = await orig();
  return { ...actual, getExecutor: (p) => (p === "antigravity" ? { execute: mocks.execute } : actual.getExecutor(p)) };
});
vi.mock("../../open-sse/translator/concerns/image.js", async (orig) => ({ ...(await orig()), fetchImageAsBase64: mocks.fetchImage }));

const { handleImageGenerationCore } = await import("../../open-sse/handlers/imageGenerationCore.js");
import { FETCH_TIMEOUT_MS } from "../../open-sse/config/mediaConfig.js";
const { sleep } = await import("../../open-sse/handlers/imageProviders/_base.js");

const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });
const originalFetch = global.fetch;

const ADAPTERS = [
  ["runwayml", "gen4_image", { id: "task-1" }, { status: "RUNNING" }],
  ["magnific", "realism", { data: { task_id: "task-1" } }, { data: { status: "IN_PROGRESS" } }],
  ["fal-ai", "fal-ai/flux/dev", { status_url: "https://fal.test/status", response_url: "https://fal.test/result" }, { status: "IN_PROGRESS" }],
  ["black-forest-labs", "flux-pro", { polling_url: "https://bfl.test/poll" }, { status: "Pending" }],
  ["nanobanana", "nanobanana", { code: 200, data: { taskId: "task-1" } }, { data: { successFlag: 0 } }]
];

const run = (provider, model, signal) => handleImageGenerationCore({
  body: { prompt: "a fox" },
  modelInfo: { provider, model },
  credentials: { apiKey: "key" },
  log: null,
  signal
});

describe("sleep", () => {
  it("rejects immediately when the signal is already aborted", async () => {
    await expect(sleep(1000, AbortSignal.abort(new Error("gone")))).rejects.toThrow("gone");
  });

  it("rejects when the signal aborts mid-wait", async () => {
    const ctrl = new AbortController();
    const pending = sleep(60000, ctrl.signal);
    ctrl.abort(new Error("gone"));
    await expect(pending).rejects.toThrow("gone");
  });
});

describe.each(ADAPTERS)("%s async polling honours the request abort signal", (provider, model, submit, pending) => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValueOnce(json(submit)).mockImplementation(async () => json(pending));
  });
  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it("stops polling after abort and forwards the signal to status fetches", async () => {
    const ctrl = new AbortController();
    const result = run(provider, model, ctrl.signal);
    await vi.advanceTimersByTimeAsync(1600);
    const callsBeforeAbort = global.fetch.mock.calls.length;
    expect(callsBeforeAbort).toBeGreaterThan(1);
    expect(global.fetch.mock.calls.at(-1)[1].signal).toBe(ctrl.signal);

    ctrl.abort(new Error("client disconnected"));
    await vi.advanceTimersByTimeAsync(10000);

    const outcome = await result;
    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe(499);
    expect(global.fetch).toHaveBeenCalledTimes(callsBeforeAbort);
  });
});

describe("other abort propagation points in the core", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

  it("forwards the signal to the fal result fetch", async () => {
    const ctrl = new AbortController();
    global.fetch
      .mockResolvedValueOnce(json({ status_url: "https://fal.test/status", response_url: "https://fal.test/result" }))
      .mockResolvedValueOnce(json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(json({ images: [{ url: "https://fal.test/a.png" }] }));
    const result = await run("fal-ai", "fal-ai/flux/dev", ctrl.signal);
    expect(result.success).toBe(true);
    const resultCall = global.fetch.mock.calls.find(([u]) => u === "https://fal.test/result");
    expect(resultCall[1].signal).toBe(ctrl.signal);
  }, 15000);

  it("aborting the submit fetch returns 499", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    global.fetch.mockRejectedValueOnce(abortError());
    const result = await run("openai", "dall-e-3", ctrl.signal);
    expect(result.status).toBe(499);
  });

  it("forwards the signal to the post-refresh retry and returns 499 when it is aborted there", async () => {
    const ctrl = new AbortController();
    mocks.refresh.mockResolvedValue({ apiKey: "new-key" });
    global.fetch
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockImplementationOnce(async () => { ctrl.abort(); throw abortError(); });
    const result = await run("openai", "dall-e-3", ctrl.signal);
    expect(global.fetch.mock.calls[1][1].signal).toBe(ctrl.signal);
    expect(result.status).toBe(499);
  });

  it("passes the signal to the antigravity executor and maps its abort to 499", async () => {
    const ctrl = new AbortController();
    mocks.execute.mockResolvedValueOnce({ response: json({ candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }] }) });
    expect((await run("antigravity", "gemini-3-pro-image", ctrl.signal)).success).toBe(true);
    expect(mocks.execute.mock.calls[0][0].signal).toBe(ctrl.signal);

    mocks.execute.mockImplementationOnce(async () => { ctrl.abort(); throw abortError(); });
    expect((await run("antigravity", "gemini-3-pro-image", ctrl.signal)).status).toBe(499);
  });

  it("binary output prefetch gets a fresh time-limited signal created after a slow generation", async () => {
    const ctrl = new AbortController();
    const order = [];
    const timeoutCtrl = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => { order.push(`timeout:${ms}`); return timeoutCtrl.signal; });
    global.fetch.mockImplementationOnce(async () => { order.push("submit-done"); return json({ created: 1, data: [{ url: "https://cdn.test/a.png" }] }); });
    mocks.fetchImage.mockResolvedValueOnce({ url: "data:image/png;base64,AAAA" });
    try {
      const result = await handleImageGenerationCore({
        body: { prompt: "a fox" },
        modelInfo: { provider: "openai", model: "dall-e-3" },
        credentials: { apiKey: "key" },
        binaryOutput: true,
        log: null,
        signal: ctrl.signal
      });
      expect(result.success).toBe(true);
      // The timeout starts only once generation has finished, so a slow job still gets its bytes.
      expect(order).toEqual(["submit-done", `timeout:${FETCH_TIMEOUT_MS}`]);
      const { signal } = mocks.fetchImage.mock.calls[0][1];
      expect(signal.aborted).toBe(false);
      timeoutCtrl.abort();
      expect(signal.aborted).toBe(true);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("binary output prefetch is aborted by the client signal", async () => {
    const ctrl = new AbortController();
    global.fetch.mockResolvedValueOnce(json({ created: 1, data: [{ url: "https://cdn.test/a.png" }] }));
    mocks.fetchImage.mockResolvedValueOnce({ url: "data:image/png;base64,AAAA" });
    await handleImageGenerationCore({
      body: { prompt: "a fox" },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "key" },
      binaryOutput: true,
      log: null,
      signal: ctrl.signal
    });
    const { signal } = mocks.fetchImage.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    ctrl.abort();
    expect(signal.aborted).toBe(true);
  });
});
