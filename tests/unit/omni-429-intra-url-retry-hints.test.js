import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetchMock(...args) }));
const { BaseExecutor } = await import("../../open-sse/executors/base.js");

beforeEach(() => fetchMock.mockReset());

async function run(response, { attempts = 2, delayMs = 1, policy, executor } = {}) {
  const ex = executor || new BaseExecutor("test", { baseUrl: "https://example.test", retry: { 429: { attempts, delayMs } } });
  fetchMock.mockResolvedValueOnce(response).mockResolvedValue(new Response("ok", { status: 200 }));
  return ex.execute({ model: "m", body: {}, stream: false, credentials: {}, requestPolicy: policy });
}
const limited = (body = "{}", headers = {}) => new Response(body, { status: 429, headers });

describe("same URL 429 retry hints", () => {
  it("returns a long header hint with its original body", async () => {
    const out = await run(limited('{"retry_after_ms":1}', { "Retry-After": "60" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await out.response.text()).toBe('{"retry_after_ms":1}');
  });
  it("prefers a valid short header over a long body hint", async () => {
    await run(limited('{"retry_after_ms":60000}', { "Retry-After": "1" }), { delayMs: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("uses a structured body when the header is malformed", async () => {
    const out = await run(limited('{"retry_after_ms":60000}', { "Retry-After": "bad" }));
    expect(out.response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["{}", "not json", '{"retry_after_ms":"bad"}'])("retains retries for %s", async (body) => {
    await run(limited(body));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("retries at the exact window boundary", async () => {
    await run(limited('{"retry_after_ms":2}'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("honors explicit retry rules and their dispatch cap", async () => {
    await run(limited("{}", { "Retry-After": "60" }), { policy: { maxTransportAttempts: 2, skipRules: [{ provider: "test", action: "retry", match: { status: 429 } }] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("uses the remaining transport cap in the window", async () => {
    await run(limited('{"retry_after_ms":2}'), { policy: { maxTransportAttempts: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("defers to provider hooks", async () => {
    const ex = new BaseExecutor("test", { baseUrl: "https://example.test", retry: { 429: { attempts: 1, delayMs: 1 } } });
    ex.computeRetryDelay = vi.fn().mockResolvedValue(false);
    const out = await run(limited("{}", { "Retry-After": "60" }), { executor: ex });
    expect(out.response.status).toBe(429);
    expect(ex.computeRetryDelay).toHaveBeenCalledOnce();
  });
  it("does not clone when retry is unavailable or status differs", async () => {
    const response = limited();
    const clone = vi.spyOn(response, "clone");
    await run(response, { attempts: 0 });
    expect(clone).not.toHaveBeenCalled();
    const other = new Response("error", { status: 503 });
    const otherClone = vi.spyOn(other, "clone");
    await run(other);
    expect(otherClone).not.toHaveBeenCalled();
  });
  it("fails open on oversized body evidence", async () => {
    await run(limited("x".repeat(65537)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("fails open on a stalled clone and preserves the original", async () => {
    const response = limited("original");
    vi.spyOn(response, "clone").mockReturnValue(new Response(new ReadableStream({ start() {} })));
    const out = await run(response);
    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 5000);
  it("propagates caller abort during inspection", async () => {
    const controller = new AbortController();
    const response = limited("original");
    vi.spyOn(response, "clone").mockReturnValue(new Response(new ReadableStream({ start() {} })));
    const ex = new BaseExecutor("test", { baseUrl: "https://example.test", retry: { 429: { attempts: 1, delayMs: 1 } } });
    fetchMock.mockResolvedValue(response);
    const pending = ex.execute({ model: "m", body: {}, stream: false, credentials: {}, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe("original");
  });

});
