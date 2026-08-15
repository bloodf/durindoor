import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const quotaResponse = (utilization = 10) => ({
  ok: true,
  status: 200,
  json: async () => ({ five_hour: { utilization, resets_at: "2026-08-15T12:00:00Z" } }),
  text: async () => "{}",
});

const load = () => import("../../open-sse/services/usage/claude.js");

describe("Claude usage cache", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T00:00:00Z"));
    fetchMock.mockReset();
    (await load()).__clearOAuthQuotaCacheForTesting();
  });

  afterEach(() => vi.useRealTimers());

  it("reuses a valid cache entry, bypasses it on force, and coalesces forced callers", async () => {
    fetchMock.mockResolvedValueOnce(quotaResponse(10));
    const { getClaudeUsage } = await load();

    expect((await getClaudeUsage("token")).quotas["session (5h)"].used).toBe(10);
    expect((await getClaudeUsage("token")).quotas["session (5h)"].used).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    let resolveRefresh;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    const first = getClaudeUsage("token", null, "oauth", { force: true });
    const second = getClaudeUsage("token", null, "oauth", { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveRefresh(quotaResponse(20));
    expect((await first).quotas["session (5h)"].used).toBe(20);
    expect(await second).toEqual(await first);
  });

  it("never serves an expired cache entry after TTL or masks hard provider failures", async () => {
    fetchMock.mockResolvedValueOnce(quotaResponse(10));
    const { getClaudeUsage } = await load();
    await getClaudeUsage("token");

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) });
    const result = await getClaudeUsage("token");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ message: "Claude authentication expired (401). Re-authorize or refresh the connection." });
  });
});
