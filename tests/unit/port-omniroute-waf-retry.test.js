import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => fetchMock(...args) }));
const { BaseExecutor } = await import("../../open-sse/executors/base.js");

afterEach(() => { vi.restoreAllMocks(); fetchMock.mockReset(); });

describe("OmniRoute 6f0ffcec #21053 AgentRouter WAF retry", () => {
  it.each([["agentrouter", 3], ["other", 1]])("retries content_blocked only for %s", async (provider, count) => {
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn, ms, ...args) => realSetTimeout(fn, ms >= 700 ? 0 : ms, ...args));
    fetchMock.mockImplementation(async () => new Response('{"error":{"code":"content_blocked"}}', { status: 400 }));
    const executor = new BaseExecutor(provider, { baseUrl: "https://example.test/api" });
    const result = await executor.execute({ model: "m", body: {}, stream: false, credentials: { apiKey: "k" } });
    expect(result.response.status).toBe(400);
    expect(await result.response.text()).toContain("content_blocked");
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });
});
