import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

// durindoor#951: production hosts saw the Codex dashboard provider page spin
// forever. Root cause: getCodexUsage's fetch to chatgpt.com had no timeout of
// its own (unlike the credential refresh that precedes it), so a stalled
// network path left /api/usage/[connectionId] — and the page awaiting it —
// hanging indefinitely instead of failing open.
describe("durindoor#951: Codex usage fetch is bounded", () => {
  it("passes an AbortSignal to proxyAwareFetch so a stalled request cannot hang forever", async () => {
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ rate_limit: { primary_window: { used_percent: 1 } } }),
    });

    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");
    await getCodexUsage("token");

    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [, options] = mocks.proxyAwareFetch.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("surfaces a timeout as a rejection instead of hanging when the upstream never responds", async () => {
    mocks.proxyAwareFetch.mockImplementation((url, options) => {
      return new Promise((resolve, reject) => {
        // Simulate a stalled upstream: proxyAwareFetch only settles once the
        // caller's own AbortSignal fires — nothing else bounds this call.
        options.signal.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });

    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");

    await expect(getCodexUsage("token")).rejects.toThrow(/Failed to fetch Codex usage/);
  }, 20000);
});
