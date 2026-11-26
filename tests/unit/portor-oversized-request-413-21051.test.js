import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(),
  clearProviderRateLimitEvidence: vi.fn(),
}));
vi.mock("@/lib/webhooks/index.js", () => ({ notifyWebhookEvent: vi.fn() }));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

const groq = (limit, requested) =>
  `[413]: Request too large for model \`llama\` on tokens per minute (TPM): Limit ${limit}, Requested ${requested}, please reduce your message size`;
const mark = (errorText, status = 413) =>
  markAccountUnavailable("acc-a", status, errorText, "groq", "llama", Date.now() + 60_000);

describe("OmniRoute #21051 — request larger than the whole rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getProviderConnections.mockResolvedValue([
      { id: "acc-a", provider: "groq", isActive: true },
      { id: "acc-b", provider: "groq", isActive: true },
    ]);
    dbMocks.getSettings.mockResolvedValue({});
  });

  it("does not rotate or lock despite a future reset hint", async () => {
    await expect(mark(groq(8000, 36955))).resolves.toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["a used-up window", groq(8000, 6000), 413],
    ["a 429 with the same wording", groq(8000, 36955), 429],
  ])("keeps account fallback for %s", async (_name, errorText, status) => {
    await expect(mark(errorText, status)).resolves.toMatchObject({ shouldFallback: true });
    expect(dbMocks.updateProviderConnection).toHaveBeenCalled();
  });
});
