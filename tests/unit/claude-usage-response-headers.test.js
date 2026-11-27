import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()), proxyAwareFetch: vi.fn()
}));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getClaudeUsage, observeClaudeUsageHeaders, __clearOAuthQuotaCacheForTesting } from "../../open-sse/services/usage/claude.js";

const minute = 60_000;
const headers = (values) => new Headers(Object.fromEntries(Object.entries(values).map(
  ([window, value]) => [`anthropic-ratelimit-unified-${window}-utilization`, String(value)]
)));
const observe = (values, token = "a") => observeClaudeUsageHeaders(token, headers(values));
const read = (token = "a", force = false) => getClaudeUsage(token, null, "oauth", { force });
const endpoint = (body = {}, status = 200) => proxyAwareFetch.mockResolvedValueOnce(Response.json(body, { status }));

describe("Claude response quota observations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T00:00:00Z"));
    vi.resetAllMocks();
    __clearOAuthQuotaCacheForTesting();
  });
  afterEach(() => vi.useRealTimers());

  it("keeps separate Week/Fable values, reset metadata, and omitted windows", async () => {
    endpoint();
    await read();
    observeClaudeUsageHeaders("a", new Headers({
      ...Object.fromEntries(headers({ "5h": 0.12345, "7d": 0.4, "7d_oi": 0.8 })),
      "anthropic-ratelimit-unified-7d_oi-reset": "1795827600"
    }));
    await vi.advanceTimersByTimeAsync(minute);
    observe({ "7d": 0.5 });
    const result = await read();
    expect(result.quotas).toMatchObject({
      "session (5h)": { used: 12.35, remainingPercentage: 87.65 },
      "weekly (7d)": { used: 50 },
      "weekly fable (7d)": { used: 80, resetAt: "2026-11-28T01:00:00.000Z" }
    });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("expires each original window despite newer general observations and cached overlays", async () => {
    endpoint(); await read();
    observe({ "7d_oi": 0.8 });
    await read();
    await vi.advanceTimersByTimeAsync(14 * minute);
    observe({ "7d": 0.3 });
    await vi.advanceTimersByTimeAsync(minute);
    const result = await read();
    expect(result.quotas["weekly fable (7d)"]).toBeUndefined();
    expect(result.quotas["weekly (7d)"].used).toBe(30);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("preserves endpoint model precedence and supplements omitted rows after successful polls", async () => {
    observe({ "7d_oi": 0.8, "7d": 0.9 });
    endpoint({ seven_day: { utilization: 12 } });
    expect((await read()).quotas).toMatchObject({ "weekly (7d)": { used: 12 }, "weekly fable (7d)": { used: 80 } });
    endpoint({ seven_day_overage_included: { utilization: 20 }, limits: [
      { kind: "weekly_scoped", percent: 33, scope: { model: { display_name: "Fable" } } }
    ] });
    expect((await read("a", true)).quotas["weekly fable (7d)"].used).toBe(33);
    await vi.advanceTimersByTimeAsync(minute);
    observe({ "7d_oi": 1, "7d": 0.6 });
    expect((await read()).quotas).toMatchObject({ "weekly (7d)": { used: 60 }, "weekly fable (7d)": { used: 33 } });
    endpoint({ seven_day_overage_included: { utilization: 21 } });
    expect((await read("a", true)).quotas["weekly fable (7d)"].used).toBe(21);
  });

  it("overlays retained cooldown rows without bypassing forced cooldowns", async () => {
    endpoint({ five_hour: { utilization: 10 } }); await read();
    await vi.advanceTimersByTimeAsync(31 * minute);
    observe({ "7d_oi": 0.75 });
    endpoint({}, 429);
    expect(await read()).toMatchObject({ stale: true, rateLimited: true, quotas: { "weekly fable (7d)": { used: 75 } } });
    expect(await read("a", true)).toMatchObject({ rateLimited: true, quotas: { "weekly fable (7d)": { used: 75 } } });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it("exposes usable cold-start observed rows through the ProviderLimits message contract", async () => {
    observe({ "7d_oi": 0.8 });
    endpoint({ message: "private upstream body" }, 429);
    const result = await read();
    // ProviderLimits renders quota.message as an error instead of its quota table.
    expect(result.message).toBeUndefined();
    expect(result).toEqual({ quotas: { "weekly fable (7d)": {
      used: 80, total: 100, remaining: 20, remainingPercentage: 20,
      resetAt: null, unlimited: false
    } } });
    expect(await read("a", true)).toEqual(result);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    // Observations expire independently and do not extend the endpoint cooldown.
    await vi.advanceTimersByTimeAsync(14 * minute);
    observe({ "7d": 0.3 });
    await vi.advanceTimersByTimeAsync(minute);
    endpoint({}, 429);
    expect(await read()).toEqual({ quotas: { "weekly (7d)": {
      used: 30, total: 100, remaining: 70, remainingPercentage: 70,
      resetAt: null, unlimited: false
    } } });
    await vi.advanceTimersByTimeAsync(14 * minute);
    expect(await read("a", true)).toEqual({ message: "Rate limited, try again later." });
    await vi.advanceTimersByTimeAsync(15 * minute);
    expect(await read("a", true)).toEqual({ message: "Rate limited, try again later." });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("keeps the blocking 429 message without usable observations (expired=%s)", async (expired) => {
    if (expired) {
      observe({ "7d_oi": 0.8 });
      await vi.advanceTimersByTimeAsync(15 * minute);
    }
    endpoint({ message: "private upstream body" }, 429);
    expect(await read()).toEqual({ message: "Rate limited, try again later." });
    expect(await read("a", true)).toEqual({ message: "Rate limited, try again later." });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("supports header-only cooldown results but preserves auth and other failures", async () => {
    observe({ "7d_oi": 0.8 }); endpoint({}, 429);
    expect((await read()).quotas["weekly fable (7d)"].used).toBe(80);
    await vi.advanceTimersByTimeAsync(15 * minute);
    observe({ "7d_oi": 0.8 }); endpoint({}, 401);
    expect(await read()).toEqual({ message: "Claude authentication expired (401). Re-authorize or refresh the connection." });
    endpoint({}, 503);
    expect(await read()).toEqual({ message: "Claude usage temporarily unavailable. Try again later." });
  });

  it("overlays transient fallback and joined forced polls without changing cache timing", async () => {
    endpoint({ five_hour: { utilization: 10 } }); await read();
    await vi.advanceTimersByTimeAsync(minute);
    observe({ "5h": 0.4 });
    endpoint({}, 503);
    expect(await read("a", true)).toMatchObject({ stale: true, quotas: { "session (5h)": { used: 40 } } });
    let resolve;
    proxyAwareFetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const first = read("a", true);
    const second = read("a", true);
    observe({ "7d_oi": 0.65 });
    resolve(Response.json({}));
    expect(await first).toMatchObject({ quotas: { "weekly fable (7d)": { used: 65 } } });
    expect(await second).toEqual(await first);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });

  it("overlays OAuth legacy fallback but excludes API-key usage reads", async () => {
    observe({ "7d_oi": 0.8 });
    endpoint({}, 404);
    endpoint({ organization_id: "org", plan: "Legacy" });
    endpoint({});
    expect(await read()).toMatchObject({ plan: "Legacy", quotas: { "weekly fable (7d)": { used: 80 } } });
    endpoint({ organization_id: "org", plan: "Legacy" });
    endpoint({});
    expect((await getClaudeUsage("a", null, "apikey")).quotas).toEqual({});
  });

  it("isolates credentials and rejects invalid values without extending freshness", async () => {
    observe({ "7d_oi": 0.8 });
    endpoint(); expect((await read("b")).quotas).toEqual({});
    endpoint(); await read();
    await vi.advanceTimersByTimeAsync(14 * minute);
    observe({ "7d_oi": "", "7d": "Infinity", "5h": -1 });
    await vi.advanceTimersByTimeAsync(minute);
    expect((await read()).quotas).toEqual({});
  });

  it("bounds observation credentials and does not fabricate omitted windows", async () => {
    observe({ "7d_oi": 0 });
    for (let i = 0; i < 100; i++) observe({ "7d": 0.2 }, `other-${i}`);
    endpoint(); expect((await read()).quotas).toEqual({});
  });

  it.each([200, 429])("observes native OAuth responses before %s classification without consuming bodies", async (status) => {
    proxyAwareFetch.mockResolvedValueOnce(new Response("unchanged", { status, headers: {
      ...Object.fromEntries(headers({ "7d_oi": 0.73 })),
      "anthropic-ratelimit-unified-7d_oi-status": "rejected",
      "anthropic-ratelimit-unified-status": "rejected",
      "anthropic-ratelimit-unified-representative-claim": "overage",
      "anthropic-ratelimit-unified-7d-status": "allowed"
    } }));
    const result = await new DefaultExecutor("claude").execute({
      model: "claude-opus-4-8", body: { speed: "fast" }, stream: false, credentials: { accessToken: "a" }
    });
    expect(await result.response.text()).toBe("unchanged");
    if (status === 429) expect(result.claudeRequestScoped).toBe(true);
    endpoint();
    expect((await read()).quotas["weekly fable (7d)"].used).toBe(73);
  });

  it.each([["claude", { apiKey: "key", accessToken: "a" }], ["openai", { accessToken: "a" }]])(
    "excludes %s non-Claude-OAuth traffic", async (provider, credentials) => {
      proxyAwareFetch.mockResolvedValueOnce(new Response("ok", { headers: headers({ "7d_oi": 0.73 }) }));
      await new DefaultExecutor(provider).execute({ model: "test", body: {}, stream: false, credentials });
      endpoint(); expect((await read()).quotas).toEqual({});
    }
  );
});
