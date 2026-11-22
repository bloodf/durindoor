import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
import { BaseExecutor } from "../../open-sse/executors/base.js";

beforeEach(() => fetchMock.mockReset());

describe("Cohere recovery retirement", () => {
  it("returns the upstream 422 after one dispatch", async () => {
    fetchMock.mockResolvedValueOnce(new Response("reasoning_effort low is unsupported. Use 'high' instead", { status: 422 }));
    const executor = new BaseExecutor("cohere", { baseUrl: "https://mock.invalid/v1/chat/completions", retry: {} });
    const { response } = await executor.execute({
      model: "fixture", body: { reasoning_effort: "low", messages: [] }, stream: false,
      credentials: {}, requestPolicy: { maxTransportAttempts: 2 }
    });
    expect(response.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
