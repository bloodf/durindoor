// Guards the refactored USAGE_HANDLERS dispatch: unsupported → message, supported → routed.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub network so handlers don't hit real APIs; each call resolves an empty 200.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "{}",
  })),
}));

const load = () => import("../../open-sse/services/usage.js");

describe("usage dispatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unsupported provider → not-implemented message", async () => {
    const { getUsageForProvider } = await load();
    const res = await getUsageForProvider({ provider: "totally-unknown" });
    expect(res).toEqual({ message: "Usage API not implemented for totally-unknown" });
  });


  it("passes Codex provider metadata to the usage request", async () => {
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    const { getUsageForProvider } = await load();

    await getUsageForProvider({
      provider: "codex",
      accessToken: "token",
      providerSpecificData: { accountId: "account-usage" },
    }, { strictProxy: false });

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "ChatGPT-Account-ID": "account-usage" }),
      }),
      { strictProxy: false },
    );
  });
});
