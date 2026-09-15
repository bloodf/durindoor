// @vitest-environment happy-dom
/**
 * A Claude 429 must not blank the Quota Tracker card.
 *
 * Two independent gaps produced the observed "Rate limited, try again later."
 * with no rows:
 *
 *  1. Server: the in-process cache served rows for 30 minutes, but the
 *     rate-limit cooldown escalates to 2 hours. The entry expired mid-cooldown,
 *     so the fallback had nothing left to return.
 *  2. Client: a server restart empties that in-process cache entirely, so a
 *     dashboard opened during an active cooldown got a message-only response
 *     even though the browser still held the last-known rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const { getClaudeUsage } = await import("../../open-sse/services/usage/claude.js");
const { withCachedQuotaFallback, setQuotaCache } = await import(
  "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js"
);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function usageBody() {
  return {
    five_hour: { utilization: 15, resets_at: "2026-09-16T00:00:00Z" },
    seven_day: { utilization: 42, resets_at: "2026-09-20T00:00:00Z" },
  };
}

describe("Claude quota survives a rate-limit cooldown", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps serving rows for a 429 that arrives after the serve-fresh window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(usageBody()));
    const fresh = await getClaudeUsage("tok-window", null, "oauth");
    expect(Object.keys(fresh.quotas)).toHaveLength(2);

    // Past the 30m serve-fresh TTL but inside the 2h cooldown ceiling: the
    // entry must still be available as a stale fallback.
    vi.setSystemTime(new Date("2026-09-15T00:45:00Z"));
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "rate_limited" }, 429));

    const limited = await getClaudeUsage("tok-window", null, "oauth", { force: true });

    expect(limited.rateLimited).toBe(true);
    expect(limited.staleReason).toMatch(/showing cached quota/i);
    expect(Object.keys(limited.quotas)).toHaveLength(2);
  });

  it("still serves rows on a later request inside the same cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(usageBody()));
    await getClaudeUsage("tok-cooldown", null, "oauth");

    vi.setSystemTime(new Date("2026-09-15T00:45:00Z"));
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "rate_limited" }, 429));
    await getClaudeUsage("tok-cooldown", null, "oauth", { force: true });

    // Second read is served entirely from the cooldown branch (no new fetch).
    proxyAwareFetch.mockClear();
    const again = await getClaudeUsage("tok-cooldown", null, "oauth", { force: true });

    expect(proxyAwareFetch).not.toHaveBeenCalled();
    expect(Object.keys(again.quotas)).toHaveLength(2);
    expect(again.rateLimited).toBe(true);
  });

  it("reports the plain message once the retained entry is genuinely gone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(usageBody()));
    await getClaudeUsage("tok-expired", null, "oauth");

    // Beyond the retention ceiling: inventing rows here would be a lie.
    vi.setSystemTime(new Date("2026-09-15T04:00:00Z"));
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "rate_limited" }, 429));

    const limited = await getClaudeUsage("tok-expired", null, "oauth", { force: true });
    expect(limited.quotas).toBeUndefined();
    expect(limited.message).toBe("Rate limited, try again later.");
  });
});

describe("withCachedQuotaFallback (server restart during cooldown)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // setQuotaCache stores the POST-parse shape: `quotas` is the ARRAY returned
  // by parseQuotaData, not the server's object map.
  const cachedRows = [{ name: "session (5h)", used: 10, total: 100 }];

  it("substitutes saved rows for a message-only rate-limited response", () => {
    setQuotaCache("conn-1", { quotas: cachedRows });

    const result = withCachedQuotaFallback("conn-1", [], {
      message: "Rate limited, try again later.",
    });

    expect(result.quotas).toEqual(cachedRows);
    // The reason must survive so the card can explain the stale numbers.
    expect(result.staleReason).toBe("Rate limited, try again later.");
  });

  it("substitutes when the parser produced only an error row", () => {
    setQuotaCache("conn-err", { quotas: cachedRows });

    const errorRows = [{ name: "error", used: 0, total: 0, message: "Rate limited, try again later." }];
    const result = withCachedQuotaFallback("conn-err", errorRows, {
      message: "Rate limited, try again later.",
    });

    expect(result.quotas).toEqual(cachedRows);
  });

  it("never lets cached rows override live ones", () => {
    setQuotaCache("conn-2", { quotas: cachedRows });

    const live = [{ name: "weekly (7d)", used: 1, total: 100 }];
    const result = withCachedQuotaFallback("conn-2", live, { message: null });
    expect(result.quotas).toEqual(live);
    expect(result.staleReason).toBeNull();
  });

  it("does not borrow another connection's rows", () => {
    setQuotaCache("conn-other", { quotas: cachedRows });

    const result = withCachedQuotaFallback("conn-3", [], {
      message: "Rate limited, try again later.",
    });
    expect(result.quotas).toEqual([]);
    expect(result.staleReason).toBeNull();
  });

  it("passes through when nothing is cached", () => {
    const result = withCachedQuotaFallback("conn-4", [], {
      message: "Rate limited, try again later.",
    });
    expect(result.quotas).toEqual([]);
    expect(result.staleReason).toBeNull();
  });
});
