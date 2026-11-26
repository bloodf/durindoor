import { describe, expect, it } from "vitest";

import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { TRANSIENT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";

describe("upstream #4393 - short cooldown for transient 5xx", () => {
  it.each([500, 502, 503, 504])("cools a bare %i for 5 seconds and still falls back", (status) => {
    expect(checkFallbackError(status, "upstream failed")).toMatchObject({ shouldFallback: true, cooldownMs: 5000 });
  });

  it("lets rate-limit text keep exponential backoff on a 503", () => {
    expect(checkFallbackError(503, "rate limit exceeded")).toMatchObject({ shouldFallback: true, newBackoffLevel: 1 });
  });

  it.each([408, 529])("keeps the default transient cooldown for unlisted status %i", (status) => {
    expect(checkFallbackError(status, "upstream failed").cooldownMs).toBe(TRANSIENT_COOLDOWN_MS);
  });

  // OmniRoute #19688: 501 is a capability gap, not a transient fault.
  it("gives a 501 no cooldown", () => {
    expect(checkFallbackError(501, "upstream failed")).toMatchObject({ shouldFallback: false, cooldownMs: 0 });
  });

  it("leaves long 4xx cooldowns and request-scoped 4xx unchanged", () => {
    expect(checkFallbackError(401, "upstream failed").cooldownMs).toBe(120_000);
    expect(checkFallbackError(422, "upstream failed")).toMatchObject({ shouldFallback: false, cooldownMs: 0 });
  });
});
