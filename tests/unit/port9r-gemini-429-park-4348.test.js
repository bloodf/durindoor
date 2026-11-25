import { describe, expect, it } from "vitest";
import { GEMINI_DAILY_QUOTA_PARK_MS } from "../../open-sse/config/errorConfig.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { parseRateLimitEvidence, parseUpstreamError } from "../../open-sse/utils/error.js";

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const QUOTA = "You exceeded your current quota, please check your plan and billing details.";
const PER_MINUTE = "GenerateRequestsPerMinutePerProjectPerModel-FreeTier";
const PER_DAY = "GenerateRequestsPerDayPerProjectPerModel-FreeTier";

function body({ message = QUOTA, quotaId = null, retryDelay = null } = {}) {
  const details = [
    ...(quotaId ? [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] }] : []),
    ...(retryDelay ? [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }] : []),
  ];
  return JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message, details } }, null, 2);
}

async function chatReset(raw) {
  const parsed = await parseUpstreamError(new Response(raw, { status: 429 }), getExecutor("gemini"), { provider: "gemini", now: NOW });
  return parsed.resetsAtMs;
}

describe("decolua/9router#4348 - Gemini 429 parks a key for the stated delay", () => {
  it("honours the exact retryDelay and rotates to the next key", async () => {
    const raw = body({ quotaId: PER_MINUTE, retryDelay: "22s" });

    await expect(chatReset(raw)).resolves.toBe(NOW + 22_000);
    expect(checkFallbackError({ status: 429, errorText: raw, provider: "gemini" }).shouldFallback).toBe(true);
  });

  it("reads a fractional delay that only the message states, on both paths", async () => {
    const raw = body({ message: `${QUOTA} Please retry in 22.230404999s.` });

    await expect(chatReset(raw)).resolves.toBe(NOW + 22_230);
    const rawPath = checkFallbackError({ status: 429, errorText: raw, provider: "gemini" });
    expect(rawPath.cooldownMs).toBeGreaterThan(21_000);
    expect(rawPath.cooldownMs).toBeLessThanOrEqual(22_230);
  });

  it("parks a key for hours when a per-day quota is exhausted despite a short retryDelay", async () => {
    const raw = body({ quotaId: PER_DAY, retryDelay: "22s" });
    const inWindow = (ms) => {
      expect(ms).toBeGreaterThanOrEqual(GEMINI_DAILY_QUOTA_PARK_MS.min - 1_000);
      expect(ms).toBeLessThan(GEMINI_DAILY_QUOTA_PARK_MS.max);
    };

    inWindow(await chatReset(raw) - NOW);
    inWindow(checkFallbackError({ status: 429, errorText: raw, provider: "gemini" }).cooldownMs);
  });

  it("keeps a longer stated reset than the daily park window", () => {
    const evidence = parseRateLimitEvidence({ status: 429, bodyText: body({ quotaId: PER_DAY, retryDelay: "5h" }), now: NOW, provider: "gemini" });

    expect(evidence.resetAtMs).toBe(NOW + 5 * 60 * 60 * 1000);
  });

  it("ignores prose that only mentions a per-day quota, and leaves other providers alone", () => {
    const prose = parseRateLimitEvidence({ status: 429, bodyText: body({ message: `${QUOTA} ${PER_DAY}`, retryDelay: "22s" }), now: NOW, provider: "gemini" });
    const other = parseRateLimitEvidence({ status: 429, bodyText: body({ quotaId: PER_DAY, retryDelay: "22s" }), now: NOW, provider: "openai" });

    expect(prose.resetAtMs).toBe(NOW + 22_000);
    expect(other.resetAtMs).toBe(NOW + 22_000);
  });
});
