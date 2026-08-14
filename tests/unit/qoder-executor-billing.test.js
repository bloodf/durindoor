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
});
