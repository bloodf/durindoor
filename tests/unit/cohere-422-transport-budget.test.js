// Locks the Cohere 422 recovery transport budget and the optional-probe
// contract at the BaseExecutor seam (Refs #1073).
//
// The recovery re-dispatches on the SAME base URL, so it is a transport attempt
// like any other: a configured `maxTransportAttempts` ceiling has to be enforced
// BEFORE it runs, or a one-attempt request silently becomes a two-attempt one.
// The error-body read that drives the recovery is optional: a body that cannot
// be read is a non-match, and the original HTTP response plus its status are
// preserved instead of the read failure surfacing as a transport error.
//
// Synthetic responses and mocks only: no live provider, no network, no
// credentials.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
import { BaseExecutor } from "../../open-sse/executors/base.js";

beforeEach(() => fetchMock.mockReset());

// Cohere names its supported tier on a 422. The base executor retries once with
// `reasoning_effort: "high"` when the body carries this wording.
const COHERE_SUGGESTION = "reasoning_effort low is unsupported. Use 'high' instead";

function cohereExecutor(config = {}) {
  return new BaseExecutor("cohere", {
    baseUrl: "https://mock.invalid/v1/chat/completions",
    retry: {},
    ...config,
  });
}

function cohereRequest(overrides = {}) {
  return {
    model: "fixture",
    body: { reasoning_effort: "low", messages: [] },
    stream: false,
    credentials: {},
    ...overrides,
  };
}

// Upstream that never returns headers: settles ONLY when the merged abort
// signal fires (our connect timer). undici rejects with the abort REASON
// object, so error.name stays "Error" — the classification is by reason
// identity, not by name.
function hangingFetch(_url, opts) {
  const signal = opts?.signal;
  if (!signal) throw new Error("proxyAwareFetch called without a signal");
  return new Promise((_resolve, reject) => {
    const onAbort = () => reject(signal.reason || new Error("aborted"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

describe("Cohere 422 recovery — transport attempt budget", () => {
  it("dispatches no second request when the one-attempt ceiling is exhausted", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(COHERE_SUGGESTION, { status: 422 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const { response } = await cohereExecutor().execute(cohereRequest({
      requestPolicy: { maxTransportAttempts: 1 },
    }));

    // The 422 is the answer: the recovery never runs past the ceiling.
    expect(response.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the one-time recovery when the budget still has room", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(COHERE_SUGGESTION, { status: 422 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const { response } = await cohereExecutor().execute(cohereRequest({
      requestPolicy: { maxTransportAttempts: 2 },
    }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).reasoning_effort).toBe("high");
  });

  it("preserves the implicit behavior when no policy is supplied", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(COHERE_SUGGESTION, { status: 422 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    // No requestPolicy → no ceiling → the recovery still runs exactly once.
    const { response } = await cohereExecutor().execute(cohereRequest());

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).reasoning_effort).toBe("high");
  });

  it("spends the recovery against the same budget as the generic retry path", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(COHERE_SUGGESTION, { status: 422 }))
      .mockResolvedValueOnce(new Response("upstream boom", { status: 502 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const { response } = await cohereExecutor({
      retry: { 502: { attempts: 3, delayMs: 0 } },
    }).execute(cohereRequest({ requestPolicy: { maxTransportAttempts: 2 } }));

    // The recovery used the single retry slot the two-attempt ceiling allows,
    // so the 502 it produced has no budget left: 2 dispatches in total.
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not recover an unrelated 422 even when the budget has room", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("some other provider error", { status: 422 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const { response } = await cohereExecutor().execute(cohereRequest({
      requestPolicy: { maxTransportAttempts: 3 },
    }));

    expect(response.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the generic transport retry path untouched without a policy", async () => {
    fetchMock.mockImplementation(async () => new Response("boom", { status: 502 }));

    const { response } = await cohereExecutor({
      retry: { 502: { attempts: 2, delayMs: 0 } },
    }).execute(cohereRequest({ body: { messages: [] } }));

    // Config-driven attempts only: 1 initial + 2 retries.
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("Cohere 422 recovery — optional probe", () => {
  it("preserves the original 422 when the optional body probe cannot be read", async () => {
    fetchMock.mockImplementationOnce(async () => {
      const body = new ReadableStream({
        pull(controller) { controller.error(new Error("fixture body read failure")); },
      });
      return new Response(body, { status: 422 });
    });

    const { response } = await cohereExecutor().execute(cohereRequest({
      body: { reasoning_effort: "medium", messages: [] },
    }));

    // A failed probe is a non-match: the upstream status survives, the read
    // failure never becomes the request outcome, and nothing is re-dispatched.
    expect(response.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a caller abort during the probe instead of downgrading it", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => new Response(
      new ReadableStream({ pull: () => new Promise(() => {}) }),
      { status: 422 },
    ));

    const pending = cohereExecutor().execute(cohereRequest({
      body: { reasoning_effort: "medium", messages: [] },
      signal: controller.signal,
    }));
    setTimeout(() => controller.abort(), 20);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch a pre-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(cohereExecutor().execute(cohereRequest({
      signal: controller.signal,
    }))).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the connect-timeout classification on the recovery dispatch", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(COHERE_SUGGESTION, { status: 422 }))
      .mockImplementationOnce(hangingFetch);

    const error = await cohereExecutor().execute(cohereRequest({
      requestPolicy: { maxTransportAttempts: 2, headerTimeoutMs: 40 },
    })).catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error.errorKind).toBe("connect_timeout");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still fails over to the next base URL on a 429 after the recovery", async () => {
    const executor = new BaseExecutor("cohere", {
      baseUrls: ["https://a.invalid/v1/chat/completions", "https://b.invalid/v1/chat/completions"],
      retry: {},
    });
    fetchMock
      .mockResolvedValueOnce(new Response(COHERE_SUGGESTION, { status: 422 }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const { response, url } = await executor.execute(cohereRequest());

    expect(response.status).toBe(200);
    expect(url).toBe("https://b.invalid/v1/chat/completions");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
