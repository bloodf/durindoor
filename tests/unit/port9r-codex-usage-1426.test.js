import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getCodexUsage } from "../../open-sse/services/usage/codex.js";

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe("Codex usage windows", () => {
  it("sends account context and resolves relative reset times", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:00Z"));
    proxyAwareFetch.mockResolvedValue(new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 25, reset_after_seconds: 3600 } } })));
    const result = await getCodexUsage("token", { chatgptAccountId: "acct_123", chatgptPlanType: "plus" });
    expect(proxyAwareFetch.mock.calls[0][1].headers["ChatGPT-Account-ID"]).toBe("acct_123");
    expect(result.plan).toBe("plus");
    expect(result.quotas.session.resetAt).toBe("2026-05-25T13:00:00.000Z");
  });
  it("explains a response with no quota windows", async () => {
    proxyAwareFetch.mockResolvedValue(new Response("{}"));
    const result = await getCodexUsage("token");
    expect(result.message).toBe("Codex connected. Usage API returned no quota windows.");
  });
});
