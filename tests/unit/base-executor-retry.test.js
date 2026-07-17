// Locks BaseExecutor.execute retry/fallback behavior (docs 04 GAP #1, docs 11 §7).
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the network layer so we can script upstream responses.
const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");

function res(status) {
  return { status, headers: { get: () => "" } };
}

function makeExec(config) {
  const ex = new BaseExecutor("test", config);
  // make headers trivial; credentials empty
  return ex;
}

const creds = { apiKey: "k" };

beforeEach(() => fetchMock.mockReset());

describe("BaseExecutor.execute — retry by status (config-driven)", () => {
  it("retries 502 `attempts` times then succeeds", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 3, delayMs: 0 } } });
    fetchMock
      .mockResolvedValueOnce(res(502))
      .mockResolvedValueOnce(res(502))
      .mockResolvedValueOnce(res(200));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops after exhausting 502 attempts on a single url and throws", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 2, delayMs: 0 } } });
    fetchMock.mockResolvedValue(res(502));
    // single url: 1 initial + 2 retries = 3 calls, then returns the 502 response (no fallback url)
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stamps every real dispatch and returns the final retry attempt", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 1, delayMs: 0 } } });
    fetchMock.mockResolvedValueOnce(res(502)).mockResolvedValueOnce(res(200));
    const onProviderAttempt = vi.fn().mockReturnValue(1001);
    const out = await ex.execute({
      model: "m",
      body: {},
      stream: false,
      credentials: creds,
      attemptStartedAt: 1000,
      onProviderAttempt,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onProviderAttempt).toHaveBeenCalledOnce();
    expect(out.attemptStartedAt).toBe(1001);
  });

  it("cancels a discarded response body before retrying", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 1, delayMs: 0 } } });
    fetchMock
      .mockResolvedValueOnce({ ...res(502), body: { cancel } })
      .mockResolvedValueOnce(res(200));
    await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("BaseExecutor.execute — baseUrls fallback", () => {
  it("falls over to the next url on 429 (shouldRetry)", async () => {
    const ex = makeExec({ baseUrls: ["https://a/api", "https://b/api"], retry: { 429: { attempts: 0 } } });
    fetchMock
      .mockResolvedValueOnce(res(429)) // url[0] → fallback
      .mockResolvedValueOnce(res(200)); // url[1] ok
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(out.url).toBe("https://b/api");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels the discarded response before switching fallback urls", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const ex = makeExec({ baseUrls: ["https://a/api", "https://b/api"], retry: { 429: { attempts: 0 } } });
    fetchMock
      .mockResolvedValueOnce({ ...res(429), body: { cancel } })
      .mockResolvedValueOnce(res(200));
    await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("BaseExecutor.execute — network error retry/fallback", () => {
  it("maps network exception to 502 retry config", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 1, delayMs: 0 } } });
    fetchMock
      .mockImplementationOnce(async () => { throw new Error("ECONNRESET"); })
      .mockResolvedValueOnce(res(200));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the only url fails with network error and no retries left", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 0 } } });
    // mockImplementationOnce (not persistent) avoids vitest flagging a reused rejection.
    fetchMock.mockImplementationOnce(async () => { throw new Error("boom"); });
    let thrown = null;
    try {
      await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.message).toBe("boom");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("BaseExecutor.execute — cancellation", () => {
  it("does not dispatch a pre-aborted request", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 2, delayMs: 1000 } } });
    const controller = new AbortController();
    controller.abort();
    await expect(ex.execute({
      model: "m", body: {}, stream: false, credentials: creds, signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts a pending retry delay and never performs the later fetch", async () => {
    vi.useFakeTimers();
    try {
      const ex = makeExec({ baseUrl: "https://x/api", retry: { 502: { attempts: 1, delayMs: 30_000 } } });
      const controller = new AbortController();
      fetchMock.mockResolvedValueOnce(res(502));
      const pending = ex.execute({
        model: "m", body: {}, stream: false, credentials: creds, signal: controller.signal,
      });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await vi.runAllTimersAsync();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BaseExecutor.execute — Anthropic summarized thinking headers", () => {
  it("removes redact-thinking beta when summarized thinking is requested", async () => {
    const ex = makeExec({
      baseUrl: "https://x/api",
      headers: {
        "Anthropic-Beta": "claude-code-20250219,redact-thinking-2026-02-12,effort-2025-11-24",
      },
    });
    fetchMock.mockResolvedValueOnce(res(200));

    await ex.execute({
      model: "m",
      body: { thinking: { type: "adaptive", display: "summarized" } },
      stream: false,
      credentials: creds,
    });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["Anthropic-Beta"]).toBe("claude-code-20250219,effort-2025-11-24");
  });

  it("keeps redact-thinking beta when summarized thinking is not requested", async () => {
    const ex = makeExec({
      baseUrl: "https://x/api",
      headers: {
        "Anthropic-Beta": "claude-code-20250219,redact-thinking-2026-02-12,effort-2025-11-24",
      },
    });
    fetchMock.mockResolvedValueOnce(res(200));

    await ex.execute({
      model: "m",
      body: { thinking: { type: "adaptive" } },
      stream: false,
      credentials: creds,
    });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["Anthropic-Beta"]).toContain("redact-thinking-2026-02-12");
  });
});

describe("BaseExecutor.execute — computeRetryDelay hook veto", () => {
  it("only invokes computeRetryDelay when status has retry config", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 503: { attempts: 1, delayMs: 0 } } });
    ex.computeRetryDelay = vi.fn().mockResolvedValue(0);
    fetchMock.mockResolvedValueOnce(res(500));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    expect(out.response.status).toBe(500);
    expect(ex.computeRetryDelay).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hook returning false skips retry (uses fallback path)", async () => {
    const ex = makeExec({ baseUrl: "https://x/api", retry: { 429: { attempts: 5, delayMs: 0 } } });
    ex.computeRetryDelay = vi.fn().mockResolvedValue(false);
    fetchMock.mockResolvedValueOnce(res(429));
    const out = await ex.execute({ model: "m", body: {}, stream: false, credentials: creds });
    // hook vetoes retry → no fallback url → returns the 429 response as-is
    expect(out.response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("BaseExecutor.execute — reactive field strip retry", () => {
  it("strips top-level context_management and retries once when a strict gateway names it in a 400", async () => {
    const ex = makeExec({ baseUrl: "https://x/api" });
    fetchMock
      .mockResolvedValueOnce(new Response("context_management: Extra inputs are not permitted", { status: 400 }))
      .mockResolvedValueOnce(res(200));

    const out = await ex.execute({
      model: "m",
      body: {
        messages: [{ role: "user", content: "hi" }],
        context_management: { edits: [] },
      },
      stream: false,
      credentials: creds,
    });

    expect(out.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).context_management).toBeDefined();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).context_management).toBeUndefined();
    expect(out.transformedBody.context_management).toBeUndefined();
  });

  it("bounds and aborts a stalled 400 field-probe body", async () => {
    const ex = makeExec({ baseUrl: "https://x/api" });
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      pull: () => new Promise(() => {}),
    }), { status: 400 }));
    const pending = ex.execute({
      model: "m",
      body: { context_management: { edits: [] } },
      stream: false,
      credentials: creds,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry from an oversized 400 field-probe body", async () => {
    const ex = makeExec({ baseUrl: "https://x/api" });
    fetchMock.mockResolvedValueOnce(new Response(
      `context_management ${"x".repeat(70 * 1024)}`,
      { status: 400 },
    ));
    const out = await ex.execute({
      model: "m",
      body: { context_management: { edits: [] } },
      stream: false,
      credentials: creds,
    });
    expect(out.response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
