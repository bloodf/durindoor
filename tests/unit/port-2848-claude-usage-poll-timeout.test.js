import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getClaudeUsage, __clearOAuthQuotaCacheForTesting } from "../../open-sse/services/usage/claude.js";

const POLL_DEADLINE_MS = 5_000;
const quotaBody = { five_hour: { utilization: 15, resets_at: "2026-07-17T20:00:00Z" } };
const okResponse = (body = quotaBody) => new Response(JSON.stringify(body), { status: 200 });

/** A poll that settles only when the caller aborts it. */
const hangUntilAborted = (_url, options) => new Promise((_resolve, reject) => {
  options.signal?.addEventListener("abort", () => reject(new Error("This operation was aborted")), { once: true });
});

/** Headers arrive, the body never does. */
const stalledBody = async () => new Response(new ReadableStream({ start() {} }), { status: 200 });

async function pollToDeadline(token, options) {
  const pending = getClaudeUsage(token, null, "oauth", options);
  await vi.advanceTimersByTimeAsync(POLL_DEADLINE_MS);
  return pending;
}

describe("upstream 9router #2848: Claude OAuth quota poll is bounded", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    proxyAwareFetch.mockReset();
    __clearOAuthQuotaCacheForTesting();
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ["a hung request", hangUntilAborted],
    ["a stalled body", stalledBody],
  ])("aborts %s and polls again on the next call", async (_name, hang) => {
    proxyAwareFetch.mockImplementationOnce(hang).mockResolvedValueOnce(okResponse());

    const first = await pollToDeadline("token-hung");
    expect(first.message).toMatch(/Unable to fetch usage/);

    const second = await getClaudeUsage("token-hung", null, "oauth");
    expect(second.quotas["session (5h)"].used).toBe(15);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  }, 2_000);

  it.each([
    ["times out", hangUntilAborted],
    ["is not JSON", async () => new Response("<html>gateway</html>", { status: 200 })],
    ["is JSON null", async () => okResponse(null)],
    ["is a JSON array", async () => okResponse([])],
  ])("keeps the cached quota when a refresh %s", async (_name, refresh) => {
    proxyAwareFetch.mockResolvedValueOnce(okResponse());
    await getClaudeUsage("token-cached", null, "oauth");

    proxyAwareFetch.mockImplementationOnce(refresh);
    const refreshed = await pollToDeadline("token-cached", { force: true });
    expect(refreshed).toMatchObject({ stale: true, quotas: { "session (5h)": { used: 15 } } });

    // The failed refresh must not overwrite the cached rows.
    const cached = await getClaudeUsage("token-cached", null, "oauth");
    expect(cached.quotas["session (5h)"].used).toBe(15);
    expect(cached.stale).toBeUndefined();
  }, 2_000);
});
