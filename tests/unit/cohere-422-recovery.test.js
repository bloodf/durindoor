import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
import { BaseExecutor } from "../../open-sse/executors/base.js";

beforeEach(() => fetchMock.mockReset());

describe("Cohere 422 handling", () => {
  it("returns the upstream rejection without a redundant retry", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Use 'high' instead" } }), { status: 422 }));
    const executor = new BaseExecutor("cohere", { baseUrl: "https://mock.invalid/v1/chat/completions", retry: {} });
    const result = await executor.execute({ model: "test", body: { reasoning_effort: "medium", messages: [] }, stream: false, credentials: { apiKey: "test" } });
    expect(result.response.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
