import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "{}" })),
}));

const load = () => import("../../open-sse/services/usage.js");
const loadClaude = () => import("../../open-sse/services/usage/claude.js");

describe("usage force flag wires through dispatch and Claude provider", () => {
  beforeEach(async () => {
    (await loadClaude()).__clearOAuthQuotaCacheForTesting();
  });

  afterEach(() => vi.clearAllMocks());

  it("getUsageForProvider forwards force to the Claude handler", async () => {
    const claudeSpy = vi.spyOn(await loadClaude(), "getClaudeUsage").mockResolvedValue({ quotas: {} });
    const { getUsageForProvider } = await load();

    await getUsageForProvider(
      { provider: "claude", accessToken: "t1" },
      null,
      { force: true },
    );

    expect(claudeSpy).toHaveBeenCalledWith("t1", null, "oauth", { force: true });
  });

  it("default call forwards force: false", async () => {
    const claudeSpy = vi.spyOn(await loadClaude(), "getClaudeUsage").mockResolvedValue({ quotas: {} });
    const { getUsageForProvider } = await load();

    await getUsageForProvider({ provider: "claude", accessToken: "t1" });

    expect(claudeSpy).toHaveBeenCalledWith("t1", null, "oauth", { force: false });
  });
});
