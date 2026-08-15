import { describe, expect, it } from "vitest";
import { getKimiTemporaryRateLimitResetAt } from "../../open-sse/handlers/chatCore/kimiQuotaRecovery.js";

const NOW = Date.parse("2026-08-11T01:00:00.000Z");
const RESET_AT = "2026-08-11T04:49:07.783Z";

describe("getKimiTemporaryRateLimitResetAt", () => {
  it("keeps a temporary request limit recoverable while weekly quota remains", () => {
    expect(
      getKimiTemporaryRateLimitResetAt(
        { quotas: { Ratelimit: { remaining: 0, resetAt: RESET_AT }, Weekly: { remaining: 14 } } },
        NOW,
      ),
    ).toBe(RESET_AT);
  });

  it.each([
    ["weekly quota is exhausted", { quotas: { Ratelimit: { remaining: 0, resetAt: RESET_AT }, Weekly: { remaining: 0 } } }],
    ["rate-limit window still has capacity", { quotas: { Ratelimit: { remaining: 1, resetAt: RESET_AT }, Weekly: { remaining: 14 } } }],
    ["reset is malformed", { quotas: { Ratelimit: { remaining: 0, resetAt: "not-a-date" }, Weekly: { remaining: 14 } } }],
    ["reset is already elapsed", { quotas: { Ratelimit: { remaining: 0, resetAt: "2026-08-11T00:59:59.999Z" }, Weekly: { remaining: 14 } } }],
    ["usage lacks quota data", {}],
  ])("does not recover when %s", (_description, usage) => {
    expect(getKimiTemporaryRateLimitResetAt(usage, NOW)).toBeNull();
  });
});
