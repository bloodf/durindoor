// #1201: Magnific Mystic async image generation (submit + poll).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/handlers/imageProviders/_base.js", async (orig) => ({ ...(await orig()), sleep: () => Promise.resolve() }));
const { handleImageGenerationCore } = await import("../../open-sse/handlers/imageGenerationCore.js");
const { getImageAdapter } = await import("../../open-sse/handlers/imageProviders/index.js");

const BASE = "https://api.magnific.com/v1/ai/mystic";
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const originalFetch = global.fetch;
const run = (body = { prompt: "a fox", size: "1792x1024" }) => handleImageGenerationCore({
  body,
  modelInfo: { provider: "magnific", model: "realism" },
  credentials: { apiKey: "mg-key" },
  log: null,
});

describe("magnific image provider", () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  it("submits a Mystic task, polls until COMPLETED and returns the image URLs", async () => {
    global.fetch
      .mockResolvedValueOnce(json({ data: { task_id: "task-1", status: "CREATED" } }))
      .mockResolvedValueOnce(json({ data: { status: "IN_PROGRESS" } }))
      .mockResolvedValueOnce(json({ data: { status: "COMPLETED", generated: ["https://cdn.magnific.com/a.png"] } }));
    const result = await run();
    expect(result.success).toBe(true);
    const [submitUrl, submit] = global.fetch.mock.calls[0];
    expect(submitUrl).toBe(BASE);
    expect(submit.headers["x-magnific-api-key"]).toBe("mg-key");
    expect(JSON.parse(submit.body)).toEqual({ prompt: "a fox", model: "realism", resolution: "1k", aspect_ratio: "widescreen_16_9" });
    expect(global.fetch.mock.calls[1][0]).toBe(`${BASE}/task-1`);
    expect(global.fetch.mock.calls[1][1].headers).toEqual({ "x-magnific-api-key": "mg-key" });
    const body = result.response ? await result.response.json() : result.data;
    expect(JSON.stringify(body)).toContain("https://cdn.magnific.com/a.png");
  });

  it("fails on FAILED tasks and on a missing or unsafe task_id", async () => {
    global.fetch
      .mockResolvedValueOnce(json({ data: { task_id: "t2" } }))
      .mockResolvedValueOnce(json({ data: { status: "FAILED" } }));
    expect((await run()).success).toBe(false);
    global.fetch.mockResolvedValueOnce(json({ data: { task_id: "../../evil" } }));
    expect((await run()).success).toBe(false);
    expect(global.fetch.mock.calls.at(-1)[0]).toBe(BASE); // never polled the injected path
  });

  it("maps upstream auth errors", async () => {
    global.fetch.mockResolvedValueOnce(json({ message: "invalid key" }, 401));
    const result = await run();
    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
  });

  it("is registered as an image adapter", () => {
    expect(getImageAdapter("magnific")).toBeTruthy();
  });
});
