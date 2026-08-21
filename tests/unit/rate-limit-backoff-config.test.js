import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = ["BACKOFF_BASE_MS", "BACKOFF_MAX_MS", "BACKOFF_MAX_LEVEL"];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearBackoffEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

async function loadBackoff(config = {}) {
  clearBackoffEnv();
  Object.assign(process.env, config);
  vi.resetModules();

  const [errorConfig, accountFallback] = await Promise.all([
    import("../../open-sse/config/errorConfig.js"),
    import("../../open-sse/services/accountFallback.js"),
  ]);
  return { ...errorConfig, ...accountFallback };
}

afterEach(() => {
  clearBackoffEnv();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value !== undefined) process.env[key] = value;
  }
  vi.resetModules();
});

describe("configurable 429 account backoff (#3352)", () => {
  it("keeps the historical schedule when configuration is unset", async () => {
    const { BACKOFF_CONFIG, getQuotaCooldown } = await loadBackoff();

    expect(BACKOFF_CONFIG).toEqual({ base: 2000, max: 300000, maxLevel: 15 });
    expect(getQuotaCooldown(2)).toBe(4000);
  });

  it("lets each backoff key override independently", async () => {
    const baseOnly = await loadBackoff({ BACKOFF_BASE_MS: "3000" });
    expect(baseOnly.BACKOFF_CONFIG).toEqual({ base: 3000, max: 300000, maxLevel: 15 });

    const maxOnly = await loadBackoff({ BACKOFF_MAX_MS: "10000" });
    expect(maxOnly.BACKOFF_CONFIG).toEqual({ base: 2000, max: 10000, maxLevel: 15 });

    const levelOnly = await loadBackoff({ BACKOFF_MAX_LEVEL: "7" });
    expect(levelOnly.BACKOFF_CONFIG).toEqual({ base: 2000, max: 300000, maxLevel: 7 });
  });

  it("falls back per invalid knob while retaining valid overrides", async () => {
    const nonNumericBase = await loadBackoff({
      BACKOFF_BASE_MS: "not-a-number",
      BACKOFF_MAX_MS: "10000",
    });
    expect(nonNumericBase.BACKOFF_CONFIG).toEqual({ base: 2000, max: 10000, maxLevel: 15 });

    const negativeMax = await loadBackoff({ BACKOFF_MAX_MS: "-1" });
    expect(negativeMax.BACKOFF_CONFIG).toEqual({ base: 2000, max: 300000, maxLevel: 15 });

    const negativeLevel = await loadBackoff({ BACKOFF_MAX_LEVEL: "-4" });
    expect(negativeLevel.BACKOFF_CONFIG).toEqual({ base: 2000, max: 300000, maxLevel: 15 });
  });

  it("rejects a max below base as a complete contradictory schedule", async () => {
    const { BACKOFF_CONFIG, getQuotaCooldown } = await loadBackoff({
      BACKOFF_BASE_MS: "5000",
      BACKOFF_MAX_MS: "2000",
      BACKOFF_MAX_LEVEL: "7",
    });

    expect(BACKOFF_CONFIG).toEqual({ base: 2000, max: 300000, maxLevel: 15 });
    expect(getQuotaCooldown(2)).toBe(4000);
  });

  it("uses configured values in the existing cooldown consumers", async () => {
    const { BACKOFF_CONFIG, getQuotaCooldown, checkFallbackError } = await loadBackoff({
      BACKOFF_BASE_MS: "3000",
      BACKOFF_MAX_MS: "10000",
      BACKOFF_MAX_LEVEL: "5",
    });

    expect(BACKOFF_CONFIG).toEqual({ base: 3000, max: 10000, maxLevel: 5 });
    expect(getQuotaCooldown(3)).toBe(10000);
    expect(checkFallbackError(429, "", 99)).toMatchObject({
      cooldownMs: 10000,
      newBackoffLevel: 5,
    });
    expect(checkFallbackError(500, "provider rate limit", 99)).toMatchObject({
      cooldownMs: 10000,
      newBackoffLevel: 5,
    });
  });

  it("clamps an oversized maximum to a representable cooldown deadline", async () => {
    const { BACKOFF_CONFIG, MAX_RATE_LIMIT_COOLDOWN_MS, getQuotaCooldown } = await loadBackoff({
      BACKOFF_MAX_MS: String(Number.MAX_SAFE_INTEGER),
    });

    const cooldownMs = getQuotaCooldown(Number.MAX_SAFE_INTEGER);
    expect(BACKOFF_CONFIG.max).toBe(MAX_RATE_LIMIT_COOLDOWN_MS);
    expect(cooldownMs).toBe(MAX_RATE_LIMIT_COOLDOWN_MS);
    expect(() => new Date(Date.now() + cooldownMs).toISOString()).not.toThrow();
  });
});
