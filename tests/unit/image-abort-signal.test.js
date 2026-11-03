// #1500: the client abort signal must reach async image adapters so polling stops on disconnect.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { sleep } from "../../open-sse/handlers/imageProviders/_base.js";

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

    expect((await result).success).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(callsBeforeAbort);
  });
});
