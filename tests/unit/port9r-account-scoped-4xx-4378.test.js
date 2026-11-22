// decolua/9router#4378: a 412 (Fireworks "account is suspended") was handed back
// to the client as a request-scoped error instead of rotating to the provider's
// next connection.
import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("checkFallbackError — account-scoped 4xx rotates connections (#4378)", () => {
  it("falls back with a cooldown for a 412 account suspension", () => {
    const result = checkFallbackError(412, JSON.stringify({
      error: { message: "Account is suspended. Please check your billing information.", type: "invalid_request_error" },
    }));
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(result.requestScoped).toBeUndefined();
  });

  it.each([412, 423, 428])("falls back for %i", (status) => {
    expect(checkFallbackError(status, "upstream refused").shouldFallback).toBe(true);
  });

  it.each([400, 405, 406, 413, 414, 415, 422])("still hands back request-scoped %i", (status) => {
    expect(checkFallbackError(status, "malformed request")).toMatchObject({ shouldFallback: false, cooldownMs: 0 });
  });
});
