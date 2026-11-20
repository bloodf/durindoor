import { describe, expect, it } from "vitest";
import {
  buildModelLockUpdate,
  checkFallbackError,
  isModelLockActive,
} from "../../open-sse/services/accountFallback.js";
import { resolveFallbackModelScope } from "../../open-sse/services/fallbackScope.js";

describe("Grok 402 fallback scope", () => {
  it.each([
    ["grok-cli", "grok-build", "grok-4.5"],
    ["grok-web", "grok-3", "grok-4"],
  ])("keeps an empty 402 on the failing %s model and connection", (provider, model, otherModel) => {
    const result = checkFallbackError(402, "", 0, provider);
    expect(result).toMatchObject({ shouldFallback: true, cooldownMs: 120000, terminal: true, scope: null });
    const scope = resolveFallbackModelScope(provider, model);
    expect(scope).toBe(model);
    const failedConnection = buildModelLockUpdate(scope, result.cooldownMs);
    expect(isModelLockActive(failedConnection, model)).toBe(true);
    expect(isModelLockActive(failedConnection, otherModel)).toBe(false);
    expect(isModelLockActive({}, model)).toBe(false);
    expect(checkFallbackError(402, "insufficient credits", 0, provider)).toMatchObject({
      shouldFallback: true, cooldownMs: 120000, terminal: true,
    });
    expect(checkFallbackError(429, "", 0, provider)).toMatchObject({
      shouldFallback: true, cooldownMs: 2000, newBackoffLevel: 1,
    });
  });
});
