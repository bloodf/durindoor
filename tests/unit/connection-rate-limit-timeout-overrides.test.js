import { afterEach, describe, expect, it } from "vitest";
import {
  _resetRpdLimiter,
  isOverLimit,
  recordRequest,
  retryAfterMs,
} from "@/sse/services/rpdLimiter.js";
import { MAX_CONNECTION_TIMEOUT_MS, resolveConnectionTimeoutMs } from "@/lib/providers/requestTimeout";
import { normalizeProviderSpecificData } from "@/lib/providerNormalization";

// port(omniroute): per-connection RPD override (OmniRoute c49ee53bc, #12147)
// and per-connection upstream timeout tier (OmniRoute fdeac496e, #10885),
// adapted to DurinDoor's provider layer.

describe("rpdLimiter", () => {
  afterEach(() => _resetRpdLimiter());

  it("admits requests under the daily cap and blocks once spent", () => {
    const now = Date.parse("2026-09-23T00:00:00.000Z");
    const connectionId = "conn-rpd-1";
    recordRequest(connectionId, 2, now);
    expect(isOverLimit(connectionId, 2, now)).toBe(false);
    recordRequest(connectionId, 2, now + 1000);
    expect(isOverLimit(connectionId, 2, now + 2000)).toBe(true);
  });

  it("readmits after the 24h window rolls off", () => {
    const now = Date.parse("2026-09-23T00:00:00.000Z");
    const connectionId = "conn-rpd-2";
    recordRequest(connectionId, 1, now);
    expect(isOverLimit(connectionId, 1, now + 1000)).toBe(true);
    expect(isOverLimit(connectionId, 1, now + 24 * 60 * 60 * 1000 + 1)).toBe(false);
  });

  it("has no cap (never over limit) when limit is 0/unset", () => {
    expect(isOverLimit("conn-rpd-3", 0, Date.now())).toBe(false);
    expect(isOverLimit("conn-rpd-3", undefined, Date.now())).toBe(false);
  });

  it("retryAfterMs returns null when under the cap", () => {
    expect(retryAfterMs("conn-rpd-4", 5, Date.now())).toBeNull();
  });
});

describe("resolveConnectionTimeoutMs", () => {
  it("floors a valid positive timeout", () => {
    expect(resolveConnectionTimeoutMs({ timeoutMs: 1_800_000.9 })).toBe(1_800_000);
    expect(resolveConnectionTimeoutMs({ timeoutMs: 1 })).toBe(1);
  });

  it("returns undefined for absent/invalid values", () => {
    expect(resolveConnectionTimeoutMs(undefined)).toBeUndefined();
    expect(resolveConnectionTimeoutMs(null)).toBeUndefined();
    expect(resolveConnectionTimeoutMs({})).toBeUndefined();
    expect(resolveConnectionTimeoutMs({ timeoutMs: 0 })).toBeUndefined();
    expect(resolveConnectionTimeoutMs({ timeoutMs: -5 })).toBeUndefined();
    expect(resolveConnectionTimeoutMs({ timeoutMs: "60000" })).toBeUndefined();
    expect(resolveConnectionTimeoutMs({ timeoutMs: MAX_CONNECTION_TIMEOUT_MS + 1 })).toBeUndefined();
  });
});

describe("normalizeProviderSpecificData generic overrides", () => {
  it("keeps a valid peakHourProtection block and drops an empty one", () => {
    const kept = normalizeProviderSpecificData("openai", {}, {
      peakHourProtection: { enabled: true, mode: "block", windows: [{ startUtc: "06:00", endUtc: "10:00" }] },
    });
    expect(kept.peakHourProtection.enabled).toBe(true);
    expect(kept.peakHourProtection.windows).toHaveLength(1);

    const dropped = normalizeProviderSpecificData("openai", {}, { peakHourProtection: { enabled: false, windows: [] } });
    expect(dropped).toBeNull();
  });

  it("keeps only positive rateLimitOverrides.rpd and clears an empty override", () => {
    const kept = normalizeProviderSpecificData("openai", {}, { rateLimitOverrides: { rpd: "500" } });
    expect(kept.rateLimitOverrides).toEqual({ rpd: 500 });

    const cleared = normalizeProviderSpecificData("openai", {}, { rateLimitOverrides: { rpd: 0 } });
    expect(cleared).toBeNull();
  });

  it("validates timeoutMs bounds", () => {
    const kept = normalizeProviderSpecificData("openai", {}, { timeoutMs: 900_000 });
    expect(kept.timeoutMs).toBe(900_000);

    const rejected = normalizeProviderSpecificData("openai", {}, { timeoutMs: -1 });
    expect(rejected).toBeNull();
  });
});
