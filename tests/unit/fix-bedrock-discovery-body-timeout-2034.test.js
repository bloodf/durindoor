// #2034: Bedrock discovery runs two timers for one deadline, the discovery-wide one and the
// bounded body reader's. A body timeout must be reported as `timeout`/504 whichever fires
// first. Timers and Date are faked, so each order is forced, not raced. The real SDK runs;
// identities and the transport are synthetic and nothing leaves the process.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { discoverBedrockModels, BedrockDiscoveryError } = await import(
  "../../open-sse/services/providerParity/native-bedrock-discovery/index.js"
);

const TIMEOUT_MS = 50;
// Date moves this far (no timer fires) before the reader computes `end - Date.now()`.
const SKEW_MS = 10;
const ACCOUNT = {
  apiKey: "synthetic-secret-body-timeout",
  providerSpecificData: { accessKeyId: "AKIASYNTHETICBODY001", region: "us-west-2" },
};
const TIMEOUT = {
  kind: "timeout",
  status: 504,
  code: "TimeoutError",
  message: "Bedrock model discovery timed out",
};
const ABORTED = { kind: "aborted", status: 499, code: "AbortError" };

// `readerMs` is the delay the reader's timer gets; `overallFirst` is whether the
// discovery-wide deadline has already aborted the request when the body is cancelled.
const ORDERS = [
  { order: "body reader deadline first", skew: SKEW_MS, readerMs: TIMEOUT_MS - SKEW_MS, overallFirst: false },
  { order: "discovery-wide deadline first", skew: -SKEW_MS, readerMs: TIMEOUT_MS + SKEW_MS, overallFirst: true },
  { order: "both due at the same instant", skew: 0, readerMs: TIMEOUT_MS, overallFirst: true },
];

const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

/** A body that never produces a byte, with its reads and cancellations counted. */
function stalledBody({ status = 200, skew = 0, signal = () => null, onCancel = () => {} } = {}) {
  const seen = { reads: 0, cancels: 0, abortedAtCancel: null, stream: null, controller: null };
  let started;
  seen.reading = new Promise((resolve) => (started = resolve));
  seen.respond = () => {
    seen.stream = new ReadableStream(
      {
        start(controller) {
          seen.controller = controller;
        },
        pull() {
          seen.reads += 1;
          started();
        },
        cancel() {
          seen.cancels += 1;
          seen.abortedAtCancel = signal()?.aborted ?? null;
          onCancel();
        },
      },
      // No read-ahead: `pull` runs only once the reader asks, after it armed its timer.
      { highWaterMark: 0 }
    );
    vi.setSystemTime(Date.now() + skew);
    return new Response(seen.stream, { status, headers: { "content-type": "application/json" } });
  };
  return seen;
}

/** Start discovery over `answers` (one per expected request); `outcome` never rejects. */
function discover(answers, options = {}) {
  const calls = [];
  const transport = async (url, init) => {
    calls.push({ url: new URL(url), signal: init.signal });
    const answer = answers[calls.length - 1];
    if (!answer) throw new Error("unexpected extra request");
    return answer();
  };
  const outcome = discoverBedrockModels({
    credentials: ACCOUNT,
    timeoutMs: TIMEOUT_MS,
    fetch: transport,
    ...options,
  }).then(
    (result) => ({ result, error: null }),
    (error) => ({ result: null, error })
  );
  return { calls, outcome };
}

/** Wait for the pending body read, then fire exactly the earlier of the two timers. */
async function expireBody(body, readerMs) {
  await body.reading;
  expect(vi.getTimerCount()).toBe(2);
  await vi.advanceTimersByTimeAsync(Math.min(readerMs, TIMEOUT_MS) - 1);
  expect(body.cancels).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
}

/** One read, one cancel, a released lock, no timer left, and no further request. */
async function expectBounded(body, calls, requests) {
  expect(body.reads).toBe(1);
  expect(body.cancels).toBe(1);
  expect(body.stream.locked).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls).toHaveLength(requests);
  expect(body.reads).toBe(1);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: new Date("2026-11-28T12:00:00Z") });
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(ORDERS)("Bedrock discovery body timeout: $order", ({ skew, readerMs, overallFirst }) => {
  it("reports a stalled foundation model body as timeout/504", async () => {
    const run = {};
    const body = stalledBody({ skew, signal: () => run.calls[0].signal });
    Object.assign(run, discover([body.respond]));
    await expireBody(body, readerMs);

    const { error } = await run.outcome;
    expect(error).toBeInstanceOf(BedrockDiscoveryError);
    expect(error).toMatchObject(TIMEOUT);
    expect(error.cause).toBeUndefined();
    expect(body.abortedAtCancel).toBe(overallFirst);
    await expectBounded(body, run.calls, 1);
  });

  it("fails on a stalled inference profile body instead of returning a partial list", async () => {
    const run = {};
    const body = stalledBody({ skew, signal: () => run.calls[1].signal });
    Object.assign(run, discover([() => json({ modelSummaries: [] }), body.respond]));
    await expireBody(body, readerMs);

    const { result, error } = await run.outcome;
    expect(result).toBeNull();
    expect(error).toMatchObject(TIMEOUT);
    expect(body.abortedAtCancel).toBe(overallFirst);
    await expectBounded(body, run.calls, 2);
  });

  // The status line is not a verdict while the SDK still lacks the error body.
  it.each([401, 403, 429, 500])("reports a stalled HTTP %i body as timeout/504", async (status) => {
    const body = stalledBody({ status, skew });
    const run = discover([body.respond]);
    await expireBody(body, readerMs);

    expect((await run.outcome).error).toMatchObject(TIMEOUT);
    await expectBounded(body, run.calls, 1);
  });
});

describe("Bedrock discovery body timeout: neighbouring failures", () => {
  it("maps an explicit reader TimeoutError as timeout/504 while neither timer has fired", async () => {
    const body = stalledBody();
    const run = discover([body.respond]);
    await body.reading;
    body.controller.error(Object.assign(new Error("synthetic body detail"), { name: "TimeoutError" }));

    const { error } = await run.outcome;
    expect(error).toMatchObject(TIMEOUT);
    expect(error.message).not.toContain("synthetic");
    expect(run.calls[0].signal.reason?.name).not.toBe("TimeoutError");
    expect(vi.getTimerCount()).toBe(0);
    expect(run.calls).toHaveLength(1);
  });

  it("keeps a caller abort during the body read as aborted/499", async () => {
    const caller = new AbortController();
    const body = stalledBody();
    const run = discover([body.respond], { signal: caller.signal });
    await body.reading;
    caller.abort();

    expect((await run.outcome).error).toMatchObject(ABORTED);
    await expectBounded(body, run.calls, 1);
  });

  it("keeps aborted/499 when the caller aborts as the reader deadline cancels the body", async () => {
    const caller = new AbortController();
    const body = stalledBody({ skew: SKEW_MS, onCancel: () => caller.abort() });
    const run = discover([body.respond], { signal: caller.signal });
    await expireBody(body, TIMEOUT_MS - SKEW_MS);

    expect((await run.outcome).error).toMatchObject(ABORTED);
    await expectBounded(body, run.calls, 1);
  });

  it("keeps a body stream transport failure as unavailable/502", async () => {
    const body = stalledBody();
    const run = discover([body.respond]);
    await body.reading;
    body.controller.error(Object.assign(new Error("synthetic socket reset"), { code: "ECONNRESET" }));

    expect((await run.outcome).error).toMatchObject({ kind: "unavailable", status: 502, code: "TransportUnavailable" });
    expect(vi.getTimerCount()).toBe(0);
    expect(run.calls).toHaveLength(1);
  });

  // Only the body read is remapped: a transport's own TimeoutError before any response is unchanged.
  it("keeps a transport TimeoutError raised before any response as unavailable/502", async () => {
    const run = discover([
      () => {
        throw Object.assign(new Error("synthetic connect timeout"), { name: "TimeoutError" });
      },
    ]);

    expect((await run.outcome).error).toMatchObject({ kind: "unavailable", status: 502, code: "TransportUnavailable" });
    expect(vi.getTimerCount()).toBe(0);
    expect(run.calls).toHaveLength(1);
  });
});
