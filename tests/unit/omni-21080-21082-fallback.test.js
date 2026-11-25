// OmniRoute #21080 (Cline daily free-limit retry hint) and #21082 (Kilo
// PAID_MODEL_AUTH_REQUIRED model-scoped denial) adapted to account fallback.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markAccountUnavailable } from "../../src/sse/services/auth.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { parseClineTryAgainInMs } from "../../open-sse/services/accountFallback/clineTryAgainIn.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
  recordProviderRateLimitEvidence: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
  getProviderConnectionById: vi.fn(),
  getSettings: mocks.getSettings,
}));

vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: mocks.recordProviderRateLimitEvidence,
  clearProviderRateLimitEvidence: vi.fn(),
}));

const FREE_MODEL = "cline-free/solar-pro4";
const clineBody = (tail) => `Daily free limit reached on model ${FREE_MODEL}. ${tail}`;
const H19M39 = ((19 * 60) + 39) * 60 * 1000;

describe("Cline daily free-limit retry hint (#21080)", () => {
  it("parses spaced, glued and partial countdowns", () => {
    expect(parseClineTryAgainInMs(clineBody("Try again in 19h 39m"), "cline", MAX_RATE_LIMIT_COOLDOWN_MS)).toBe(H19M39);
    expect(parseClineTryAgainInMs(clineBody("Try again in 19h39m"), "cline", MAX_RATE_LIMIT_COOLDOWN_MS)).toBe(H19M39);
    expect(parseClineTryAgainInMs(clineBody("Try again in 39m"), "cline", MAX_RATE_LIMIT_COOLDOWN_MS)).toBe(39 * 60_000);
    expect(parseClineTryAgainInMs(clineBody("Try again in 2h"), "cl", MAX_RATE_LIMIT_COOLDOWN_MS)).toBe(2 * 3_600_000);
    expect(parseClineTryAgainInMs(clineBody("Try again in 45s"), "cline", MAX_RATE_LIMIT_COOLDOWN_MS)).toBe(45_000);
  });

  it("rejects malformed, empty and zero hints", () => {
    for (const tail of ["", "Try again in a moment.", "Try again in", "Try again in 0h 0m", "Try again in -5h", "Try again in 19x"]) {
      expect(parseClineTryAgainInMs(clineBody(tail), "cline", MAX_RATE_LIMIT_COOLDOWN_MS)).toBeNull();
    }
    expect(parseClineTryAgainInMs(null, "cline", MAX_RATE_LIMIT_COOLDOWN_MS)).toBeNull();
    expect(parseClineTryAgainInMs("x".repeat(100_000), "cline", MAX_RATE_LIMIT_COOLDOWN_MS)).toBeNull();
  });

  it("caps an absurd countdown at the provider cooldown ceiling", () => {
    expect(parseClineTryAgainInMs(clineBody("Try again in 9999h"), "cline", MAX_RATE_LIMIT_COOLDOWN_MS)).toBe(MAX_RATE_LIMIT_COOLDOWN_MS);
  });

  it("only applies to Cline", () => {
    expect(parseClineTryAgainInMs(clineBody("Try again in 19h 39m"), "openai", MAX_RATE_LIMIT_COOLDOWN_MS)).toBeNull();
    expect(parseClineTryAgainInMs(clineBody("Try again in 19h 39m"), null, MAX_RATE_LIMIT_COOLDOWN_MS)).toBeNull();
  });

  it("benches the model for the stated window instead of the 2 s backoff", () => {
    const result = checkFallbackError(429, clineBody("Try again in 19h 39m"), 0, "cline", null, null, FREE_MODEL);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(H19M39);
    expect(result.scope).toBe("model");
    expect(result.newBackoffLevel).toBe(0);
  });

  it("reads the hint inside a JSON error envelope", () => {
    const body = JSON.stringify({ error: { message: clineBody("Try again in 19h 39m") } });
    expect(checkFallbackError(429, body, 0, "cline").cooldownMs).toBe(H19M39);
  });

  it("keeps the generic 429 backoff for other providers and for Cline without a hint", () => {
    const other = checkFallbackError(429, clineBody("Try again in 19h 39m"), 0, "openai");
    expect(other.cooldownMs).not.toBe(H19M39);
    const none = checkFallbackError(429, clineBody("Try again in a moment."), 0, "cline");
    expect(none.shouldFallback).toBe(true);
    expect(none.cooldownMs).toBeLessThan(60_000);
  });

  it("does not change non-429 Cline failures", () => {
    const result = checkFallbackError(500, clineBody("Try again in 19h 39m"), 0, "cline");
    expect(result.cooldownMs).not.toBe(H19M39);
  });
});

describe("Kilo PAID_MODEL_AUTH_REQUIRED denial scope (#21082)", () => {
  const CODE = "PAID_MODEL_AUTH_REQUIRED";
  const MESSAGE = "Authentication is required to use this model.";
  const shapes = {
    topLevelErrorType: { error_type: CODE, message: MESSAGE },
    errorCode: { error: { code: CODE, message: MESSAGE } },
    errorType: { error: { type: CODE, message: MESSAGE } },
  };

  it("is a model-scoped, non-terminal denial on both Kilo providers and their aliases", () => {
    for (const provider of ["kilo-gateway", "kilocode", "kg", "kc"]) {
      for (const status of [401, 402, 403]) {
        for (const body of Object.values(shapes)) {
          const viaStructured = checkFallbackError(status, MESSAGE, 0, provider, null, body);
          const viaText = checkFallbackError(status, JSON.stringify(body), 0, provider);
          for (const result of [viaStructured, viaText]) {
            expect(result).toMatchObject({ shouldFallback: true, scope: "model", modelOnly: true });
            expect(result.terminal).toBeUndefined();
            expect(result.cooldownMs).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("matches the code case-insensitively but never a lookalike or the message alone", () => {
    const lower = checkFallbackError(403, MESSAGE, 0, "kilo-gateway", null, { error: { code: CODE.toLowerCase() } });
    expect(lower.scope).toBe("model");
    for (const code of [`${CODE}_V2`, `X_${CODE}`]) {
      const result = checkFallbackError(403, MESSAGE, 0, "kilo-gateway", null, { error: { code } });
      expect(result.modelOnly).toBeUndefined();
    }
    expect(checkFallbackError(403, MESSAGE, 0, "kilo-gateway").modelOnly).toBeUndefined();
  });

  it("keeps credential failures, other statuses and other providers on their usual path", () => {
    const badKey = { error: { code: CODE, message: "Invalid API key" } };
    expect(checkFallbackError(401, "Invalid API key", 0, "kilo-gateway", null, badKey).modelOnly).toBeUndefined();
    expect(checkFallbackError(401, "Invalid API key", 0, "kilocode", null, shapes.errorCode.error && { error: { code: CODE, message: "expired access token" } }).modelOnly).toBeUndefined();
    for (const status of [429, 500]) {
      expect(checkFallbackError(status, MESSAGE, 0, "kilo-gateway", null, shapes.errorCode).modelOnly).toBeUndefined();
    }
    expect(checkFallbackError(403, MESSAGE, 0, "openrouter", null, shapes.errorCode).modelOnly).toBeUndefined();
    expect(checkFallbackError(401, "Invalid API key", 0, "kilo-gateway").modelOnly).toBeUndefined();
  });

  describe("markAccountUnavailable lock scope", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mocks.getSettings.mockResolvedValue({});
      mocks.getProviderConnections.mockResolvedValue([
        { id: "kilo-1", provider: "kilo-gateway", backoffLevel: 0 },
        { id: "kc-1", provider: "kilocode", backoffLevel: 0 },
      ]);
    });

    it("locks only the refused catalog model, never the whole connection", async () => {
      const result = await markAccountUnavailable("kilo-1", 401, MESSAGE, "kilo-gateway", "kilo-auto/frontier", null, { errorBody: shapes.errorCode });
      expect(result.shouldFallback).toBe(true);
      const writes = mocks.updateProviderConnection.mock.calls.map((call) => call[1]);
      const lockKeys = writes.flatMap((write) => Object.keys(write).filter((key) => key.startsWith("modelLock_")));
      expect(lockKeys).toEqual(["modelLock_kilo-auto/frontier"]);
      expect(lockKeys).not.toContain("modelLock___all");
    });

    it("writes no lock when the refused id has no bounded model scope", async () => {
      for (const [id, provider] of [["kilo-1", "kilo-gateway"], ["kc-1", "kilocode"]]) {
        const result = await markAccountUnavailable(id, 403, MESSAGE, provider, "anthropic/some-unlisted-paid-model", null, { errorBody: shapes.topLevelErrorType });
        expect(result).toEqual({ shouldFallback: true, cooldownMs: 0 });
      }
      expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
    });

    it("still cools the account for a real credential failure", async () => {
      await markAccountUnavailable("kilo-1", 401, "Invalid API key", "kilo-gateway", "anthropic/some-unlisted-paid-model", null, { errorBody: { error: { message: "Invalid API key" } } });
      const writes = mocks.updateProviderConnection.mock.calls.map((call) => call[1]);
      expect(writes.some((write) => "modelLock___all" in write)).toBe(true);
    });
  });
});
