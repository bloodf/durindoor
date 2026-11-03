import { beforeEach, describe, expect, it, vi } from "vitest";

// #1085: once an async image provider accepted a job, any lost observation (an
// unreadable status or result body, a failed result fetch) is jobOutcomeUnknown so
// the core records it; a provider-reported failure and a client abort are not.
vi.mock("../../open-sse/handlers/imageProviders/_base.js", async (original) => ({ ...(await original()), POLL_INTERVAL_MS: 1 }));

const load = async (name) => (await import(`../../open-sse/handlers/imageProviders/${name}.js`)).default;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const garbled = () => new Response("{not json", { status: 200, headers: { "Content-Type": "application/json" } });
const adapters = {
  falAi: { submit: { status_url: "https://q.test/s", response_url: "https://q.test/r" }, done: { status: "COMPLETED" }, failed: { status: "FAILED" } },
  runwayml: { submit: { id: "task-1" }, failed: { status: "FAILED" } },
  blackForestLabs: { submit: { polling_url: "https://q.test/p" }, failed: { status: "Error" } },
  nanobanana: { submit: { code: 200, data: { taskId: "task-1" } }, failed: { data: { successFlag: 2 } } },
  magnific: { submit: { data: { task_id: "task-1" } }, failed: { data: { status: "FAILED" } } },
};
const run = (adapter, submit, signal = new AbortController().signal) =>
  adapter.parseResponse(json(submit), { headers: { "x-key": "k", "x-magnific-api-key": "k" }, signal });

beforeEach(() => { vi.unstubAllGlobals(); vi.stubGlobal("fetch", vi.fn()); });

describe.each(Object.entries(adapters))("%s", (name, spec) => {
  it("treats an unreadable status body as an unknown outcome", async () => {
    fetch.mockResolvedValueOnce(garbled());
    await expect(run(await load(name), spec.submit)).rejects.toMatchObject({ jobOutcomeUnknown: true });
  });

  it("keeps a provider-reported failure a plain failure", async () => {
    fetch.mockResolvedValueOnce(json(spec.failed));
    const error = await run(await load(name), spec.submit).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.jobOutcomeUnknown).toBeUndefined();
  });

  it("keeps a client abort an abort", async () => {
    const controller = new AbortController();
    fetch.mockImplementationOnce(async () => { controller.abort(); throw controller.signal.reason; });
    const error = await run(await load(name), spec.submit, controller.signal).catch((e) => e);
    expect(error.name).toBe("AbortError");
    expect(error.jobOutcomeUnknown).toBeUndefined();
  });
});

describe("fal result after COMPLETED", () => {
  it.each([["a failed result fetch", () => json({}, 500)], ["an unreadable result body", garbled]])("treats %s as an unknown outcome", async (_name, result) => {
    fetch.mockResolvedValueOnce(json(adapters.falAi.done)).mockResolvedValueOnce(result());
    await expect(run(await load("falAi"), adapters.falAi.submit)).rejects.toMatchObject({ jobOutcomeUnknown: true });
  });

  it("treats a rejected result fetch as an unknown outcome", async () => {
    fetch.mockResolvedValueOnce(json(adapters.falAi.done)).mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(run(await load("falAi"), adapters.falAi.submit)).rejects.toMatchObject({ jobOutcomeUnknown: true });
  });

  it("still returns a readable result", async () => {
    fetch.mockResolvedValueOnce(json(adapters.falAi.done)).mockResolvedValueOnce(json({ images: [{ url: "https://x.test/i.png" }] }));
    expect(await run(await load("falAi"), adapters.falAi.submit)).toEqual({ images: [{ url: "https://x.test/i.png" }] });
  });
});
