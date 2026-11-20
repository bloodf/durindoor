import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("OmniRoute November routing and existing filter contracts", () => {
  it.each([
    "No endpoints found that support image input",
    "No allowed providers are available for this request",
    "No endpoints found matching your data policy",
  ])("keeps an OpenRouter request mismatch out of cooldown: %s", (message) => {
    expect(checkFallbackError(404, message, 0, "openrouter")).toEqual({
      shouldFallback: false, cooldownMs: 0, scope: null, requestScoped: true,
    });
  });

  it("preserves generic 404 cooldown and provider scoping", () => {
    for (const [provider, message] of [
      ["openrouter", "No endpoints found for missing/model"],
      ["other", "No endpoints found that support image input"],
    ]) {
      expect(checkFallbackError(404, message, 0, provider)).toMatchObject({
        shouldFallback: true, cooldownMs: 120000, scope: null,
      });
    }
    expect(checkFallbackError(401, "No endpoints found that support image input", 0, "openrouter").cooldownMs).toBe(120000);
  });

  it("keeps existing provider-specific parameter stripping scoped", () => {
    const nvidia = { client_metadata: { source: "fixture" }, temperature: 0.5 };
    const other = structuredClone(nvidia);
    stripUnsupportedParams("nvidia", "fixture-model", nvidia);
    stripUnsupportedParams("openrouter", "fixture-model", other);
    expect(nvidia).toEqual({ temperature: 0.5 });
    expect(other).toEqual({ client_metadata: { source: "fixture" }, temperature: 0.5 });
  });
});
