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

    // TTL is 30 minutes (matches the dashboard's slowed Claude cadence).
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) });
    const result = await getClaudeUsage("token");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ message: "Claude authentication expired (401). Re-authorize or refresh the connection." });
  });

  it("serves cache through the TTL window without new upstream calls", async () => {
    fetchMock.mockResolvedValueOnce(quotaResponse(10));
    const { getClaudeUsage } = await load();
    await getClaudeUsage("token");

    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    const result = await getClaudeUsage("token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.quotas["session (5h)"].used).toBe(10);
  });

  it("escalates the 429 cooldown per consecutive strike and resets on success", async () => {
    const rateLimited = { ok: false, status: 429, json: async () => ({ error: "rate_limited" }), text: async () => "{}" };
    const { getClaudeUsage } = await load();

    // Strike 1 → 15-minute cooldown: one upstream hit, then calls are served
    // the rate-limit message without retrying.
    fetchMock.mockResolvedValueOnce(rateLimited);
    const first = await getClaudeUsage("token");
    expect(first).toEqual({ message: "Rate limited, try again later." });
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000);
    await getClaudeUsage("token");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Cooldown expired → retried; strike 2 → 30-minute cooldown.
    await vi.advanceTimersByTimeAsync(60 * 1000 + 1);
    fetchMock.mockResolvedValueOnce(rateLimited);
    await getClaudeUsage("token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    await getClaudeUsage("token");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Strike 3 after expiry → 60-minute cooldown.
    await vi.advanceTimersByTimeAsync(60 * 1000 + 1);
    fetchMock.mockResolvedValueOnce(rateLimited);
    await getClaudeUsage("token");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(59 * 60 * 1000);
    await getClaudeUsage("token");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Success after the cooldown resets the strikes: a later 429 returns to
    // the 15-minute base cooldown.
    await vi.advanceTimersByTimeAsync(60 * 1000 + 1);
    fetchMock.mockResolvedValueOnce(quotaResponse(50));
    const recovered = await getClaudeUsage("token");
    expect(recovered.quotas["session (5h)"].used).toBe(50);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    fetchMock.mockResolvedValueOnce(rateLimited);
    await getClaudeUsage("token");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000);
    await getClaudeUsage("token");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("serves the stale cached quota during a 429 cooldown instead of an error", async () => {
    fetchMock.mockResolvedValueOnce(quotaResponse(10));
    const { getClaudeUsage } = await load();
    await getClaudeUsage("token");

    // Force a refresh inside the TTL window; upstream answers 429.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: "rate_limited" }), text: async () => "{}" });
    const result = await getClaudeUsage("token", null, "oauth", { force: true });

    expect(result.stale).toBe(true);
    expect(result.rateLimited).toBe(true);
    expect(result.quotas["session (5h)"].used).toBe(10);
    expect(result.staleReason).toContain("Rate limited");

    // The cooldown also covers forced refreshes — no new upstream call.
    const again = await getClaudeUsage("token", null, "oauth", { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(again.stale).toBe(true);
  });
});
