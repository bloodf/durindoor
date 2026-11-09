import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquirePayloadAdmission,
  estimatePayloadBytes,
  getPayloadAdmissionStats,
  releaseAdmissionWhenDone,
  resetPayloadAdmission,
  ADMISSION_REJECTION_REASONS,
  PayloadAdmissionError,
} from "../../open-sse/services/payloadAdmission.js";
import { acquireMany, _resetGates, getGateStats } from "../../open-sse/services/concurrencyGate.js";

beforeEach(() => {
  resetPayloadAdmission();
  _resetGates();
});

afterEach(() => {
  resetPayloadAdmission();
  _resetGates();
});

describe("estimatePayloadBytes", () => {
  it("handles null, undefined, strings, numbers, and JSON objects", () => {
    expect(estimatePayloadBytes(null)).toBe(0);
    expect(estimatePayloadBytes(undefined)).toBe(0);
    expect(estimatePayloadBytes(1024)).toBe(1024);
    expect(estimatePayloadBytes("hello world")).toBe(11);
    expect(estimatePayloadBytes(Buffer.from("abc"))).toBe(3);
    expect(estimatePayloadBytes({ model: "gpt-4o", stream: true })).toBeGreaterThan(10);
  });
});

describe("acquirePayloadAdmission bounds and lifecycle", () => {
  it("admits within limits and releases exactly once", async () => {
    const lease = await acquirePayloadAdmission({
      body: "test request",
      stream: true,
      limits: { maxPayloadBytes: 1000, maxHeldStreams: 5 },
    });

    const stats1 = getPayloadAdmissionStats();
    expect(stats1.activeBytes).toBe(12);
    expect(stats1.activeStreams).toBe(1);
    expect(stats1.activeRequests).toBe(1);
    expect(lease.released).toBe(false);

    lease.release();
    expect(lease.released).toBe(true);

    const stats2 = getPayloadAdmissionStats();
    expect(stats2.activeBytes).toBe(0);
    expect(stats2.activeStreams).toBe(0);
    expect(stats2.activeRequests).toBe(0);

    // Idempotency: multiple releases do not double-decrement
    lease.release();
    const stats3 = getPayloadAdmissionStats();
    expect(stats3.activeBytes).toBe(0);
  });

  it("rejects immediately with 413 when single payload exceeds single limit", async () => {
    await expect(
      acquirePayloadAdmission({
        payloadBytes: 500,
        limits: { maxPayloadBytes: 1000, maxSinglePayloadBytes: 200 },
      })
    ).rejects.toThrow(PayloadAdmissionError);

    try {
      await acquirePayloadAdmission({
        payloadBytes: 500,
        limits: { maxPayloadBytes: 1000, maxSinglePayloadBytes: 200 },
      });
    } catch (e) {
      expect(e.reason).toBe(ADMISSION_REJECTION_REASONS.PAYLOAD_TOO_LARGE);
      expect(e.status).toBe(413);
    }
  });

  it("rejects immediately with 503 when queue depth is saturated (pressure shedding)", async () => {
    // Fill active capacity
    const lease = await acquirePayloadAdmission({
      payloadBytes: 100,
      limits: { maxPayloadBytes: 100, maxQueueDepth: 1 },
    });

    // Enqueue 1 waiter (reaches maxQueueDepth: 1)
    const waiter1 = acquirePayloadAdmission({
      payloadBytes: 50,
      timeoutMs: 1000,
      limits: { maxPayloadBytes: 100, maxQueueDepth: 1 },
    });
    waiter1.catch(() => {});

    // Second waiter should be shed immediately
    await expect(
      acquirePayloadAdmission({
        payloadBytes: 50,
        timeoutMs: 1000,
        limits: { maxPayloadBytes: 100, maxQueueDepth: 1 },
      })
    ).rejects.toThrow(PayloadAdmissionError);

    try {
      await acquirePayloadAdmission({
        payloadBytes: 50,
        timeoutMs: 1000,
        limits: { maxPayloadBytes: 100, maxQueueDepth: 1 },
      });
    } catch (e) {
      expect(e.reason).toBe(ADMISSION_REJECTION_REASONS.QUEUE_FULL);
      expect(e.status).toBe(503);
    }

    lease.release();
    const w1Lease = await waiter1;
    w1Lease.release();
  });

  it("times out with 503 when capacity is not freed within timeout", async () => {
    const lease = await acquirePayloadAdmission({
      payloadBytes: 100,
      limits: { maxPayloadBytes: 100 },
    });

    await expect(
      acquirePayloadAdmission({
        payloadBytes: 50,
        timeoutMs: 20,
        limits: { maxPayloadBytes: 100 },
      })
    ).rejects.toThrow(PayloadAdmissionError);

    try {
      await acquirePayloadAdmission({
        payloadBytes: 50,
        timeoutMs: 20,
        limits: { maxPayloadBytes: 100 },
      });
    } catch (e) {
      expect(e.reason).toBe(ADMISSION_REJECTION_REASONS.TIMEOUT);
      expect(e.status).toBe(503);
    }

    lease.release();
  });

  it("handles abort while queued and while pending", async () => {
    const controller = new AbortController();
    const lease1 = await acquirePayloadAdmission({
      payloadBytes: 100,
      limits: { maxPayloadBytes: 100 },
    });

    // Waiter aborts while in queue
    const waiterPromise = acquirePayloadAdmission({
      payloadBytes: 50,
      timeoutMs: 5000,
      signal: controller.signal,
      limits: { maxPayloadBytes: 100 },
    });
    controller.abort();

    await expect(waiterPromise).rejects.toThrow();
    expect(getPayloadAdmissionStats().queuedRequests).toBe(0);

    // Pending cancellation: lease auto-releases when its signal aborts
    const pendingController = new AbortController();
    const lease2 = await acquirePayloadAdmission({
      payloadBytes: 10,
      signal: pendingController.signal,
      limits: { maxPayloadBytes: 1000 },
    });
    expect(lease2.released).toBe(false);
    pendingController.abort();
    expect(lease2.released).toBe(true);

    lease1.release();
  });
});

describe("releaseAdmissionWhenDone response wrapper", () => {
  it("releases lease immediately on non-streaming or early error responses", async () => {
    const lease = await acquirePayloadAdmission({ payloadBytes: 50 });
    const response = new Response("Bad Request", { status: 400 });

    const wrapped = await releaseAdmissionWhenDone(response, lease);
    expect(wrapped.status).toBe(400);
    expect(lease.released).toBe(true);
  });

  it("releases lease immediately when client aborts while handler is still pending (issue #14566)", async () => {
    const controller = new AbortController();
    const lease = await acquirePayloadAdmission({ payloadBytes: 50 });

    let resolveHandler;
    const pendingHandler = new Promise((resolve) => {
      resolveHandler = resolve;
    });

    const admissionPromise = releaseAdmissionWhenDone(pendingHandler, lease, {
      signal: controller.signal,
    });

    expect(lease.released).toBe(false);
    // Client disconnects while upstream provider is still processing
    controller.abort();
    expect(lease.released).toBe(true);

    resolveHandler(new Response("Late response", { status: 200 }));
    const result = await admissionPromise;
    expect(result.status).toBe(200);
  });

  it("releases lease on stream completion or cancel", async () => {
    const lease = await acquirePayloadAdmission({ payloadBytes: 50, stream: true });
    expect(getPayloadAdmissionStats().activeStreams).toBe(1);

    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: 1\n\n"));
        c.close();
      },
    });
    const sseResponse = new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const wrapped = await releaseAdmissionWhenDone(sseResponse, lease);
    expect(lease.released).toBe(false);

    // Consume the stream
    const reader = wrapped.body.getReader();
    while (!(await reader.read()).done) {}

    expect(lease.released).toBe(true);
    expect(getPayloadAdmissionStats().activeStreams).toBe(0);
  });
});

describe("concurrencyGate acquireMany integration with payload admission", () => {
  it("acquires and releases both concurrency slots and payload lease together", async () => {
    const release = await acquireMany(
      [{ key: "openai", limit: 2 }],
      5000,
      null,
      { payloadBytes: 100, stream: true }
    );

    expect(getGateStats()).toEqual({ openai: { current: 1, queued: 0 } });
    expect(getPayloadAdmissionStats().activeBytes).toBe(100);
    expect(getPayloadAdmissionStats().activeStreams).toBe(1);

    release();

    expect(getGateStats()).toEqual({});
    expect(getPayloadAdmissionStats().activeBytes).toBe(0);
    expect(getPayloadAdmissionStats().activeStreams).toBe(0);
  });

  it("rolls back payload lease if a subsequent concurrency gate tier fails", async () => {
    // Fill provider concurrency gate
    const fillRelease = await acquireMany([{ key: "openai", limit: 1 }]);

    // Attempt acquireMany with payload options where provider tier will timeout
    await expect(
      acquireMany(
        [{ key: "openai", limit: 1 }],
        20,
        null,
        { payloadBytes: 250, stream: false }
      )
    ).rejects.toThrow();

    // Verify payload bytes were rolled back
    expect(getPayloadAdmissionStats().activeBytes).toBe(0);

    fillRelease();
  });
});
