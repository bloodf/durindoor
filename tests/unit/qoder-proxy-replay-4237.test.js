/**
 * #4237 port: a failed proxy request may already have reached Qoder before
 * proxyAwareFetch reports a transport error. Falling back to a direct
 * connection would replay the same COSY-signed body (same requestId) and
 * Qoder returns 403/code 103 "Duplicate request". QoderExecutor must force
 * proxyOptions.strictProxy so proxyAwareFetch fails hard instead of retrying
 * direct — the caller re-signs and retries through execute() instead.
 */
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

function request(overrides = {}) {
  return {
    model: "qoder/auto",
    body: { messages: [{ role: "user", content: "hello" }] },
    stream: true,
    credentials: {
      accessToken: "dt-token",
      providerSpecificData: { userId: "user-1", machineId: "machine-1" },
    },
    ...overrides,
  };
}

describe("QoderExecutor proxy replay prevention (#4237)", () => {
  beforeEach(() => fetchMock.mockReset());

  it("forces strictProxy on the signed inference fetch", async () => {
    fetchMock.mockResolvedValue(new Response('data: {"statusCodeValue":200,"body":"[DONE]"}\n\n'));
    const executor = new QoderExecutor();
    executor.config = { timeoutMs: 50 };

    const result = await executor.execute(request());
    await result.response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][2]).toMatchObject({ strictProxy: true });
  });

  it("preserves a caller-supplied proxyOptions field alongside strictProxy", async () => {
    fetchMock.mockResolvedValue(new Response('data: {"statusCodeValue":200,"body":"[DONE]"}\n\n'));
    const executor = new QoderExecutor();
    executor.config = { timeoutMs: 50 };

    const result = await executor.execute(request({ proxyOptions: { proxyUrl: "http://proxy.test:3128" } }));
    await result.response.text();

    expect(fetchMock.mock.calls[0][2]).toEqual({ proxyUrl: "http://proxy.test:3128", strictProxy: true });
  });
});
