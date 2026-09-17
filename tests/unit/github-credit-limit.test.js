import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getGitHubUsage: vi.fn() }));
vi.mock("../../open-sse/services/usage/github.js", () => ({
  getGitHubUsage: mocks.getGitHubUsage,
}));

const { checkGitHubCreditLimit, isValidGitHubCreditLimit } =
  await import("../../open-sse/services/githubCreditLimit.js");

// A fresh token per case keeps the module-level usage cache from leaking a
// reading between tests.
let tokenSeq = 0;
const credentials = (aiCreditLimit) => ({
  accessToken: `token-${++tokenSeq}`,
  providerSpecificData: aiCreditLimit === undefined ? {} : { aiCreditLimit },
});
const reportsCredits = (creditsUsed) =>
  mocks.getGitHubUsage.mockResolvedValue({ quotas: { premium_interactions: { creditsUsed } } });

beforeEach(() => vi.clearAllMocks());

describe("GitHub AI Credits limit validation", () => {
  it.each([null, 0, 1, 12.5, 1000])("accepts %p", (limit) => {
    expect(isValidGitHubCreditLimit(limit)).toBe(true);
  });

  it.each([-1, Number.NaN, Infinity, "100", undefined, {}, []])("rejects %p", (limit) => {
    expect(isValidGitHubCreditLimit(limit)).toBe(false);
  });
});

describe("GitHub AI Credits cutoff", () => {
  it("allows the request when no limit is configured", async () => {
    reportsCredits(9999);
    expect(await checkGitHubCreditLimit(credentials(undefined))).toBeNull();
    // No limit means no reason to spend an upstream call.
    expect(mocks.getGitHubUsage).not.toHaveBeenCalled();
  });

  it("treats an explicit null limit as disabled", async () => {
    expect(await checkGitHubCreditLimit(credentials(null))).toBeNull();
    expect(mocks.getGitHubUsage).not.toHaveBeenCalled();
  });

  it("allows the request while usage is below the limit", async () => {
    reportsCredits(40);
    expect(await checkGitHubCreditLimit(credentials(100))).toBeNull();
  });

  it("blocks at the limit, not only past it", async () => {
    reportsCredits(100);
    const refusal = await checkGitHubCreditLimit(credentials(100));
    expect(refusal?.status).toBe(429);
    expect(refusal?.message).toContain("100 / 100");
  });

  it("blocks a zero limit without calling upstream", async () => {
    const refusal = await checkGitHubCreditLimit(credentials(0));
    expect(refusal?.status).toBe(429);
    expect(mocks.getGitHubUsage).not.toHaveBeenCalled();
  });

  // The limit exists to protect money. An unverifiable limit must not behave
  // like no limit at all, so every unknown-usage path fails closed.
  it("blocks when the usage fetch throws", async () => {
    mocks.getGitHubUsage.mockRejectedValue(new Error("network down"));
    expect((await checkGitHubCreditLimit(credentials(100)))?.status).toBe(503);
  });

  it.each([undefined, null, Number.NaN, -5, "40"])(
    "blocks when reported usage is unusable (%p)",
    async (creditsUsed) => {
      reportsCredits(creditsUsed);
      expect((await checkGitHubCreditLimit(credentials(100)))?.status).toBe(503);
    },
  );

  it("blocks when the stored limit is malformed rather than ignoring it", async () => {
    reportsCredits(1);
    expect((await checkGitHubCreditLimit(credentials(-1)))?.status).toBe(503);
    expect((await checkGitHubCreditLimit(credentials("100")))?.status).toBe(503);
  });

  it("serves concurrent checks from a single upstream call", async () => {
    reportsCredits(10);
    const shared = credentials(100);
    const [a, b, c] = await Promise.all([
      checkGitHubCreditLimit(shared),
      checkGitHubCreditLimit(shared),
      checkGitHubCreditLimit(shared),
    ]);
    expect([a, b, c]).toEqual([null, null, null]);
    expect(mocks.getGitHubUsage).toHaveBeenCalledTimes(1);
  });

  it("keeps separate accounts on separate cache entries", async () => {
    reportsCredits(10);
    await checkGitHubCreditLimit(credentials(100));
    await checkGitHubCreditLimit(credentials(100));
    // Distinct tokens must not share a cached reading, or one account's usage
    // would authorize another's spend.
    expect(mocks.getGitHubUsage).toHaveBeenCalledTimes(2);
  });
});
