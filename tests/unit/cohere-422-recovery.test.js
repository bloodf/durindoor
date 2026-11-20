import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
import { BaseExecutor } from "../../open-sse/executors/base.js";

beforeEach(() => fetchMock.mockReset());

describe("Cohere 422 reasoning recovery", () => {
  const message = "reasoning_effort 'medium' and 'low' are not supported. Use 'high' instead";
  async function execute(provider, effort, error = message) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: error } }), { status: 422 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const executor = new BaseExecutor(provider, { baseUrl: "https://mock.invalid/v1/chat/completions", retry: {} });
    return executor.execute({ model: "test", body: { reasoning_effort: effort, messages: [] }, stream: false, credentials: { apiKey: "test" } });
  }
  it("retries the specific rejection with high", async () => {
    const result = await execute("cohere", "medium");
    expect(result.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).reasoning_effort).toBe("high");
  });
  it.each([["other", "medium", message], ["cohere", "high", message], ["cohere", "medium", "different error"]])(
    "does not retry unrelated errors (%s, %s)", async (provider, effort, error) => {
      const result = await execute(provider, effort, error);
      expect(result.response.status).toBe(422);
      expect(fetchMock).toHaveBeenCalledOnce();
    });
});
