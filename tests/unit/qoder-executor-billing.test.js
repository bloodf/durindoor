import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

vi.mock("../../open-sse/services/qoderModels.js", () => ({
  getQoderModelConfig: vi.fn().mockResolvedValue({
    key: "auto",
    max_output_tokens: 1024,
    is_reasoning: false,
  }),
  resolveQoderModels: vi.fn(),
}));

const { QoderExecutor } = await import("../../open-sse/executors/qoder.js");
const { __test__ } = await import("../../open-sse/executors/qoder.js");

function billingResponse() {
  const body = JSON.stringify({ code: "112", message: "quota exhausted" });
  return new Response(`data: ${JSON.stringify({ statusCodeValue: 403, body })}\n\n`);
}

describe("QoderExecutor billing stream fallback", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns a synthetic 403 from a billing first frame", async () => {
    fetchMock.mockResolvedValue(billingResponse());
    const executor = new QoderExecutor();
    executor.config = { timeoutMs: 50 };

    const result = await executor.execute({
      model: "qoder/auto",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: true,
      credentials: {
        accessToken: "dt-token",
        providerSpecificData: { userId: "user-1", machineId: "machine-1" },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(403);
    await expect(result.response.json()).resolves.toEqual({
      error: { message: JSON.stringify({ code: "112", message: "quota exhausted" }), code: 403 },
    });
  });

  it("passes configured timeoutMs through to the peek, not the silent 60s default", async () => {
    fetchMock.mockImplementation(async () => new Response(new ReadableStream({ start() {} })));

    const executor = new QoderExecutor();
    executor.config = { timeoutMs: 1 };
    const start = Date.now();

    // A configured 1ms timeout must reject almost immediately with the
    // wrapper's own timeout error. If the executor silently fell back to
    // FETCH_CONNECT_TIMEOUT_MS (60s), this call would still be pending when
    // the assertion below runs.
    await expect(
      executor.execute({
        model: "qoder/auto",
        body: { messages: [{ role: "user", content: "hello" }] },
        stream: true,
        credentials: {
          accessToken: "dt-token",
          providerSpecificData: { userId: "user-1", machineId: "machine-1" },
        },
      }),
    ).rejects.toThrow("qoder stream-start timeout");

    expect(Date.now() - start).toBeLessThan(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Qoder billing status-gate control", () => {
  const { wrapQoderSSE } = __test__;

  function envelope(statusCodeValue, body) {
    return `data: ${JSON.stringify({ statusCodeValue, body })}\n\n`;
  }

  function responseFromChunks(chunks) {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }));
  }

  it.each([
    [JSON.stringify({ code: "112" }), "top-level code 112"],
    [JSON.stringify({ code: "10605" }), "top-level code 10605"],
    [JSON.stringify({ pricingUrl: "https://qoder.sh/pricing" }), "top-level pricingUrl"],
  ])(
    "passes HTTP 200 envelopes with billing-shaped bodies as a normal 200 stream: %s",
    async (body) => {
      const wrapped = await wrapQoderSSE(responseFromChunks([envelope(200, body)]), "qoder/auto");
      expect(wrapped.status).toBe(200);
      const text = await wrapped.text();
      expect(text).toContain(`data: ${body}\n\n`);
    },
  );
});
